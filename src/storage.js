const config = require('./config');

// Bộ nhớ RAM dự phòng khi không cấu hình Redis hoặc chạy local
const memoryConversations = new Map();
const memoryGroupBuffers = new Map();
let memoryReminders = [];

const MAX_HISTORY_MESSAGES = 10;
const MAX_GROUP_BUFFER = 50;
const CONVERSATION_TTL_SECONDS = 86400; // 24 giờ
const GROUP_BUFFER_TTL_SECONDS = 43200; // 12 giờ
const LAST_IMAGE_TTL_SECONDS = 7200; // 2 giờ
const INSULT_COOLDOWN_SECONDS = 900; // 15 phút (900 giây)
const INSULT_STATE_TTL_SECONDS = 1800; // 30 phút
const REDIS_REMINDERS_KEY = 'zalo:reminders:list';
const memoryLastImages = new Map();
const memoryInsults = new Map();

/**
 * Thực thi lệnh Upstash Redis qua REST API (Chuẩn Serverless không cần dependency)
 */
async function callRedisCommand(...args) {
  if (!config.upstashRedisRestUrl || !config.upstashRedisRestToken) {
    return null;
  }

  try {
    const res = await fetch(config.upstashRedisRestUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.upstashRedisRestToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(3500)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`⚠️ Upstash Redis [${args[0]}] HTTP ${res.status}:`, errText.slice(0, 100));
      return null;
    }

    const data = await res.json();
    return data.result;
  } catch (err) {
    console.warn(`⚠️ Lỗi kết nối Upstash Redis [${args[0]}]:`, err.message);
    return null;
  }
}

/**
 * Lấy lịch sử hội thoại của một cuộc trò chuyện
 * @param {string|number} chatId
 * @returns {Promise<Array>}
 */
async function getConversationHistory(chatId) {
  const idStr = String(chatId);

  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    const key = `zalo:conv:${idStr}`;
    const raw = await callRedisCommand('GET', key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        // Parse error fallback to memory
      }
    }
  }

  return memoryConversations.get(idStr) || [];
}

/**
 * Lưu lịch sử hội thoại
 * @param {string|number} chatId
 * @param {Array} history
 */
async function saveConversationHistory(chatId, history) {
  const idStr = String(chatId);
  const trimmed = history.slice(-MAX_HISTORY_MESSAGES);

  // Lưu vào RAM
  memoryConversations.set(idStr, trimmed);

  // Lưu vào Redis nếu có cấu hình
  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    const key = `zalo:conv:${idStr}`;
    await callRedisCommand('SET', key, JSON.stringify(trimmed), 'EX', CONVERSATION_TTL_SECONDS);
  }
}

/**
 * Xóa lịch sử hội thoại
 * @param {string|number} chatId
 */
async function clearConversationHistory(chatId) {
  const idStr = String(chatId);
  memoryConversations.delete(idStr);

  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    const key = `zalo:conv:${idStr}`;
    await callRedisCommand('DEL', key);
  }
}

/**
 * Lưu tin nhắn vào bộ đệm của nhóm để phục vụ tính năng tóm tắt (/summary)
 * @param {string|number} chatId ID của nhóm chat
 * @param {{ senderName: string, senderId: string, text: string, time: string }} msgObj
 */
async function pushGroupMessage(chatId, msgObj) {
  const idStr = String(chatId);

  let current = [];
  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    const key = `zalo:group_buf:${idStr}`;
    const raw = await callRedisCommand('GET', key);
    if (raw) {
      try {
        current = JSON.parse(raw);
      } catch (e) {}
    }
  }

  if (!Array.isArray(current) || current.length === 0) {
    current = memoryGroupBuffers.get(idStr) || [];
  }

  current.push(msgObj);
  if (current.length > MAX_GROUP_BUFFER) {
    current.splice(0, current.length - MAX_GROUP_BUFFER);
  }

  // Cập nhật RAM
  memoryGroupBuffers.set(idStr, current);

  // Cập nhật Redis
  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    const key = `zalo:group_buf:${idStr}`;
    await callRedisCommand('SET', key, JSON.stringify(current), 'EX', GROUP_BUFFER_TTL_SECONDS);
  }
}

/**
 * Lấy danh sách tin nhắn gần nhất trong nhóm
 * @param {string|number} chatId
 * @returns {Promise<Array>}
 */
async function getGroupMessages(chatId) {
  const idStr = String(chatId);

  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    const key = `zalo:group_buf:${idStr}`;
    const raw = await callRedisCommand('GET', key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {}
    }
  }

  return memoryGroupBuffers.get(idStr) || [];
}

/**
 * Xóa bộ đệm tin nhắn nhóm
 * @param {string|number} chatId
 */
async function clearGroupMessages(chatId) {
  const idStr = String(chatId);
  memoryGroupBuffers.delete(idStr);

  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    const key = `zalo:group_buf:${idStr}`;
    await callRedisCommand('DEL', key);
  }
}

// ==========================================
// QUẢN LÝ NHẮC HẸN (REMINDERS)
// ==========================================

/**
 * Lấy danh sách toàn bộ nhắc hẹn đang chờ
 * @returns {Promise<Array>}
 */
async function getAllReminders() {
  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    const raw = await callRedisCommand('GET', REDIS_REMINDERS_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {}
    }
  }
  return memoryReminders;
}

/**
 * Lưu danh sách nhắc hẹn
 * @param {Array} reminders
 */
async function saveAllReminders(reminders) {
  memoryReminders = reminders;
  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    await callRedisCommand('SET', REDIS_REMINDERS_KEY, JSON.stringify(reminders));
  }
}

/**
 * Thêm một nhắc hẹn mới
 * @param {{ chatId: string, senderId: string, senderName: string, chatType: string, content: string, remindAt: number, repeat?: string, targetTime?: string }} reminderData
 * @returns {Promise<object>}
 */
async function addReminder(reminderData) {
  const reminders = await getAllReminders();
  const newReminder = {
    id: `rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    chatId: String(reminderData.chatId),
    senderId: String(reminderData.senderId || ''),
    senderName: reminderData.senderName || 'Bạn',
    chatType: reminderData.chatType || 'PRIVATE',
    content: reminderData.content,
    remindAt: Number(reminderData.remindAt),
    repeat: reminderData.repeat || 'none', // 'daily' | 'weekly' | 'none'
    targetTime: reminderData.targetTime || null,
    createdAt: Date.now()
  };

  reminders.push(newReminder);
  await saveAllReminders(reminders);
  return newReminder;
}

/**
 * Lấy các nhắc hẹn đã đến giờ gửi (remindAt <= Date.now())
 * @returns {Promise<Array>}
 */
async function getDueReminders() {
  const now = Date.now();
  const reminders = await getAllReminders();
  return reminders.filter(r => Number(r.remindAt) <= now);
}

/**
 * Đánh dấu nhắc hẹn đã gửi xong
 * - Nếu là nhắc hẹn lặp lại (daily / weekly): Tự động tính toán mốc tiếp theo và dời lịch sang chu kỳ mới
 * - Nếu là nhắc hẹn 1 lần: Xóa khỏi danh sách chờ
 * @param {string} reminderId
 */
async function markReminderSent(reminderId) {
  const reminders = await getAllReminders();
  const updated = [];

  for (const r of reminders) {
    if (r.id !== reminderId) {
      updated.push(r);
      continue;
    }

    // Xử lý lịch lặp lại
    if (r.repeat === 'daily') {
      const nextDate = new Date(Number(r.remindAt));
      nextDate.setDate(nextDate.getDate() + 1);
      // Đảm bảo mốc thời gian tiếp theo nằm ở tương lai so với hiện tại
      while (nextDate.getTime() <= Date.now()) {
        nextDate.setDate(nextDate.getDate() + 1);
      }
      r.remindAt = nextDate.getTime();
      r.lastSentAt = Date.now();
      updated.push(r);
      console.log(`🔁 [Reminder Recurring] Đã dời lịch lặp lại hàng ngày "${r.content}" sang: ${nextDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
    } else if (r.repeat === 'weekly') {
      const nextDate = new Date(Number(r.remindAt));
      nextDate.setDate(nextDate.getDate() + 7);
      while (nextDate.getTime() <= Date.now()) {
        nextDate.setDate(nextDate.getDate() + 7);
      }
      r.remindAt = nextDate.getTime();
      r.lastSentAt = Date.now();
      updated.push(r);
      console.log(`🔁 [Reminder Recurring] Đã dời lịch lặp lại hàng tuần "${r.content}" sang: ${nextDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
    } else {
      // Nhắc hẹn 1 lần -> không push vào updated (tương đương xóa)
      console.log(`🗑️ [Reminder Once] Đã hoàn thành và xóa lịch nhắc 1 lần "${r.content}"`);
    }
  }

  await saveAllReminders(updated);
}

/**
 * Lấy danh sách nhắc hẹn đang chờ của một cuộc trò chuyện hoặc người dùng
 * @param {string|number} chatId
 * @param {string|number} [senderId]
 * @returns {Promise<Array>}
 */
async function getChatReminders(chatId, senderId = null) {
  const idStr = String(chatId || '');
  const senderStr = senderId ? String(senderId) : null;
  const now = Date.now();
  const reminders = await getAllReminders();
  return reminders
    .filter(r => {
      const matchChat = idStr && String(r.chatId) === idStr;
      const matchSender = senderStr && String(r.senderId) === senderStr;
      return (matchChat || matchSender) && Number(r.remindAt) > now;
    })
    .sort((a, b) => a.remindAt - b.remindAt);
}

/**
 * Xóa/Hủy một nhắc hẹn cụ thể
 * @param {string} reminderId
 * @param {string|number} chatId
 * @returns {Promise<boolean>}
 */
async function deleteReminder(reminderId, chatId) {
  const idStr = String(chatId);
  const reminders = await getAllReminders();
  const initialLength = reminders.length;
  const filtered = reminders.filter(r => !(r.id === reminderId && String(r.chatId) === idStr));
  if (filtered.length !== initialLength) {
    await saveAllReminders(filtered);
    return true;
  }
  return false;
}

/**
 * Xóa/Hủy tất cả nhắc hẹn của một cuộc trò chuyện (hoặc của người tạo cụ thể)
 * @param {string|number} chatId
 * @param {string|number} [senderId]
 * @returns {Promise<number>} Số lượng nhắc hẹn đã xóa
 */
async function clearChatReminders(chatId, senderId = null) {
  const idStr = String(chatId || '');
  const senderStr = senderId ? String(senderId) : null;
  const reminders = await getAllReminders();
  const initialLength = reminders.length;
  const filtered = reminders.filter(r => {
    const matchChat = idStr && String(r.chatId) === idStr;
    const matchSender = senderStr && String(r.senderId) === senderStr;
    return !(matchChat || matchSender);
  });
  const deletedCount = initialLength - filtered.length;
  if (deletedCount > 0) {
    await saveAllReminders(filtered);
  }
  return deletedCount;
}

// ==========================================
// QUẢN LÝ DANH SÁCH CHẶN (BLACKLIST)
// ==========================================
const REDIS_BLOCKED_KEY = 'zalo:blocked:list';
let memoryBlocked = [];

/**
 * Lấy danh sách ID người dùng bị chặn (kết hợp Redis và .env)
 * @returns {Promise<Array<{ id: string, name?: string, blockedAt?: number }>>}
 */
async function getBlockedUsers() {
  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    const raw = await callRedisCommand('GET', REDIS_BLOCKED_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {}
    }
  }
  return memoryBlocked;
}

/**
 * Thêm người dùng vào danh sách chặn
 * @param {string} userId
 * @param {string} [userName]
 * @returns {Promise<boolean>}
 */
async function addBlockedUser(userId, userName = '') {
  const idStr = String(userId).trim();
  if (!idStr) return false;
  const current = await getBlockedUsers();
  if (!current.some(u => (typeof u === 'string' ? u : u.id) === idStr)) {
    current.push({ id: idStr, name: userName, blockedAt: Date.now() });
    memoryBlocked = current;
    if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
      await callRedisCommand('SET', REDIS_BLOCKED_KEY, JSON.stringify(current));
    }
  }
  return true;
}

/**
 * Gỡ người dùng khỏi danh sách chặn
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function removeBlockedUser(userId) {
  const idStr = String(userId).trim();
  const current = await getBlockedUsers();
  const filtered = current.filter(u => (typeof u === 'string' ? u : u.id) !== idStr);
  memoryBlocked = filtered;
  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    await callRedisCommand('SET', REDIS_BLOCKED_KEY, JSON.stringify(filtered));
  }
  if (Array.isArray(config.blockedUserIds)) {
    config.blockedUserIds = config.blockedUserIds.filter(id => id !== idStr);
  }
  return true;
}

/**
 * Kiểm tra xem người dùng có bị chặn hay không
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isUserBlocked(userId) {
  const idStr = String(userId).trim();
  if (!idStr) return false;
  // Kiểm tra cấu hình tĩnh .env trước
  if (config.blockedUserIds && config.blockedUserIds.includes(idStr)) {
    return true;
  }
  // Kiểm tra danh sách động trên Redis
  const blockedList = await getBlockedUsers();
  return blockedList.some(u => (typeof u === 'string' ? u : u.id) === idStr);
}

/**
 * Lưu URL ảnh gần nhất của cuộc trò chuyện (để hỗ trợ người dùng reply ảnh hoặc hỏi sau khi gửi ảnh)
 * @param {string|number} chatId
 * @param {string} photoUrl
 * @param {object} meta Thông tin thêm (caption, senderName, time)
 */
async function setLastImageUrl(chatId, photoUrl, meta = {}) {
  if (!chatId || !photoUrl) return;
  const idStr = String(chatId);
  const data = { photoUrl, ...meta, timestamp: Date.now() };

  memoryLastImages.set(idStr, data);

  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    const key = `zalo:last_img:${idStr}`;
    await callRedisCommand('SET', key, JSON.stringify(data), 'EX', LAST_IMAGE_TTL_SECONDS);
  }
}

/**
 * Lấy URL ảnh gần nhất của cuộc trò chuyện
 * @param {string|number} chatId
 * @returns {Promise<string|null>}
 */
async function getLastImageUrl(chatId) {
  if (!chatId) return null;
  const idStr = String(chatId);

  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    const key = `zalo:last_img:${idStr}`;
    const raw = await callRedisCommand('GET', key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.photoUrl) return parsed.photoUrl;
      } catch (e) {}
    }
  }

  const mem = memoryLastImages.get(idStr);
  return mem?.photoUrl || null;
}

// ==========================================
// QUẢN LÝ TRẠNG THÁI XÚC PHẠM & COOLDOWN 15 PHÚT
// ==========================================

/**
 * Lấy trạng thái xúc phạm của người dùng trong cuộc trò chuyện
 * @param {string|number} chatId
 * @param {string|number} [senderId]
 * @returns {Promise<{ count: number, lastTime: number, cooldownUntil: number, inCooldown: boolean, cooldownRemainingMinutes: number }>}
 */
async function getInsultState(chatId, senderId) {
  const sid = String(senderId || chatId);
  const key = `zalo:insult:${chatId}:${sid}`;
  const now = Date.now();
  let state = null;

  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    const raw = await callRedisCommand('GET', key);
    if (raw) {
      try {
        state = JSON.parse(raw);
      } catch (e) {}
    }
  }

  if (!state) {
    state = memoryInsults.get(key) || { count: 0, lastTime: 0, cooldownUntil: 0 };
  }

  // Kiểm tra hết hạn cooldown 15 phút
  if (state.cooldownUntil > 0 && now >= state.cooldownUntil) {
    state = { count: 0, lastTime: 0, cooldownUntil: 0 };
    memoryInsults.set(key, state);
    if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
      await callRedisCommand('DEL', key);
    }
  } else if (state.cooldownUntil === 0 && state.count > 0 && (now - state.lastTime > INSULT_COOLDOWN_SECONDS * 1000)) {
    // Nếu quá 15 phút không tiếp tục xúc phạm, reset lại chu kỳ
    state = { count: 0, lastTime: 0, cooldownUntil: 0 };
    memoryInsults.set(key, state);
    if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
      await callRedisCommand('DEL', key);
    }
  }

  const inCooldown = state.cooldownUntil > now;
  const cooldownRemainingMinutes = inCooldown ? Math.ceil((state.cooldownUntil - now) / 60000) : 0;

  return {
    ...state,
    inCooldown,
    cooldownRemainingMinutes
  };
}

/**
 * Ghi nhận một lượt xúc phạm từ người dùng
 * @param {string|number} chatId
 * @param {string|number} senderId
 * @param {number} [detectedTurn] Lượt xúc phạm (1, 2, 3)
 * @returns {Promise<{ ignored: boolean, count: number, cooldownUntil: number }>}
 */
async function recordInsultEvent(chatId, senderId, detectedTurn = null) {
  const sid = String(senderId || chatId);
  const key = `zalo:insult:${chatId}:${sid}`;
  const now = Date.now();
  const current = await getInsultState(chatId, senderId);

  if (current.inCooldown) {
    return { ignored: true, count: current.count, cooldownUntil: current.cooldownUntil };
  }

  let nextCount = detectedTurn || (current.count + 1);
  let cooldownUntil = 0;
  if (nextCount >= 3) {
    nextCount = 3;
    cooldownUntil = now + INSULT_COOLDOWN_SECONDS * 1000;
  }

  const newState = {
    count: nextCount,
    lastTime: now,
    cooldownUntil
  };

  memoryInsults.set(key, newState);
  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    await callRedisCommand('SET', key, JSON.stringify(newState), 'EX', INSULT_STATE_TTL_SECONDS);
  }

  return {
    ignored: false,
    count: nextCount,
    cooldownUntil
  };
}

/**
 * Xóa trạng thái xúc phạm của người dùng
 * @param {string|number} chatId
 * @param {string|number} [senderId]
 */
async function clearInsultState(chatId, senderId) {
  const sid = String(senderId || chatId);
  const key = `zalo:insult:${chatId}:${sid}`;
  memoryInsults.delete(key);
  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    await callRedisCommand('DEL', key);
  }
}

module.exports = {
  getConversationHistory,
  saveConversationHistory,
  clearConversationHistory,
  pushGroupMessage,
  getGroupMessages,
  clearGroupMessages,
  addReminder,
  getDueReminders,
  getAllReminders,
  markReminderSent,
  getChatReminders,
  deleteReminder,
  clearChatReminders,
  getBlockedUsers,
  addBlockedUser,
  removeBlockedUser,
  isUserBlocked,
  setLastImageUrl,
  getLastImageUrl,
  getInsultState,
  recordInsultEvent,
  clearInsultState
};



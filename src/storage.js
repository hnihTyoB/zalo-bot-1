const config = require('./config');

// Bộ nhớ RAM dự phòng khi không cấu hình Redis hoặc chạy local
const memoryConversations = new Map();
const memoryGroupBuffers = new Map();
let memoryReminders = [];

const MAX_HISTORY_MESSAGES = 10;
const MAX_GROUP_BUFFER = 50;
const CONVERSATION_TTL_SECONDS = 86400; // 24 giờ
const GROUP_BUFFER_TTL_SECONDS = 43200; // 12 giờ
const REDIS_REMINDERS_KEY = 'zalo:reminders:list';

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
 * @param {{ chatId: string, senderId: string, senderName: string, chatType: string, content: string, remindAt: number }} reminderData
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
 * Đánh dấu nhắc hẹn đã gửi xong (xóa khỏi danh sách chờ)
 * @param {string} reminderId
 */
async function markReminderSent(reminderId) {
  const reminders = await getAllReminders();
  const remaining = reminders.filter(r => r.id !== reminderId);
  await saveAllReminders(remaining);
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

module.exports = {
  getConversationHistory,
  saveConversationHistory,
  clearConversationHistory,
  pushGroupMessage,
  getGroupMessages,
  clearGroupMessages,
  addReminder,
  getDueReminders,
  markReminderSent,
  getChatReminders,
  deleteReminder,
  clearChatReminders
};


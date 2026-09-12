const config = require('./config');

// Bộ nhớ RAM dự phòng khi không cấu hình Redis hoặc chạy local
const memoryConversations = new Map();
const memoryGroupBuffers = new Map();

const MAX_HISTORY_MESSAGES = 10;
const MAX_GROUP_BUFFER = 50;
const CONVERSATION_TTL_SECONDS = 86400; // 24 giờ
const GROUP_BUFFER_TTL_SECONDS = 43200; // 12 giờ

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
      body: JSON.stringify(args)
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

module.exports = {
  getConversationHistory,
  saveConversationHistory,
  clearConversationHistory,
  pushGroupMessage,
  getGroupMessages,
  clearGroupMessages
};

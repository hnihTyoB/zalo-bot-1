const config = require('./config');

const BASE_URL = `${config.zaloApiBaseUrl}/bot${config.zaloBotToken}`;

/**
 * Gọi API Zalo Bot
 */
async function callApi(endpoint, body = {}) {
  const url = `${BASE_URL}/${endpoint}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`❌ Lỗi gọi Zalo API [${endpoint}]:`, error.message);
    throw error;
  }
}

/**
 * Kiểm tra thông tin bot và token
 */
async function getMe() {
  return await callApi('getMe', {});
}

/**
 * Hiển thị trạng thái đang soạn tin nhắn (typing...)
 * @param {string} chatId
 * @param {'typing'|'upload_photo'} action
 */
async function sendChatAction(chatId, action = 'typing') {
  try {
    return await callApi('sendChatAction', {
      chat_id: String(chatId),
      action
    });
  } catch (err) {
    // Không ném lỗi nếu chỉ là lỗi hiển thị typing
    return null;
  }
}

/**
 * Gửi tin nhắn văn bản đến người dùng hoặc nhóm
 * @param {string} chatId
 * @param {string} text
 * @param {'markdown'|'html'|null} parseMode
 */
async function sendMessage(chatId, text, parseMode = 'markdown') {
  // Giới hạn Zalo là 2000 ký tự. Cắt nhỏ nếu quá dài
  const MAX_LEN = 1900;

  if (text.length <= MAX_LEN) {
    const payload = {
      chat_id: String(chatId),
      text
    };
    if (parseMode) {
      payload.parse_mode = parseMode;
    }
    return await callApi('sendMessage', payload);
  }

  // Nếu tin nhắn dài hơn 1900 ký tự, tách theo dòng hoặc đoạn
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LEN) {
      chunks.push(remaining);
      break;
    }
    // Tìm điểm ngắt dòng tự nhiên gần nhất
    let splitIndex = remaining.lastIndexOf('\n', MAX_LEN);
    if (splitIndex === -1 || splitIndex < 500) {
      splitIndex = MAX_LEN;
    }
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trim();
  }

  let lastRes = null;
  for (const chunk of chunks) {
    const payload = {
      chat_id: String(chatId),
      text: chunk
    };
    if (parseMode) payload.parse_mode = parseMode;
    lastRes = await callApi('sendMessage', payload);
  }
  return lastRes;
}

/**
 * Nhận tin nhắn mới theo cơ chế Long Polling
 * @param {number} timeout Thời gian chờ tính bằng giây
 */
async function getUpdates(timeout = 30) {
  return await callApi('getUpdates', { timeout });
}

/**
 * Đăng ký Webhook URL
 */
async function setWebhook(url, secretToken) {
  return await callApi('setWebhook', {
    url,
    secret_token: secretToken || config.webhookSecretToken
  });
}

/**
 * Xóa cấu hình Webhook (để chuyển lại Polling)
 */
async function deleteWebhook() {
  return await callApi('deleteWebhook', {});
}

/**
 * Lấy thông tin cấu hình Webhook hiện tại
 */
async function getWebhookInfo() {
  return await callApi('getWebhookInfo', {});
}

module.exports = {
  getMe,
  sendMessage,
  sendChatAction,
  getUpdates,
  setWebhook,
  deleteWebhook,
  getWebhookInfo
};

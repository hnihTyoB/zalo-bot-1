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
    if (!data.ok) {
      console.error(`❌ Zalo API error [${endpoint}]:`, JSON.stringify(data));
    }
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

/**
 * Định dạng văn bản màu sắc theo chuẩn Zalo Markdown
 */
const formatStyles = {
  green: (text) => `{green}${text}{/green}`,
  red: (text) => `{red}${text}{/red}`,
  orange: (text) => `{orange}${text}{/orange}`,
  yellow: (text) => `{yellow}${text}{/yellow}`,
  big: (text) => `{big}${text}{/big}`,
  underline: (text) => `{underline}${text}{/underline}`,
  bold: (text) => `**${text}**`
};

/**
 * Trích xuất đường dẫn ảnh thông minh từ mọi cấu trúc dữ liệu của Zalo
 */
function findImageUrl(data, eventData, msg) {
  // 1. Kiểm tra trực tiếp trên msg
  if (typeof msg?.photo === 'string' && msg.photo.startsWith('http')) return msg.photo;
  if (typeof msg?.url === 'string' && msg.url.startsWith('http')) return msg.url;
  if (typeof msg?.image === 'string' && msg.image.startsWith('http')) return msg.image;
  if (typeof msg?.image_url === 'string' && msg.image_url.startsWith('http')) return msg.image_url;
  if (typeof msg?.link === 'string' && msg.link.startsWith('http')) return msg.link;

  // 2. Kiểm tra nếu là object
  if (msg?.photo && typeof msg.photo.url === 'string') return msg.photo.url;
  if (msg?.image && typeof msg.image.url === 'string') return msg.image.url;

  // 3. Kiểm tra mảng ảnh
  if (Array.isArray(msg?.photo) && msg.photo.length > 0) {
    const p = msg.photo[0];
    if (typeof p === 'string' && p.startsWith('http')) return p;
    if (p?.url && typeof p.url === 'string') return p.url;
  }
  if (Array.isArray(msg?.images) && msg.images.length > 0) {
    const p = msg.images[0];
    if (typeof p === 'string' && p.startsWith('http')) return p;
    if (p?.url && typeof p.url === 'string') return p.url;
  }
  if (Array.isArray(msg?.photos) && msg.photos.length > 0) {
    const p = msg.photos[0];
    if (typeof p === 'string' && p.startsWith('http')) return p;
    if (p?.url && typeof p.url === 'string') return p.url;
  }

  // 4. Attachments (Định dạng phổ biến trên Zalo Web / Messenger)
  if (Array.isArray(msg?.attachments) && msg.attachments.length > 0) {
    for (const att of msg.attachments) {
      if (typeof att === 'string' && att.startsWith('http')) return att;
      if (typeof att?.url === 'string') return att.url;
      if (typeof att?.payload?.url === 'string') return att.payload.url;
    }
  }
  if (msg?.attachment) {
    if (typeof msg.attachment.url === 'string') return msg.attachment.url;
    if (typeof msg.attachment.payload?.url === 'string') return msg.attachment.payload.url;
  }

  // 5. Kiểm tra trên eventData và root data
  if (typeof eventData?.photo === 'string') return eventData.photo;
  if (typeof eventData?.url === 'string') return eventData.url;
  if (typeof data?.photo === 'string') return data.photo;
  if (typeof data?.url === 'string') return data.url;

  // 6. Quét đệ quy chuỗi JSON tìm bất kỳ URL ảnh nào (Zalo CDN: zadn.vn, zaloapp.com hoặc đuôi ảnh)
  try {
    const jsonStr = JSON.stringify(data || {});
    const urlMatch = jsonStr.match(/https?:\/\/[^"'\s\\]+(?:\.(?:jpg|jpeg|png|webp)|zadn\.vn\/[^\s"'\\]+|zaloapp\.com\/[^\s"'\\]+)/i);
    if (urlMatch) {
      return urlMatch[0];
    }
  } catch (e) {}

  return null;
}

module.exports = {
  getMe,
  sendMessage,
  sendChatAction,
  getUpdates,
  setWebhook,
  deleteWebhook,
  getWebhookInfo,
  formatStyles,
  findImageUrl
};

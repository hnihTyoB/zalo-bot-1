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
 * Gửi hình ảnh đến người dùng hoặc nhóm
 * @param {string} chatId
 * @param {string} photoUrl URL công khai của hình ảnh
 * @param {string} [caption] Chú thích kèm theo ảnh
 * @param {'markdown'|'html'|null} [parseMode]
 */
async function sendPhoto(chatId, photoUrl, caption = '', parseMode = 'markdown') {
  const payload = {
    chat_id: String(chatId),
    photo: String(photoUrl)
  };
  if (caption) {
    payload.caption = caption;
    if (parseMode) {
      payload.parse_mode = parseMode;
    }
  }
  return await callApi('sendPhoto', payload);
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

/**
 * Trích xuất người dùng mục tiêu một cách thông minh và toàn diện
 * Phục vụ các lệnh quản trị: /block, /unblock, /id, /whois
 */
function resolveTargetUser({
  rawText = '',
  cmdParam = '',
  msg = {},
  eventData = {},
  data = {},
  senderId = '',
  botId = '',
  groupMessages = []
}) {
  let targetId = '';
  let targetName = '';

  // 1. Kiểm tra ID rõ ràng trong tham số lệnh hoặc trong nội dung tin nhắn (chuỗi 8-45 ký tự)
  if (cmdParam && !cmdParam.startsWith('@') && /^[a-zA-Z0-9_-]{8,45}$/.test(cmdParam)) {
    targetId = cmdParam;
  }

  if (!targetId) {
    const idCandidates = rawText.match(/\b([a-zA-Z0-9_-]{12,45})\b/g) || [];
    for (const cand of idCandidates) {
      const lower = cand.toLowerCase();
      if (
        cand !== botId &&
        cand !== senderId &&
        !['block', 'unblock', 'blocklist', 'reminders', 'xoanhac', 'summary'].includes(lower)
      ) {
        if (/^[a-fA-F0-9]{16,40}$/.test(cand) || /^[a-zA-Z0-9_-]{12,45}$/.test(cand)) {
          targetId = cand;
          break;
        }
      }
    }
  }

  // 2. Kiểm tra quoted / reply message trên mọi cấu trúc payload khả dĩ của Zalo / Telegram
  const quoted = msg?.reply_to_message || msg?.quote || msg?.reply_to || msg?.quoted_message
              || eventData?.reply_to_message || eventData?.quote || eventData?.reply_to
              || data?.reply_to_message || data?.quote;

  if (quoted) {
    const qId = quoted.from?.id || quoted.from_id || quoted.sender_id || quoted.sender?.id
             || quoted.uid || quoted.user_id || quoted.owner_id || quoted.author?.id
             || quoted.message?.from?.id || quoted.msg?.from?.id;
    const qName = quoted.from?.display_name || quoted.from?.name || quoted.from_name
               || quoted.sender_name || quoted.sender?.name || quoted.display_name || quoted.name
               || quoted.from?.first_name;

    if (qId && String(qId) !== botId && String(qId) !== senderId) {
      if (!targetId) targetId = String(qId);
      if (!targetName && qName) targetName = String(qName);
    }

    // Nếu quoted có text, tìm người gửi tin nhắn có text đó trong groupMessages
    const qText = quoted.text || quoted.content || quoted.message?.text || quoted.msg?.text;
    if (!targetId && qText && groupMessages.length > 0) {
      const matchedMsg = groupMessages.slice().reverse().find(m =>
        m.senderId !== botId && m.senderId !== senderId && (m.text?.includes(qText) || qText.includes(m.text))
      );
      if (matchedMsg) {
        targetId = matchedMsg.senderId;
        targetName = matchedMsg.senderName;
      }
    }
  }

  // 3. Kiểm tra mảng mentions từ msg / eventData / data
  const mentions = msg?.mentions || eventData?.mentions || data?.mentions || msg?.entities || eventData?.entities;
  if (!targetId && Array.isArray(mentions)) {
    const validMention = mentions.find(m => {
      const uid = String(m.uid || m.user_id || m.id || m.user?.id || m.target_id || '');
      return uid && uid !== botId && uid !== senderId;
    });
    if (validMention) {
      targetId = String(validMention.uid || validMention.user_id || validMention.id || validMention.user?.id || validMention.target_id);
      targetName = validMention.display_name || validMention.name || validMention.user?.first_name || '';
    }
  }

  // 4. Nếu chưa có targetId, quét các tên được mention (@Tên) trong text
  // và so khớp với danh sách người gửi gần nhất trong groupMessages
  if (!targetId && groupMessages.length > 0) {
    const matches = [...rawText.matchAll(/@([^@/]+)/g)].map(m => m[1].trim());
    for (const mention of matches) {
      if (/(?:Bot\s*HTD\s*Media|Bot|HTD\s*Media)/i.test(mention)) continue;
      const tName = mention.toLowerCase();

      // Khớp chính xác trước
      let found = groupMessages.slice().reverse().find(m => {
        if (m.senderId === botId || m.senderId === senderId) return false;
        const sName = (m.senderName || '').toLowerCase();
        return sName === tName;
      });

      // Khớp một phần nếu không có khớp chính xác
      if (!found) {
        found = groupMessages.slice().reverse().find(m => {
          if (m.senderId === botId || m.senderId === senderId) return false;
          const sName = (m.senderName || '').toLowerCase();
          return sName.includes(tName) || tName.includes(sName);
        });
      }

      if (found) {
        targetId = found.senderId;
        targetName = found.senderName;
        break;
      }
    }
  }

  // 5. Nếu là thao tác Reply (có quoted object) nhưng quoted không chứa ID người gửi:
  // Fallback lấy tin nhắn gần nhất của người khác (không phải admin, không phải bot) trong bộ đệm nhóm
  if (!targetId && quoted && groupMessages.length > 0) {
    const lastOtherMsg = groupMessages.slice().reverse().find(m => m.senderId !== botId && m.senderId !== senderId);
    if (lastOtherMsg) {
      targetId = lastOtherMsg.senderId;
      targetName = lastOtherMsg.senderName;
    }
  }

  // 6. Điền tên người dùng từ groupMessages nếu đã có ID nhưng chưa có tên hiển thị
  if (targetId && !targetName && groupMessages.length > 0) {
    const found = groupMessages.slice().reverse().find(m => m.senderId === targetId);
    if (found?.senderName) {
      targetName = found.senderName;
    }
  }

  return { targetId, targetName };
}

module.exports = {
  getMe,
  sendMessage,
  sendPhoto,
  sendChatAction,
  getUpdates,
  setWebhook,
  deleteWebhook,
  getWebhookInfo,
  formatStyles,
  findImageUrl,
  resolveTargetUser
};

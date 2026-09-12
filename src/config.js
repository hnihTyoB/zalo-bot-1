require('dotenv').config();

const adminIdsRaw = process.env.ADMIN_USER_IDS || process.env.ADMIN_USER_ID || '45d7169545c0ac9ef5d1';

// Lấy danh sách API Keys (hỗ trợ cả GEMINI_API_KEYS dạng chuỗi phân tách dấu phẩy và GEMINI_API_KEY đơn lẻ)
const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
const geminiApiKeys = [
  ...new Set(
    rawKeys
      .split(',')
      .map(k => k.trim())
      .filter(Boolean)
  )
];

const config = {
  zaloBotToken: process.env.ZALO_BOT_TOKEN,
  geminiApiKey: geminiApiKeys[0] || process.env.GEMINI_API_KEY || '',
  geminiApiKeys: geminiApiKeys,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-flash-latest',
  webhookSecretToken: process.env.WEBHOOK_SECRET_TOKEN || 'htd_secret_token_2026_secure',
  zaloApiBaseUrl: 'https://bot-api.zaloplatforms.com',
  adminUserIds: adminIdsRaw.split(',').map(id => id.trim()).filter(Boolean)
};

if (!config.zaloBotToken) {
  console.error('❌ Thiếu biến môi trường ZALO_BOT_TOKEN trong file .env');
}

if (config.geminiApiKeys.length === 0) {
  console.error('❌ Thiếu biến môi trường GEMINI_API_KEY hoặc GEMINI_API_KEYS trong file .env');
}

module.exports = config;

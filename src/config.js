require('dotenv').config();

const adminIdsRaw = process.env.ADMIN_USER_IDS || process.env.ADMIN_USER_ID || '45d7169545c0ac9ef5d1';

const config = {
  zaloBotToken: process.env.ZALO_BOT_TOKEN,
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  webhookSecretToken: process.env.WEBHOOK_SECRET_TOKEN || 'htd_secret_token_2026_secure',
  zaloApiBaseUrl: 'https://bot-api.zaloplatforms.com',
  adminUserIds: adminIdsRaw.split(',').map(id => id.trim()).filter(Boolean)
};

if (!config.zaloBotToken) {
  console.error('❌ Thiếu biến môi trường ZALO_BOT_TOKEN trong file .env');
}

if (!config.geminiApiKey) {
  console.error('❌ Thiếu biến môi trường GEMINI_API_KEY trong file .env');
}

module.exports = config;

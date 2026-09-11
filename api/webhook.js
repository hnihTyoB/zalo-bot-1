const { sendMessage, sendChatAction } = require('../src/zalo');
const { askGemini, clearHistory } = require('../src/gemini');
const config = require('../src/config');

module.exports = async (req, res) => {
  // Chỉ nhận phương thức POST từ Zalo Server
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // 1. Kiểm tra Secret Token bảo mật
  const secretHeader = req.headers['x-bot-api-secret-token'];
  if (secretHeader && config.webhookSecretToken && secretHeader !== config.webhookSecretToken) {
    console.warn('⚠️ Webhook bị từ chối do Secret Token không khớp');
    return res.status(403).json({ message: 'Unauthorized' });
  }

  const data = req.body;
  if (!data || !data.result) {
    return res.status(200).json({ ok: true, message: 'Ping received' });
  }

  const eventName = data.result.event_name;
  const msg = data.result.message;

  // Nếu không phải tin nhắn văn bản (ví dụ sự kiện kết nối thử nghiệm của Zalo)
  if (eventName !== 'message.text.received' || !msg || !msg.text) {
    return res.status(200).json({ ok: true });
  }

  const chatId = msg.chat?.id || msg.from?.id;
  const senderName = msg.from?.display_name || 'Bạn';
  let rawText = msg.text.trim();

  console.log(`📩 [Webhook] Nhận tin nhắn từ ${senderName} (${chatId}): "${rawText}"`);

  // 2. Xử lý các lệnh cơ bản
  if (rawText === '/start') {
    await sendMessage(
      chatId,
      `Xin chào **${senderName}**! 👋\n\nTôi là **Bot HTD Media**, trợ lý AI thông minh trên nền tảng Zalo.\n\nHãy hỏi tôi bất kỳ điều gì bạn muốn, hoặc gõ \`/help\` để xem trợ giúp!`
    );
    return res.status(200).json({ ok: true });
  }

  if (rawText === '/help') {
    const helpMsg = `🤖 **HƯỚNG DẪN SỬ DỤNG BOT HTD MEDIA**\n\n- \`/start\` : Lời chào và giới thiệu.\n- \`/help\` : Hướng dẫn sử dụng.\n- \`/reset\` : Xóa lịch sử trò chuyện để bắt đầu chủ đề mới.\n\n💬 Bạn có thể nhắn tin hỏi đáp kiến thức, dịch thuật, viết văn hoặc phân tích thông tin!`;
    await sendMessage(chatId, helpMsg);
    return res.status(200).json({ ok: true });
  }

  if (rawText === '/reset' || rawText === '/clear') {
    clearHistory(chatId);
    await sendMessage(chatId, '🧹 Đã xóa lịch sử trò chuyện thành công!');
    return res.status(200).json({ ok: true });
  }

  // 3. Gửi sang Gemini AI & phản hồi lại
  try {
    await sendChatAction(chatId, 'typing');
    const aiReply = await askGemini(chatId, rawText);
    await sendMessage(chatId, aiReply, 'markdown');
  } catch (err) {
    console.error('❌ Lỗi xử lý Webhook AI:', err.message);
    await sendMessage(chatId, '⚠️ Đã xảy ra lỗi khi xử lý câu hỏi của bạn. Vui lòng thử lại!');
  }

  return res.status(200).json({ ok: true });
};

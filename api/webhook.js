const { sendMessage, sendChatAction } = require('../src/zalo');
const { askGemini, clearHistory } = require('../src/gemini');
const config = require('../src/config');

module.exports = async (req, res) => {
  // 1. Health check qua GET để chẩn đoán nhanh môi trường Vercel
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      message: 'Zalo Bot Webhook is active and running',
      environment: {
        hasZaloBotToken: Boolean(config.zaloBotToken),
        hasGeminiApiKey: Boolean(config.geminiApiKey),
        geminiModel: config.geminiModel,
        hasWebhookSecret: Boolean(config.webhookSecretToken)
      }
    });
  }

  // Chỉ nhận phương thức POST từ Zalo Server
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // 2. Kiểm tra Secret Token nếu có
  const secretHeader = req.headers['x-bot-api-secret-token'];
  if (secretHeader && config.webhookSecretToken && secretHeader !== config.webhookSecretToken) {
    console.warn('⚠️ Webhook bị từ chối do Secret Token không khớp');
    return res.status(403).json({ message: 'Unauthorized' });
  }

  // 3. Parse body an toàn
  let data = req.body;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (err) {
      console.error('Lỗi parse JSON body:', err.message);
    }
  }

  if (!data) {
    return res.status(200).json({ ok: true, message: 'Empty body' });
  }

  // Lấy dữ liệu sự kiện từ result hoặc root
  const eventData = data.result || data;
  const eventName = eventData.event_name || data.event_name;
  const msg = eventData.message || data.message;

  // Nếu là ping kiểm tra từ Zalo
  if (!eventName && !msg) {
    return res.status(200).json({ ok: true, message: 'Ping verified' });
  }

  // Chỉ xử lý tin nhắn văn bản
  if (eventName !== 'message.text.received' || !msg || !msg.text) {
    return res.status(200).json({ ok: true, ignored: eventName });
  }

  const chatId = msg.chat?.id || msg.from?.id;
  const senderName = msg.from?.display_name || 'Bạn';
  let rawText = msg.text.trim();

  console.log(`📩 [Webhook] Nhận tin nhắn từ ${senderName} (${chatId}): "${rawText}"`);

  // 4. Xử lý các lệnh cơ bản
  if (rawText === '/start') {
    const zaloRes = await sendMessage(
      chatId,
      `Xin chào **${senderName}**! 👋\n\nTôi là **Bot HTD Media**, trợ lý AI thông minh trên nền tảng Zalo.\n\nHãy hỏi tôi bất kỳ điều gì bạn muốn, hoặc gõ \`/help\` để xem trợ giúp!`
    );
    return res.status(200).json({ ok: true, zalo: zaloRes });
  }

  if (rawText === '/help') {
    const helpMsg = `🤖 **HƯỚNG DẪN SỬ DỤNG BOT HTD MEDIA**\n\nTôi là trợ lý AI thông minh của HTD Media, luôn sẵn sàng hỗ trợ và giải đáp thắc mắc của bạn.\n\n📌 **Các lệnh cơ bản:**\n- \`/start\` : Bắt đầu và xem lời chào.\n- \`/help\` : Xem hướng dẫn sử dụng này.\n- \`/reset\` : Xóa ngữ cảnh của cuộc trò chuyện hiện tại để bắt đầu chủ đề mới.\n\n💬 **Cách trò chuyện:**\n- **Trong Chat 1-1:** Bạn chỉ cần gõ bất kỳ câu hỏi nào.\n- **Trong Nhóm Chat:** Hãy gõ \`@Bot HTD Media\` hoặc **Trả lời** tin nhắn của Bot để tôi trả lời bạn nhé!`;
    const zaloRes = await sendMessage(chatId, helpMsg);
    return res.status(200).json({ ok: true, zalo: zaloRes });
  }

  if (rawText === '/reset' || rawText === '/clear') {
    clearHistory(chatId);
    const zaloRes = await sendMessage(chatId, '🧹 Đã xóa lịch sử trò chuyện thành công! Giờ bạn có thể bắt đầu một chủ đề hoàn toàn mới.');
    return res.status(200).json({ ok: true, zalo: zaloRes });
  }

  // 5. Gửi sang Gemini AI & phản hồi lại
  try {
    await sendChatAction(chatId, 'typing');
    const aiReply = await askGemini(chatId, rawText);
    const zaloRes = await sendMessage(chatId, aiReply, 'markdown');
    return res.status(200).json({ ok: true, zalo: zaloRes });
  } catch (err) {
    console.error('❌ Lỗi xử lý Webhook AI:', err.message);
    await sendMessage(chatId, '⚠️ Đã xảy ra lỗi khi xử lý câu hỏi của bạn. Vui lòng thử lại!');
    return res.status(200).json({ ok: false, error: err.message });
  }
};

const { sendMessage, sendChatAction } = require('../src/zalo');
const {
  askGemini,
  askGeminiVision,
  summarizeGroupChat,
  parseReminderIntent,
  clearHistory,
} = require('../src/gemini');
const storage = require('../src/storage');
const { checkAndSendDueReminders } = require('../src/reminder-worker');
const config = require('../src/config');

const HELP_TEXT = `🤖 **HƯỚNG DẪN SỬ DỤNG BOT HTD MEDIA (AI ĐA NĂNG)**

Tôi là trợ lý AI thông minh của HTD Media, luôn sẵn sàng hỗ trợ và giải đáp thắc mắc của bạn.

📌 **Các lệnh cơ bản:**
- \`/start\` : Bắt đầu và xem lời chào.
- \`/help\` : Xem hướng dẫn sử dụng này.
- \`/reset\` : Xóa ngữ cảnh của cuộc trò chuyện hiện tại để bắt đầu chủ đề mới.
- \`/summary\` : (Dành cho Nhóm) Tóm tắt các nội dung thảo luận gần nhất, các quyết định và việc cần làm.
- \`/reminders\` : Xem danh sách các lịch nhắc hẹn đang chờ.

⏰ **Tạo Nhắc Hẹn Tự Động:**
- Bạn chỉ cần nói câu bình thường:
  + *"nhắc tôi 15 phút nữa gọi cho đối tác"*
  + *"nhắc nhóm 16h30 chiều nay nộp báo cáo"*
  + *"nhắc tôi 8h sáng mai kiểm tra server"*
- Đến đúng giờ, tôi sẽ chủ động nhắn tin Zalo cho bạn hoặc nhóm!

💬 **Khả năng khác:**
- **Đọc & Phân tích hình ảnh:** Bạn gửi ảnh (hóa đơn, bài tập, sơ đồ, tài liệu) kèm câu hỏi, tôi sẽ phân tích và giải đáp ngay.
- **Trong Nhóm Chat:** Hãy gõ \`@Bot HTD Media\` hoặc **Trả lời** tin nhắn của Bot để tôi hỗ trợ nhé!`;

module.exports = async (req, res) => {
  // 1. Health check qua GET để chẩn đoán nhanh môi trường Vercel
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      message: 'Zalo Bot Webhook is active and running',
      environment: {
        hasZaloBotToken: Boolean(config.zaloBotToken),
        hasGeminiApiKey: Boolean(config.geminiApiKey),
        totalGeminiKeys: config.geminiApiKeys?.length || 0,
        geminiModel: config.geminiModel,
        hasWebhookSecret: Boolean(config.webhookSecretToken),
        hasUpstashRedis: Boolean(config.upstashRedisRestUrl && config.upstashRedisRestToken)
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

  // Quét và kích hoạt các nhắc hẹn đến giờ trong nền
  checkAndSendDueReminders().catch(() => {});

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

  if (!msg) {
    return res.status(200).json({ ok: true, ignored: eventName });
  }

  const chatId = msg.chat?.id || msg.from?.id;
  const senderId = String(msg.from?.id || chatId || '');
  const senderName = msg.from?.display_name || 'Bạn';
  const chatType = msg.chat?.chat_type || 'PRIVATE';
  const isAdmin = config.adminUserIds.includes(senderId);

  // KIỂM TRA QUYỀN TRUY CẬP:
  // Nếu là chat riêng 1-1 và không phải Admin -> Chặn không phản hồi tự do
  if (chatType === 'PRIVATE' && !isAdmin) {
    console.log(`🚫 [BỊ CHẶN] Người dùng lạ ${senderName} (${senderId}) chat riêng.`);
    await sendMessage(
      chatId,
      '⚠️ Xin lỗi, Bot HTD Media hiện chỉ hoạt động trong các nhóm chat hoặc dành riêng cho Quản trị viên. Bạn vui lòng mời Bot vào nhóm để sử dụng nhé!'
    );
    return res.status(200).json({ ok: true, blocked: true });
  }

  // ==========================================
  // TRƯỜNG HỢP 1: XỬ LÝ HÌNH ẢNH (MULTIMODAL)
  // ==========================================
  if (eventName === 'message.image.received' && msg.photo) {
    const photoUrl = msg.photo;
    const caption = (msg.caption || '').trim();
    console.log(`🖼️ [Webhook][${chatType}] Nhận ảnh từ ${senderName} (${senderId}): "${caption}"`);

    if (chatType === 'GROUP') {
      await storage.pushGroupMessage(chatId, {
        senderName,
        senderId,
        text: `[Đã gửi 1 hình ảnh] ${caption}`,
        time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      });
    }

    await sendChatAction(chatId, 'typing');
    const typingTimer = setInterval(() => {
      sendChatAction(chatId, 'typing').catch(() => {});
    }, 2500);

    try {
      const aiReply = await askGeminiVision(chatId, caption, photoUrl);
      clearInterval(typingTimer);
      const zaloRes = await sendMessage(chatId, aiReply, 'markdown');
      return res.status(200).json({ ok: true, zalo: zaloRes });
    } catch (err) {
      clearInterval(typingTimer);
      console.error('❌ Lỗi xử lý Webhook Image AI:', err.message);
      await sendMessage(chatId, '⚠️ Đã xảy ra lỗi khi phân tích hình ảnh của bạn. Vui lòng thử lại!');
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

  // ==========================================
  // TRƯỜNG HỢP 2: XỬ LÝ TIN NHẮN VĂN BẢN
  // ==========================================
  if (eventName !== 'message.text.received' || !msg.text) {
    return res.status(200).json({ ok: true, ignored: eventName });
  }

  let rawText = msg.text.trim();
  console.log(`📩 [Webhook][${chatType}] Nhận tin nhắn từ ${senderName} (${senderId}): "${rawText}"`);

  // Lưu tin nhắn vào bộ đệm của nhóm
  if (chatType === 'GROUP') {
    await storage.pushGroupMessage(chatId, {
      senderName,
      senderId,
      text: rawText,
      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    });
  }

  // Xóa tên bot nếu được mention trong nhóm
  rawText = rawText.replace(/@?Bot HTD Media/gi, '').trim();

  // 4. Lệnh tóm tắt thảo luận nhóm (/summary)
  if (rawText.startsWith('/summary') || rawText.toLowerCase().includes('tóm tắt')) {
    await sendChatAction(chatId, 'typing');
    const typingTimer = setInterval(() => {
      sendChatAction(chatId, 'typing').catch(() => {});
    }, 2500);

    try {
      const recentMessages = await storage.getGroupMessages(chatId);
      if (recentMessages.length < 2) {
        clearInterval(typingTimer);
        const zaloRes = await sendMessage(
          chatId,
          '⚠️ Hiện chưa có đủ tin nhắn thảo luận gần đây trong nhóm để tóm tắt. Các thành viên hãy trao đổi thêm nhé!'
        );
        return res.status(200).json({ ok: true, zalo: zaloRes });
      }

      const summary = await summarizeGroupChat(recentMessages);
      clearInterval(typingTimer);
      const zaloRes = await sendMessage(chatId, summary, 'markdown');
      return res.status(200).json({ ok: true, zalo: zaloRes });
    } catch (err) {
      clearInterval(typingTimer);
      console.error('❌ Lỗi tóm tắt nhóm:', err.message);
      await sendMessage(chatId, '⚠️ Đã xảy ra lỗi khi tạo bản tóm tắt. Vui lòng thử lại!');
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

  // 5. Lệnh xem danh sách nhắc hẹn (/reminders)
  if (rawText === '/reminders' || rawText.toLowerCase() === 'lịch hẹn' || rawText.toLowerCase().includes('danh sách nhắc')) {
    const activeList = await storage.getChatReminders(chatId);
    if (activeList.length === 0) {
      const zaloRes = await sendMessage(chatId, '📅 Hiện tại bạn không có lịch nhắc hẹn nào đang chờ.');
      return res.status(200).json({ ok: true, zalo: zaloRes });
    }

    const lines = activeList.map((r, idx) => {
      const timeStr = new Date(r.remindAt).toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit'
      });
      return `${idx + 1}. ⏰ **${timeStr}**: ${r.content} _(Bởi: ${r.senderName})_`;
    });

    const msgReply = [
      '{big}{green}📅 DANH SÁCH LỊCH NHẮC HẸN ĐANG CHỜ{/green}{/big}',
      '',
      ...lines,
      '',
      '_Bot sẽ tự động gửi tin nhắn thông báo khi đến giờ hẹn nhé!_'
    ].join('\n');

    const zaloRes = await sendMessage(chatId, msgReply, 'markdown');
    return res.status(200).json({ ok: true, zalo: zaloRes });
  }

  // 6. Phân tích yêu cầu tạo nhắc hẹn tự động (Ví dụ: "nhắc tôi 15 phút nữa...")
  const reminderCheck = await parseReminderIntent(rawText);
  if (reminderCheck && reminderCheck.isReminder) {
    const saved = await storage.addReminder({
      chatId,
      senderId,
      senderName,
      chatType,
      content: reminderCheck.content,
      remindAt: reminderCheck.remindAt
    });

    const timeVN = new Date(saved.remindAt).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    console.log(`⏰ [Reminder] Đã lưu lịch nhắc: "${saved.content}" lúc ${timeVN} cho ${senderName}`);
    const zaloRes = await sendMessage(chatId, reminderCheck.confirmationMessage, 'markdown');
    return res.status(200).json({ ok: true, zalo: zaloRes, reminder: saved });
  }

  // 7. Xử lý các lệnh cơ bản
  if (rawText === '/start') {
    const zaloRes = await sendMessage(
      chatId,
      `Xin chào **${senderName}**! 👋\n\nTôi là **Bot HTD Media**, trợ lý AI thông minh trên nền tảng Zalo.\n\nHãy hỏi tôi bất kỳ điều gì, gửi hình ảnh để phân tích, hoặc đặt lịch nhắc hẹn (ví dụ: *"nhắc tôi 15 phút nữa nộp bài"*). Gõ \`/help\` để xem trợ giúp!`
    );
    return res.status(200).json({ ok: true, zalo: zaloRes });
  }

  if (rawText === '/help') {
    const zaloRes = await sendMessage(chatId, HELP_TEXT);
    return res.status(200).json({ ok: true, zalo: zaloRes });
  }

  if (rawText === '/reset' || rawText === '/clear') {
    await clearHistory(chatId);
    const zaloRes = await sendMessage(chatId, '🧹 Đã xóa lịch sử trò chuyện thành công! Giờ bạn có thể bắt đầu một chủ đề hoàn toàn mới.');
    return res.status(200).json({ ok: true, zalo: zaloRes });
  }

  // 8. Gửi sang Gemini AI & phản hồi lại
  await sendChatAction(chatId, 'typing');
  const typingTimer = setInterval(() => {
    sendChatAction(chatId, 'typing').catch(() => {});
  }, 2500);

  try {
    const aiReply = await askGemini(chatId, rawText);
    clearInterval(typingTimer);
    const zaloRes = await sendMessage(chatId, aiReply, 'markdown');
    return res.status(200).json({ ok: true, zalo: zaloRes });
  } catch (err) {
    clearInterval(typingTimer);
    console.error('❌ Lỗi xử lý Webhook AI:', err.message);
    await sendMessage(chatId, '⚠️ Đã xảy ra lỗi khi xử lý câu hỏi của bạn. Vui lòng thử lại!');
    return res.status(200).json({ ok: false, error: err.message });
  }
};

const {
  getMe,
  getWebhookInfo,
  deleteWebhook,
  getUpdates,
  sendMessage,
  sendChatAction,
} = require("./zalo");
const {
  askGemini,
  askGeminiVision,
  summarizeGroupChat,
  parseReminderIntent,
  clearHistory,
} = require("./gemini");
const storage = require("./storage");
const { checkAndSendDueReminders } = require("./reminder-worker");
const config = require("./config");

let isRunning = true;
let botInfo = null;

// Lệnh hỗ trợ
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

/**
 * Xử lý từng tin nhắn đến (văn bản hoặc hình ảnh)
 */
async function handleMessage(eventData) {
  if (!eventData) return;

  const eventName = eventData.event_name;
  const msg = eventData.message;

  if (!msg) {
    if (eventName === "message.unsupported.received") {
      console.log(
        "ℹ️ Nhận được tin nhắn từ nhóm đối tượng đặc biệt (được bảo vệ quyền riêng tư).",
      );
    }
    return;
  }

  const chatId = msg.chat?.id || msg.from?.id;
  const senderId = String(msg.from?.id || chatId || "");
  const senderName = msg.from?.display_name || "Bạn";
  const chatType = msg.chat?.chat_type || "PRIVATE";
  const isAdmin = config.adminUserIds.includes(senderId);

  // KIỂM TRA QUYỀN TRUY CẬP:
  // Nếu là chat riêng 1-1 và không phải Admin -> Chặn không phản hồi tự do
  if (chatType === "PRIVATE" && !isAdmin) {
    console.log(`🚫 [BỊ CHẶN] Người dùng lạ "${senderName}" (${senderId}) nhắn tin riêng.`);
    await sendMessage(
      chatId,
      "⚠️ Xin lỗi, Bot HTD Media hiện chỉ hoạt động trong các nhóm chat hoặc dành riêng cho Quản trị viên. Bạn vui lòng mời Bot vào nhóm để sử dụng nhé!",
    );
    return;
  }

  // ==========================================
  // TRƯỜNG HỢP 1: XỬ LÝ HÌNH ẢNH (MULTIMODAL)
  // ==========================================
  const photoUrl = msg.photo || msg.url || msg.image_url || msg.attachment?.url;
  if (eventName === "message.image.received" || photoUrl) {
    let caption = (msg.caption || msg.text || msg.description || "").trim();

    // Xóa tên Bot nếu được mention trong chú thích
    if (botInfo && caption.includes(botInfo.display_name)) {
      caption = caption
        .replace(new RegExp(`@?${botInfo.display_name}`, "gi"), "")
        .trim();
    }
    caption = caption.replace(/@?Bot HTD Media/gi, "").trim();

    console.log(`\n🖼️ [${chatType}] Nhận ảnh từ "${senderName}" (${senderId}). Câu hỏi/Chú thích: "${caption || '(không có câu hỏi)'}"`);

    // Lưu vào bộ đệm nhóm nếu là nhóm chat
    if (chatType === "GROUP") {
      await storage.pushGroupMessage(chatId, {
        senderName,
        senderId,
        text: `[Đã gửi 1 hình ảnh] ${caption}`,
        time: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
      });
    }

    await sendChatAction(chatId, "typing");
    const typingTimer = setInterval(() => {
      sendChatAction(chatId, "typing").catch(() => {});
    }, 2500);

    try {
      console.log("🤖 Đang gửi ảnh sang Gemini Multimodal Vision...");
      const aiReply = await askGeminiVision(chatId, caption, photoUrl);
      clearInterval(typingTimer);

      await sendMessage(chatId, aiReply, "markdown");
      console.log(`✅ Đã gửi phân tích ảnh thành công tới ${senderName}`);
    } catch (err) {
      clearInterval(typingTimer);
      console.error(`❌ Lỗi xử lý ảnh:`, err.message);
      await sendMessage(chatId, "⚠️ Đã xảy ra lỗi khi phân tích hình ảnh. Vui lòng thử lại!");
    }
    return;
  }

  // ==========================================
  // TRƯỜNG HỢP 2: XỬ LÝ TIN NHẮN VĂN BẢN
  // ==========================================
  if (eventName !== "message.text.received" || !msg.text) {
    return;
  }

  let rawText = msg.text.trim();
  console.log(`\n📩 [${chatType}] Tin nhắn từ "${senderName}" (${senderId}): "${rawText}"`);

  // Lưu tin nhắn vào bộ đệm của nhóm
  if (chatType === "GROUP") {
    await storage.pushGroupMessage(chatId, {
      senderName,
      senderId,
      text: rawText,
      time: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
    });
  }

  // Xóa tên bot nếu được mention trong group (ví dụ: "@Bot HTD Media xin chào")
  if (botInfo && rawText.includes(botInfo.display_name)) {
    rawText = rawText
      .replace(new RegExp(`@?${botInfo.display_name}`, "gi"), "")
      .trim();
  }

  // 1. Lệnh tóm tắt thảo luận nhóm (/summary)
  if (rawText.startsWith("/summary") || rawText.toLowerCase().includes("tóm tắt")) {
    await sendChatAction(chatId, "typing");
    const typingTimer = setInterval(() => {
      sendChatAction(chatId, "typing").catch(() => {});
    }, 2500);

    try {
      console.log(`📊 Đang trích xuất tin nhắn nhóm để tạo bản tóm tắt...`);
      const recentMessages = await storage.getGroupMessages(chatId);
      if (recentMessages.length < 2) {
        clearInterval(typingTimer);
        await sendMessage(
          chatId,
          "⚠️ Hiện chưa có đủ tin nhắn thảo luận gần đây trong nhóm để tóm tắt. Các thành viên hãy trò chuyện thêm nhé!",
        );
        return;
      }

      const summary = await summarizeGroupChat(recentMessages);
      clearInterval(typingTimer);
      await sendMessage(chatId, summary, "markdown");
      console.log(`✅ Đã gửi bản tóm tắt thảo luận nhóm thành công`);
      return;
    } catch (err) {
      clearInterval(typingTimer);
      console.error(`❌ Lỗi tóm tắt nhóm:`, err.message);
      await sendMessage(chatId, "⚠️ Đã có lỗi xảy ra khi tạo tóm tắt. Vui lòng thử lại!");
      return;
    }
  }

  // 2. Lệnh xem danh sách nhắc hẹn (/reminders)
  if (rawText === "/reminders" || rawText.toLowerCase() === "lịch hẹn" || rawText.toLowerCase().includes("danh sách nhắc")) {
    const activeList = await storage.getChatReminders(chatId);
    if (activeList.length === 0) {
      await sendMessage(chatId, "📅 Hiện tại không có lịch nhắc hẹn nào đang chờ.");
      return;
    }

    const lines = activeList.map((r, idx) => {
      const timeStr = new Date(r.remindAt).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit"
      });
      return `${idx + 1}. ⏰ **${timeStr}**: ${r.content} _(Bởi: ${r.senderName})_`;
    });

    const msgReply = [
      "{big}{green}📅 DANH SÁCH LỊCH NHẮC HẸN ĐANG CHỜ{/green}{/big}",
      "",
      ...lines,
      "",
      "_Bot sẽ tự động gửi tin nhắn thông báo khi đến giờ hẹn nhé!_"
    ].join("\n");

    await sendMessage(chatId, msgReply, "markdown");
    return;
  }

  // 3. Phân tích yêu cầu tạo nhắc hẹn tự động (Ví dụ: "nhắc tôi 15 phút nữa...")
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

    const timeVN = new Date(saved.remindAt).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    console.log(`⏰ [Reminder] Đã lưu lịch nhắc: "${saved.content}" lúc ${timeVN} cho ${senderName}`);
    await sendMessage(chatId, reminderCheck.confirmationMessage, "markdown");
    return;
  }

  // 4. Các lệnh hệ thống khác
  if (rawText === "/start") {
    const welcome = `Xin chào **${senderName}**! 👋\n\nTôi là **${botInfo?.display_name || "Bot HTD Media"}**, trợ lý AI thông minh chạy trên nền tảng Zalo.\n\nBạn có thể hỏi tôi bất kỳ điều gì, gửi ảnh để phân tích, hoặc đặt lịch nhắc hẹn (ví dụ: *"nhắc tôi 15 phút nữa nộp bài"*). Gõ \`/help\` để xem chi tiết!`;
    await sendMessage(chatId, welcome);
    return;
  }

  if (rawText === "/help") {
    await sendMessage(chatId, HELP_TEXT);
    return;
  }

  if (rawText === "/reset" || rawText === "/clear") {
    await clearHistory(chatId);
    await sendMessage(
      chatId,
      "🧹 Đã xóa lịch sử trò chuyện thành công! Giờ bạn có thể bắt đầu một chủ đề hoàn toàn mới.",
    );
    return;
  }

  if (!rawText) {
    await sendMessage(chatId, "Chào bạn! Bạn cần tôi giúp gì hôm nay?");
    return;
  }

  // 5. Xử lý hội thoại AI bình thường
  await sendChatAction(chatId, "typing");
  const typingTimer = setInterval(() => {
    sendChatAction(chatId, "typing").catch(() => {});
  }, 2500);

  try {
    console.log(`🤖 Đang xử lý câu trả lời AI...`);
    const aiReply = await askGemini(chatId, rawText);
    clearInterval(typingTimer);

    // Gửi phản hồi lại cho người dùng qua Zalo
    await sendMessage(chatId, aiReply, "markdown");
    console.log(`✅ Đã gửi phản hồi thành công tới ${senderName}`);
  } catch (err) {
    clearInterval(typingTimer);
    console.error(`❌ Lỗi xử lý tin nhắn:`, err.message);
    await sendMessage(
      chatId,
      "⚠️ Xin lỗi, đã có lỗi nhỏ xảy ra khi phản hồi. Vui lòng thử lại!",
    );
  }
}

/**
 * Vòng lặp Long Polling
 */
async function startPolling() {
  console.log("\n======================================================");
  console.log("🚀 KHỞI ĐỘNG ZALO BOT AI TRÊN CHẾ ĐỘ LONG POLLING");
  console.log("======================================================");

  try {
    // 1. Lấy thông tin Bot
    const meRes = await getMe();
    if (!meRes.ok) {
      console.error(
        "❌ Không thể xác thực Zalo Bot Token! Vui lòng kiểm tra lại trong .env",
      );
      return;
    }
    botInfo = meRes.result;
    console.log(
      `✅ Đã kết nối Zalo Bot: "${botInfo.display_name}" (@${botInfo.account_name})`,
    );

    // 2. Đảm bảo Webhook đã được giải phóng để getUpdates hoạt động
    const wh = await getWebhookInfo();
    if (wh.ok && wh.result?.url) {
      console.log(
        `ℹ️ Phát hiện Webhook cũ (${wh.result.url}). Đang hủy Webhook để chuyển sang Polling...`,
      );
      await deleteWebhook();
      console.log(`✅ Đã giải phóng Webhook thành công!`);
    }

    // 3. Khởi động tiến trình ngầm quét và gửi nhắc hẹn mỗi 15 giây
    console.log("⏰ Đã kích hoạt tiến trình kiểm tra nhắc hẹn tự động (mỗi 15 giây)...");
    setInterval(() => {
      checkAndSendDueReminders().catch(() => {});
    }, 15000);

    console.log(
      "🟢 Bot đã sẵn sàng nhận tin nhắn, hình ảnh & nhắc hẹn! Hãy nhắn tin cho bot trên Zalo.",
    );
    console.log("(Nhấn Ctrl + C để dừng bot bất cứ lúc nào)\n");

    // 4. Vòng lặp Polling
    while (isRunning) {
      try {
        const updateRes = await getUpdates(30);

        if (updateRes && updateRes.ok && updateRes.result) {
          const updates = Array.isArray(updateRes.result)
            ? updateRes.result
            : [updateRes.result];
          for (const item of updates) {
            await handleMessage(item);
          }
        }
      } catch (err) {
        console.error(
          "⚠️ Lỗi trong vòng lặp polling (đang thử lại sau 3s):",
          err.message,
        );
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  } catch (fatalErr) {
    console.error("❌ Lỗi nghiêm trọng:", fatalErr.message);
  }
}

// Bắt tín hiệu dừng chương trình gọn gàng
process.on("SIGINT", () => {
  console.log("\n🛑 Đang dừng Bot...");
  isRunning = false;
  process.exit(0);
});

startPolling();

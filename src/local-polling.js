const {
  getMe,
  getWebhookInfo,
  deleteWebhook,
  getUpdates,
  sendMessage,
  sendChatAction,
} = require("./zalo");
const { askGemini, clearHistory } = require("./gemini");
const config = require("./config");

let isRunning = true;
let botInfo = null;

// Lệnh hỗ trợ
const HELP_TEXT = `🤖 **HƯỚNG DẪN SỬ DỤNG BOT HTD MEDIA**

Tôi là trợ lý AI thông minh của HTD Media, luôn sẵn sàng hỗ trợ và giải đáp thắc mắc của bạn.

📌 **Các lệnh cơ bản:**
- \`/start\` : Bắt đầu và xem lời chào.
- \`/help\` : Xem hướng dẫn sử dụng này.
- \`/reset\` : Xóa ngữ cảnh của cuộc trò chuyện hiện tại để bắt đầu chủ đề mới.

💬 **Cách trò chuyện:**
- **Trong Chat 1-1:** Bạn chỉ cần gõ bất kỳ câu hỏi nào (toán học, lập trình, văn bản, kiến thức, dịch thuật...).
- **Trong Nhóm Chat:** Hãy gõ \`@Bot HTD Media\` hoặc **Trả lời** tin nhắn của Bot để tôi trả lời bạn nhé!`;

/**
 * Xử lý từng tin nhắn đến
 */
async function handleMessage(eventData) {
  if (!eventData) return;

  const eventName = eventData.event_name;
  const msg = eventData.message;

  // Chỉ xử lý tin nhắn văn bản
  if (eventName !== "message.text.received" || !msg || !msg.text) {
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
  let rawText = msg.text.trim();

  console.log(
    `\n📩 [${chatType}] Tin nhắn từ "${senderName}" (${senderId}): "${rawText}"`,
  );

  // KIỂM TRA QUYỀN TRUY CẬP:
  // Nếu là chat riêng 1-1 và không phải Admin -> Chặn không phản hồi tự do
  const isAdmin = config.adminUserIds.includes(senderId);
  if (chatType === "PRIVATE" && !isAdmin) {
    console.log(`🚫 [BỊ CHẶN] Người dùng lạ "${senderName}" (${senderId}) nhắn tin riêng.`);
    await sendMessage(
      chatId,
      "⚠️ Xin lỗi, Bot HTD Media hiện chỉ hoạt động trong các nhóm chat hoặc dành riêng cho Quản trị viên. Bạn vui lòng mời Bot vào nhóm để sử dụng nhé!",
    );
    return;
  }

  // Xóa tên bot nếu được mention trong group (ví dụ: "@Bot HTD Media xin chào")
  if (botInfo && rawText.includes(botInfo.display_name)) {
    rawText = rawText
      .replace(new RegExp(`@?${botInfo.display_name}`, "gi"), "")
      .trim();
  }

  // 1. Xử lý các lệnh hệ thống
  if (rawText === "/start") {
    const welcome = `Xin chào **${senderName}**! 👋\n\nTôi là **${botInfo?.display_name || "Bot HTD Media"}**, trợ lý AI thông minh chạy trên nền tảng Zalo.\n\nBạn có thể hỏi tôi bất kỳ điều gì, hoặc gõ \`/help\` để xem các lệnh hướng dẫn!`;
    await sendMessage(chatId, welcome);
    return;
  }

  if (rawText === "/help") {
    await sendMessage(chatId, HELP_TEXT);
    return;
  }

  if (rawText === "/reset" || rawText === "/clear") {
    clearHistory(chatId);
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

  // 2. Xử lý bằng Gemini AI
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

    console.log(
      "🟢 Bot đã sẵn sàng nhận tin nhắn! Hãy nhắn tin cho bot trên Zalo để thử nghiệm.",
    );
    console.log("(Nhấn Ctrl + C để dừng bot bất cứ lúc nào)\n");

    // 3. Vòng lặp Polling
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

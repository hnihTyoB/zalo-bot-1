const {
  sendMessage,
  sendPhoto,
  sendChatAction,
  findImageUrl,
  resolveTargetUser,
} = require("../src/zalo");
const {
  askGemini,
  askGeminiVision,
  summarizeGroupChat,
  parseReminderIntent,
  clearHistory,
  searchWebRealtime,
} = require("../src/gemini");
const storage = require("../src/storage");
const { checkAndSendDueReminders } = require("../src/reminder-worker");
const config = require("../src/config");

const HELP_TEXT = `🤖 **HƯỚNG DẪN SỬ DỤNG BOT HTD MEDIA (AI ĐA NĂNG)**

Tôi là trợ lý AI thông minh của HTD Media, luôn sẵn sàng hỗ trợ và giải đáp thắc mắc của bạn.

📌 **Các lệnh cơ bản:**
- \`/start\` : Bắt đầu và xem lời chào.
- \`/help\` : Xem hướng dẫn sử dụng này.
- \`/reset\` : Xóa ngữ cảnh của cuộc trò chuyện hiện tại để bắt đầu chủ đề mới.
- \`/summary\` : (Dành cho Nhóm) Tóm tắt các nội dung thảo luận gần nhất, các quyết định và việc cần làm.
- \`/reminders\` : Xem danh sách các lịch nhắc hẹn đang chờ.
- \`/xoanhac <STT>\` : (Quản trị viên) Hủy lịch nhắc hẹn theo số thứ tự (ví dụ: \`/xoanhac 1\` hoặc \`/xoanhac all\`).
- \`/id\` : Xem Zalo ID của bạn (hoặc reply tin nhắn của người khác kèm \`/id\` để xem ID của họ).
- \`/groupid\` : Xem Chat ID của nhóm chat hiện tại và trạng thái cấp phép.
- \`/stk\` : Xem thông tin tài khoản ngân hàng và mã QR chuyển khoản.

🛡️ **Quản Trị Nhóm (Dành riêng cho Quản trị viên):**
- \`/allowgroup\` : Cấp phép cho nhóm hiện tại hoạt động (hoặc \`/allowgroup <Chat_ID>\`).
- \`/disallowgroup\` : Hủy cấp phép nhóm hiện tại (hoặc \`/disallowgroup <Chat_ID>\`).
- \`/grouplist\` : Xem danh sách các nhóm chat đã được cấp phép.

⏰ **Tạo Nhắc Hẹn Tự Động (Dành riêng cho Quản trị viên):**
- Quản trị viên chỉ cần nói câu bình thường:
  + *"nhắc tôi 15 phút nữa gọi cho đối tác"*
  + *"nhắc nhóm 16h30 chiều nay nộp báo cáo"*
  + *"nhắc tôi 8h sáng mai kiểm tra server"*
- Đến đúng giờ, tôi sẽ chủ động nhắn tin Zalo cho bạn hoặc nhóm!

💬 **Khả năng khác:**
- **Đọc & Phân tích hình ảnh:** Bạn gửi ảnh (hóa đơn, bài tập, sơ đồ, tài liệu) kèm câu hỏi, tôi sẽ phân tích và giải đáp ngay.
- **Trong Nhóm Chat:** Hãy gõ \`@Bot HTD Media\` hoặc **Trả lời** tin nhắn của Bot để tôi hỗ trợ nhé!`;

module.exports = async (req, res) => {
  // 1. Health check qua GET để chẩn đoán nhanh môi trường Vercel
  if (req.method === "GET") {
    let liveSearchSnippet = '';
    try {
      liveSearchSnippet = await searchWebRealtime("hlv của MC");
    } catch (e) {
      liveSearchSnippet = `Error: ${e.message}`;
    }

    return res.status(200).json({
      status: "ok",
      message: "Zalo Bot Webhook is active and running",
      liveSearchSnippet: liveSearchSnippet.slice(0, 300),
      environment: {
        hasZaloBotToken: Boolean(config.zaloBotToken),
        hasGeminiApiKey: Boolean(config.geminiApiKey),
        totalGeminiKeys: config.geminiApiKeys?.length || 0,
        geminiModel: config.geminiModel,
        hasWebhookSecret: Boolean(config.webhookSecretToken),
        allowedGroupIdsCount: config.allowedGroupIds?.length || 0,
        hasUpstashRedis: Boolean(
          config.upstashRedisRestUrl && config.upstashRedisRestToken,
        ),
      },
    });
  }

  // Chỉ nhận phương thức POST từ Zalo Server
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  // 2. Kiểm tra Secret Token nếu có
  const secretHeader = req.headers["x-bot-api-secret-token"];
  if (
    secretHeader &&
    config.webhookSecretToken &&
    secretHeader !== config.webhookSecretToken
  ) {
    console.warn("⚠️ Webhook bị từ chối do Secret Token không khớp");
    return res.status(403).json({ message: "Unauthorized" });
  }

  // Quét và kích hoạt các nhắc hẹn đến giờ trong nền
  checkAndSendDueReminders().catch(() => {});

  // 3. Parse body an toàn
  let data = req.body;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (err) {
      console.error("Lỗi parse JSON body:", err.message);
    }
  }

  if (!data) {
    return res.status(200).json({ ok: true, message: "Empty body" });
  }

  // Lấy dữ liệu sự kiện từ result hoặc root
  const eventData = data.result || data;
  const eventName = eventData.event_name || data.event_name;
  const msg = eventData.message || data.message;

  // Nếu là ping kiểm tra từ Zalo
  if (!eventName && !msg) {
    return res.status(200).json({ ok: true, message: "Ping verified" });
  }

  if (!msg) {
    return res.status(200).json({ ok: true, ignored: eventName });
  }

  const chatId = msg.chat?.id || msg.from?.id;
  const senderId = String(msg.from?.id || chatId || "");
  const senderName = msg.from?.display_name || "Bạn";
  const chatType = msg.chat?.chat_type || "PRIVATE";
  const botId = config.zaloBotToken ? config.zaloBotToken.split(":")[0] : "";
  const isAdmin = config.adminUserIds.includes(senderId);
  const isBlocked = await storage.isUserBlocked(senderId);

  // KIỂM TRA BLACKLIST (DANH SÁCH BỊ CHẶN):
  if (isBlocked) {
    console.log(
      `🚫 [BLACKLIST] Bỏ qua tin nhắn từ người dùng bị chặn: ${senderName} (${senderId})`,
    );
    return res.status(200).json({ ok: true, blocked: true });
  }

  // KIỂM TRA QUYỀN TRUY CẬP:
  // Nếu là chat riêng 1-1 và không phải Admin -> Chặn không phản hồi tự do
  if (chatType === "PRIVATE" && !isAdmin) {
    console.log(
      `🚫 [BỊ CHẶN] Người dùng lạ ${senderName} (${senderId}) chat riêng.`,
    );
    await sendMessage(
      chatId,
      "⚠️ Xin lỗi, Bot HTD Media hiện chỉ hoạt động trong các nhóm chat hoặc dành riêng cho Quản trị viên. Bạn vui lòng mời Bot vào nhóm để sử dụng nhé!",
    );
    return res.status(200).json({ ok: true, blocked: true });
  }

  // KIỂM TRA QUYỀN TRUY CẬP CHO NHÓM CHAT (ALLOWED_GROUP_IDS & REDIS DYNAMIC WHITELIST):
  if (chatType === "GROUP") {
    const isAllowed = await storage.isGroupAllowed(chatId);
    if (!isAllowed) {
      const rawCheckText = (msg.text || msg.caption || "").trim();
      const cleanCheckText = rawCheckText
        .replace(/@?(?:Bot\s*HTD\s*Media|Bot|HTD\s*Media)\b/gi, "")
        .trim();

      const isIdCmd =
        /(?:^|\s)\/(?:id|myid|whois|groupid)(?:\s|$)/i.test(rawCheckText) ||
        /(?:^|\s)\/(?:id|myid|whois|groupid)(?:\s|$)/i.test(cleanCheckText) ||
        /^(?:xem\s+id|lấy\s+id|id\s+nhóm|chat\s+id|groupid|myid|id)$/i.test(cleanCheckText);

      const isGroupAdminCmd =
        /(?:^|\s)\/(?:allowgroup|addgroup|disallowgroup|removegroup|delgroup|grouplist|allowedgroups)(?:\s|$)/i.test(rawCheckText) ||
        /(?:^|\s)\/(?:allowgroup|addgroup|disallowgroup|removegroup|delgroup|grouplist|allowedgroups)(?:\s|$)/i.test(cleanCheckText);

      if (isIdCmd) {
        const reply = [
          "{big}{green}🆔 THÔNG TIN NHÓM CHAT{/green}{/big}",
          "",
          `🔑 **Chat ID của nhóm:** \`${chatId}\``,
          `💬 **Loại cuộc trò chuyện:** Group (Nhóm Zalo)`,
          `🛡️ **Trạng thái:** ⚠️ Nhóm này chưa được cấp phép hoạt động`,
          "",
          "💡 **CÁCH KÍCH HOẠT CHO BOT HOẠT ĐỘNG TRONG NHÓM NÀY:**",
          ...(isAdmin
            ? [
                "• **Cách 1 (Nhanh nhất - Kích hoạt tức thì):**",
                `  Gõ ngay lệnh sau trong nhóm này: 👉 \`/allowgroup\``,
                `  _(Bot sẽ tự động lưu vào Redis và kích hoạt ngay mà không cần sửa file hay redeploy!)_`,
                "",
                "• **Cách 2 (Cấu hình file .env):**",
                `  Thêm Chat ID \`${chatId}\` vào biến \`ALLOWED_GROUP_IDS\` trong file \`.env\` (phân tách bằng dấu phẩy nếu nhiều nhóm).`
              ]
            : [
                "• **Cách 1 (Nhanh nhất):** Nhờ Quản trị viên (@Admin) gõ lệnh sau ngay trong nhóm này:",
                `  👉 \`/allowgroup\``,
                "",
                "• **Cách 2:** Copy Chat ID \`${chatId}\` gửi cho Quản trị viên để thêm vào biến \`ALLOWED_GROUP_IDS\` trong file \`.env\` (phân tách bằng dấu phẩy)."
              ])
        ].join("\n");

        const zaloRes = await sendMessage(chatId, reply, "markdown");
        return res
          .status(200)
          .json({ ok: true, blocked_group: true, zalo: zaloRes });
      }

      // Nếu là Admin gõ lệnh quản trị nhóm (/allowgroup, /addgroup...) -> Cho phép đi tiếp xuống phần xử lý lệnh
      if (isAdmin && isGroupAdminCmd) {
        // Tiếp tục xuống dưới để xử lý lệnh Admin
      } else {
        console.log(
          `🚫 [GROUP CHƯA CẤP PHÉP] Bỏ qua tin nhắn từ nhóm "${chatId}" (không nằm trong ALLOWED_GROUP_IDS).`,
        );
        return res.status(200).json({ ok: true, blocked_group: true });
      }
    }
  }

  // ==========================================
  // TRƯỜNG HỢP 1: XỬ LÝ HÌNH ẢNH (MULTIMODAL)
  // ==========================================
  let photoUrl = findImageUrl(data, eventData, msg);

  // Kiểm tra nếu là thao tác Trả lời (Reply / Quote) tin nhắn có ảnh hoặc người dùng hỏi phân tích ảnh
  const quoted = msg?.reply_to_message || msg?.quote || msg?.reply_to || msg?.quoted_message
              || eventData?.reply_to_message || eventData?.quote || eventData?.reply_to
              || data?.reply_to_message || data?.quote;

  const rawUserText = (msg?.text || msg?.caption || '').trim();
  const isImageIntent = /^(?:hãy\s*)?(?:phân tích|đọc|dịch|xem|kiểm tra|quét|soi|nhận diện|trích xuất|ocr)(?:\s+(?:bức|tấm|hình|cái))?\s*(?:ảnh|hình|qr|bill|hóa đơn)(?:\s+này|\s+đó|\s+trên)?/i.test(rawUserText)
    || /phân tích ảnh|đọc ảnh|dịch ảnh|quét qr|đọc qr|ảnh này là gì|hình này là gì|đây là ảnh gì|hình gì đây/i.test(rawUserText);

  if (!photoUrl && (quoted || isImageIntent)) {
    // 1. Kiểm tra ảnh trong tin nhắn được trích dẫn (quoted)
    photoUrl = findImageUrl(quoted, quoted, quoted?.message || quoted);

    // 2. Nếu vẫn chưa có và người dùng có ý định phân tích ảnh hoặc quote có dấu hiệu là ảnh ([Hình ảnh])
    if (!photoUrl && (isImageIntent || quoted?.msg_type?.includes('photo') || quoted?.msg_type?.includes('image') || /\[Hình ảnh\]|\[Photo\]|\[Image\]/i.test(quoted?.text || ''))) {
      photoUrl = await storage.getLastImageUrl(chatId);
    }
  }

  if (eventName === "message.image.received" || photoUrl) {
    let caption = (msg?.caption || msg?.text || msg?.description || "").trim();
    caption = caption.replace(/@?Bot HTD Media/gi, "").trim();

    // Lưu ảnh gần nhất của chat để phục vụ các câu hỏi tiếp theo
    if (photoUrl) {
      await storage.setLastImageUrl(chatId, photoUrl, { senderName, senderId, caption });
    }

    console.log(
      `🖼️ [Webhook][${chatType}] Nhận ảnh từ ${senderName} (${senderId}). URL: ${photoUrl ? photoUrl.slice(0, 50) : "null"} | Câu hỏi: "${caption || "(không có câu hỏi)"}"`,
    );

    if (!photoUrl) {
      console.warn(
        "⚠️ Không tìm thấy URL ảnh trong payload:",
        JSON.stringify(eventData),
      );
      await sendMessage(
        chatId,
        "⚠️ Bot đã nhận được ảnh nhưng chưa lấy được liên kết tải từ Zalo. Bạn thử gửi lại ảnh nhé!",
      );
      return res.status(200).json({ ok: true, warning: "No photo URL found" });
    }

    if (chatType === "GROUP") {
      await storage.pushGroupMessage(chatId, {
        senderName,
        senderId,
        text: `[Đã gửi 1 hình ảnh] ${caption}`,
        time: new Date().toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
    }

    await sendChatAction(chatId, "typing");
    const typingTimer = setInterval(() => {
      sendChatAction(chatId, "typing").catch(() => {});
    }, 2500);

    try {
      const aiReply = await askGeminiVision(chatId, caption, photoUrl, { senderId, senderName });
      clearInterval(typingTimer);
      if (!aiReply || aiReply === '[IGNORE]' || aiReply.trim() === '') {
        console.log(`🔇 [PHỚT LỜ] Bot phớt lờ ảnh/tin nhắn xúc phạm từ ${senderName} (${senderId})`);
        return res.status(200).json({ ok: true, ignored: 'insult_cooldown' });
      }
      const isPureUrl = /^https?:\/\/[^\s]+$/i.test(aiReply.trim());
      const parseMode = isPureUrl ? null : "markdown";
      const zaloRes = await sendMessage(chatId, aiReply, parseMode);
      return res.status(200).json({ ok: true, zalo: zaloRes });
    } catch (err) {
      clearInterval(typingTimer);
      console.error("❌ Lỗi xử lý Webhook Image AI:", err.message);
      await sendMessage(
        chatId,
        "⚠️ Đã xảy ra lỗi khi phân tích hình ảnh của bạn. Vui lòng thử lại!",
      );
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

  // ==========================================
  // TRƯỜNG HỢP 2: XỬ LÝ TIN NHẮN VĂN BẢN
  // ==========================================
  if (eventName !== "message.text.received" || !msg.text) {
    return res.status(200).json({ ok: true, ignored: eventName });
  }

  let rawText = msg.text.trim();
  console.log(
    `📩 [Webhook][${chatType}] Nhận tin nhắn từ ${senderName} (${senderId}): "${rawText}"`,
  );

  // Lưu tin nhắn vào bộ đệm của nhóm
  if (chatType === "GROUP") {
    await storage.pushGroupMessage(chatId, {
      senderName,
      senderId,
      text: rawText,
      time: new Date().toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    });
  }

  // Xóa tên bot nếu được mention trong nhóm (@Bot HTD Media, @Bot, @HTD Media...)
  rawText = rawText
    .replace(/@?(?:Bot\s*HTD\s*Media|Bot|HTD\s*Media)\b/gi, "")
    .trim();

  // 3.5 Lệnh xem thông tin tài khoản ngân hàng & gửi mã QR chuyển khoản (/stk)
  const isStkCmd =
    rawText === "/stk" ||
    rawText.startsWith("/stk ") ||
    rawText.toLowerCase() === "stk" ||
    rawText.toLowerCase() === "xin stk" ||
    rawText.toLowerCase() === "cho xin stk" ||
    rawText.toLowerCase() === "số tài khoản" ||
    rawText.toLowerCase() === "so tai khoan" ||
    /(?:^|\s)\/stk(?:\s|$)/i.test(rawText);

  if (isStkCmd) {
    const photoUrl = "https://zalo-bot-1.vercel.app/stk.jpg";
    const fallbackPhotoUrl =
      "https://raw.githubusercontent.com/hnihTyoB/zalo-bot-1/main/public/stk.jpg";
    const caption = [
      "🏦 Sacombank",
      "🔢 070120022431",
      "👤 NGUYEN CHI THINH",
    ].join("\n");

    // Lưu ảnh STK làm ảnh gần nhất của chat
    await storage.setLastImageUrl(chatId, photoUrl, { senderName: 'Bot HTD Media', caption });

    await sendChatAction(chatId, "upload_photo");

    let zaloRes = null;
    try {
      zaloRes = await sendPhoto(chatId, photoUrl, caption);
      if (!zaloRes?.ok) {
        zaloRes = await sendPhoto(chatId, fallbackPhotoUrl, caption);
      }
    } catch (photoErr) {
      console.warn("⚠️ Lỗi gửi ảnh STK qua sendPhoto:", photoErr.message);
    }

    if (!zaloRes || !zaloRes.ok) {
      zaloRes = await sendMessage(chatId, caption, null);
    }

    return res.status(200).json({ ok: true, zalo: zaloRes });
  }

  // 4. Lệnh tóm tắt thảo luận nhóm (/summary)
  if (
    rawText.startsWith("/summary") ||
    rawText.toLowerCase().includes("tóm tắt")
  ) {
    await sendChatAction(chatId, "typing");
    const typingTimer = setInterval(() => {
      sendChatAction(chatId, "typing").catch(() => {});
    }, 2500);

    try {
      const recentMessages = await storage.getGroupMessages(chatId);
      if (recentMessages.length < 2) {
        clearInterval(typingTimer);
        const zaloRes = await sendMessage(
          chatId,
          "⚠️ Hiện chưa có đủ tin nhắn thảo luận gần đây trong nhóm để tóm tắt. Các thành viên hãy trao đổi thêm nhé!",
        );
        return res.status(200).json({ ok: true, zalo: zaloRes });
      }

      const summary = await summarizeGroupChat(recentMessages);
      clearInterval(typingTimer);
      const zaloRes = await sendMessage(chatId, summary, "markdown");
      return res.status(200).json({ ok: true, zalo: zaloRes });
    } catch (err) {
      clearInterval(typingTimer);
      console.error("❌ Lỗi tóm tắt nhóm:", err.message);
      await sendMessage(
        chatId,
        "⚠️ Đã xảy ra lỗi khi tạo bản tóm tắt. Vui lòng thử lại!",
      );
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

  // 5. Lệnh xem danh sách nhắc hẹn (/reminders)
  const lowerText = rawText.toLowerCase();
  const isViewRemindersCmd =
    rawText === "/reminders" ||
    rawText === "/reminder" ||
    rawText === "/remind" ||
    rawText === "/lich" ||
    rawText === "/lichnhac" ||
    rawText === "/lichhen" ||
    lowerText === "lịch hẹn" ||
    lowerText === "lịch nhắc" ||
    lowerText === "xem lịch hẹn" ||
    lowerText === "xem lịch nhắc" ||
    lowerText.includes("danh sách nhắc") ||
    lowerText.includes("danh sách lịch") ||
    lowerText.includes("lịch hẹn của") ||
    lowerText.includes("lịch nhắc của");

  if (isViewRemindersCmd) {
    const activeList = await storage.getChatReminders(chatId, senderId);
    if (activeList.length === 0) {
      const zaloRes = await sendMessage(
        chatId,
        "📅 Hiện tại bạn không có lịch nhắc hẹn nào đang chờ.",
      );
      return res.status(200).json({ ok: true, zalo: zaloRes });
    }

    const lines = activeList.map((r, idx) => {
      const timeStr = new Date(r.remindAt).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
      });
      const repeatBadge =
        r.repeat === "daily"
          ? " 🔁 _[Hàng ngày]_"
          : r.repeat === "weekly"
            ? " 🔁 _[Hàng tuần]_"
            : "";
      return `${idx + 1}. ⏰ **${timeStr}**${repeatBadge}: ${r.content} _(Bởi: ${r.senderName})_`;
    });

    const msgReply = [
      "{big}{green}📅 DANH SÁCH LỊCH NHẮC HẸN ĐANG CHỜ{/green}{/big}",
      "",
      ...lines,
      "",
      "💡 _Để hủy lịch nhắc, gõ:_ `/xoanhac <STT>` _(ví dụ: `/xoanhac 1`) hoặc_ `/xoanhac all`",
      "_Bot sẽ tự động gửi tin nhắn thông báo khi đến giờ hẹn nhé!_",
    ].join("\n");

    const zaloRes = await sendMessage(chatId, msgReply, "markdown");
    return res.status(200).json({ ok: true, zalo: zaloRes });
  }

  // 5.2 Xử lý HỦY / XÓA lịch nhắc hẹn
  const cancelCmdMatch = rawText.match(
    /^\/(?:xoanhac|huynhac|delnhac|delreminder|cancelreminder|xoalich|huylich)(?:\s+(.*))?$/i,
  );
  const allFirstMatch = lowerText.match(
    /^(?:hủy|xóa|bo|bỏ)\s+(?:tất cả|tat ca|toàn bộ|toan bo|hết|het|all)(?:\s+(?:các\s+)?(?:lịch\s*nhắc|nhắc\s*hẹn|lịch\s*hẹn|lịch|nhắc))?$/i,
  );
  const naturalMatch = lowerText.match(
    /^(?:hủy|xóa|bo|bỏ)\s+(?:lịch\s*nhắc|nhắc\s*hẹn|lịch\s*hẹn|lịch|nhắc)\s*(?:số\s*)?(\d+|all|tất cả|tat ca|toàn bộ|toan bo|hết|het)$/i,
  );
  const shortNumMatch = lowerText.match(
    /^(?:hủy|xóa|bo|bỏ)\s+(?:số\s*)?(\d+)$/i,
  );

  if (cancelCmdMatch || allFirstMatch || naturalMatch || shortNumMatch) {
    if (!isAdmin) {
      console.log(
        `🚫 [Cancel Reminder Blocked] ${senderName} (${senderId}) không phải Quản trị viên.`,
      );
      const zaloRes = await sendMessage(
        chatId,
        `⚠️ Xin lỗi **${senderName}**, chỉ có Quản trị viên mới có quyền hủy lịch nhắc hẹn!`,
      );
      return res.status(200).json({ ok: true, blocked: true, zalo: zaloRes });
    }

    let rawParam = "";
    if (cancelCmdMatch) rawParam = (cancelCmdMatch[1] || "").trim();
    else if (allFirstMatch) rawParam = "all";
    else if (naturalMatch) rawParam = naturalMatch[1].trim();
    else if (shortNumMatch) rawParam = shortNumMatch[1].trim();

    const activeList = await storage.getChatReminders(chatId, senderId);

    if (activeList.length === 0) {
      const zaloRes = await sendMessage(
        chatId,
        "📅 Hiện tại bạn không có lịch nhắc hẹn nào đang chờ để hủy.",
      );
      return res.status(200).json({ ok: true, zalo: zaloRes });
    }

    const isAll = [
      "all",
      "tất cả",
      "tat ca",
      "toàn bộ",
      "toan bo",
      "hết",
      "het",
    ].includes(rawParam.toLowerCase());
    if (isAll) {
      const deletedCount = await storage.clearChatReminders(chatId, senderId);
      const zaloRes = await sendMessage(
        chatId,
        `🗑️ **Đã hủy toàn bộ ${deletedCount} lịch nhắc hẹn đang chờ!**`,
      );
      return res.status(200).json({ ok: true, zalo: zaloRes, deletedCount });
    }

    // Nếu không nhập tham số
    if (!rawParam) {
      if (activeList.length === 1) {
        // Tự động xóa lịch duy nhất nếu chỉ có 1
        const target = activeList[0];
        await storage.deleteReminder(target.id, target.chatId);
        const timeStr = new Date(target.remindAt).toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Ho_Chi_Minh",
        });
        const dateStr = new Date(target.remindAt).toLocaleDateString("vi-VN", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: "Asia/Ho_Chi_Minh",
        });
        const reply = `🗑️ **Đã hủy lịch nhắc thành công!**\n\n📌 **Nội dung:** ${target.content}\n🕒 **Thời gian đã hẹn:** ${timeStr} ngày ${dateStr}`;
        const zaloRes = await sendMessage(chatId, reply);
        return res.status(200).json({ ok: true, zalo: zaloRes });
      } else {
        const reply = `💡 Bạn đang có **${activeList.length}** lịch nhắc hẹn đang chờ.\nVui lòng chỉ định số thứ tự cần hủy (ví dụ: \`/xoanhac 1\`) hoặc \`/xoanhac all\` để hủy tất cả.\nGõ \`/reminders\` để xem danh sách.`;
        const zaloRes = await sendMessage(chatId, reply);
        return res.status(200).json({ ok: true, zalo: zaloRes });
      }
    }

    const index = parseInt(rawParam, 10);
    if (isNaN(index) || index < 1 || index > activeList.length) {
      const reply = `⚠️ Không tìm thấy lịch nhắc số **${rawParam}**.\nHiện tại có **${activeList.length}** lịch hẹn đang chờ (gõ \`/reminders\` để kiểm tra danh sách).`;
      const zaloRes = await sendMessage(chatId, reply);
      return res.status(200).json({ ok: true, zalo: zaloRes });
    }

    const target = activeList[index - 1];
    await storage.deleteReminder(target.id, target.chatId);
    const timeStr = new Date(target.remindAt).toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Ho_Chi_Minh",
    });
    const dateStr = new Date(target.remindAt).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Asia/Ho_Chi_Minh",
    });
    const reply = `🗑️ **Đã hủy lịch nhắc thành công!**\n\n📌 **Nội dung:** ${target.content}\n🕒 **Thời gian đã hẹn:** ${timeStr} ngày ${dateStr}`;
    const zaloRes = await sendMessage(chatId, reply);
    return res
      .status(200)
      .json({ ok: true, zalo: zaloRes, deletedReminder: target });
  }

  // 6. Phân tích yêu cầu tạo nhắc hẹn tự động (Ví dụ: "nhắc tôi 15 phút nữa...")
  const reminderCheck = await parseReminderIntent(rawText);
  if (reminderCheck && reminderCheck.isReminder) {
    if (!isAdmin) {
      console.log(
        `🚫 [Reminder Blocked] ${senderName} (${senderId}) không phải Quản trị viên cố tạo nhắc hẹn.`,
      );
      const zaloRes = await sendMessage(
        chatId,
        `⚠️ Xin lỗi **${senderName}**, tính năng tạo lịch nhắc hẹn chỉ dành riêng cho Quản trị viên (@Admin)!`,
      );
      return res.status(200).json({ ok: true, blocked: true, zalo: zaloRes });
    }

    const saved = await storage.addReminder({
      chatId,
      senderId,
      senderName,
      chatType,
      content: reminderCheck.content,
      remindAt: reminderCheck.remindAt,
      repeat: reminderCheck.repeat || "none",
      targetTime: reminderCheck.targetTime || null,
    });

    const timeVN = new Date(saved.remindAt).toLocaleTimeString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
    });
    console.log(
      `⏰ [Reminder] Đã lưu lịch nhắc: "${saved.content}" lúc ${timeVN} cho ${senderName}`,
    );
    const zaloRes = await sendMessage(
      chatId,
      reminderCheck.confirmationMessage,
      "markdown",
    );
    return res.status(200).json({ ok: true, zalo: zaloRes, reminder: saved });
  }

  // 7. Xử lý các lệnh cơ bản
  if (rawText === "/start") {
    const zaloRes = await sendMessage(
      chatId,
      `Xin chào **${senderName}**! 👋\n\nTôi là **Bot HTD Media**, trợ lý AI thông minh trên nền tảng Zalo.\n\nHãy hỏi tôi bất kỳ điều gì, gửi hình ảnh để phân tích, hoặc đặt lịch nhắc hẹn (ví dụ: *"nhắc tôi 15 phút nữa nộp bài"*). Gõ \`/help\` để xem trợ giúp!`,
    );
    return res.status(200).json({ ok: true, zalo: zaloRes });
  }

  if (rawText === "/help") {
    const zaloRes = await sendMessage(chatId, HELP_TEXT);
    return res.status(200).json({ ok: true, zalo: zaloRes });
  }

  if (rawText === "/reset" || rawText === "/clear") {
    await clearHistory(chatId);
    const zaloRes = await sendMessage(
      chatId,
      "🧹 Đã xóa lịch sử trò chuyện thành công! Giờ bạn có thể bắt đầu một chủ đề hoàn toàn mới.",
    );
    return res.status(200).json({ ok: true, zalo: zaloRes });
  }

  // 7. Nhận diện lệnh quản trị (/id, /myid, /whois, /groupid, /block, /unblock, /blocklist, /allowgroup, /addgroup, /disallowgroup, /removegroup, /delgroup, /grouplist, /allowedgroups)
  // Hỗ trợ cả khi Zalo tự chèn "@Tên" lúc bấm Reply hoặc khi mention đồng thời @Tên @Bot HTD Media /block
  const cmdMatch = rawText.match(
    /(?:^|\s)\/(id|myid|whois|groupid|blocklist|block|unblock|allowgroup|addgroup|disallowgroup|removegroup|delgroup|grouplist|allowedgroups)(?:\s+(.*))?$/i,
  );
  const matchedCmd = cmdMatch ? "/" + cmdMatch[1].toLowerCase() : null;
  const cmdParam = cmdMatch && cmdMatch[2] ? cmdMatch[2].trim() : "";

  let targetId = "";
  let targetName = "";

  if (matchedCmd) {
    const groupMessages =
      chatType === "GROUP" ? await storage.getGroupMessages(chatId) : [];
    const resolved = resolveTargetUser({
      rawText: msg.text || rawText,
      cmdParam,
      msg,
      eventData,
      data,
      senderId,
      botId,
      groupMessages,
    });
    targetId = resolved.targetId;
    targetName = resolved.targetName;

    console.log(
      `🎯 [Webhook][Admin Command] "${matchedCmd}" bởi ${senderName} (${senderId}) | Target: "${targetName}" (${targetId || "không có ID"})`,
    );
  }

  if (
    matchedCmd === "/id" ||
    matchedCmd === "/myid" ||
    matchedCmd === "/whois" ||
    matchedCmd === "/groupid"
  ) {
    if (matchedCmd === "/groupid") {
      if (chatType !== "GROUP") {
        const zaloRes = await sendMessage(
          chatId,
          `💡 Lệnh \`/groupid\` dùng trong Nhóm Chat để xem ID nhóm. ID cá nhân của bạn là: \`${senderId}\``,
        );
        return res.status(200).json({ ok: true, zalo: zaloRes });
      }
      const isAllowed = await storage.isGroupAllowed(chatId);
      const reply = [
        "{big}{green}🆔 THÔNG TIN NHÓM CHAT{/green}{/big}",
        "",
        `🔑 **Chat ID của nhóm:** \`${chatId}\``,
        `💬 **Loại cuộc trò chuyện:** Group (Nhóm Zalo)`,
        `🛡️ **Trạng thái:** ${isAllowed ? "✅ Đã cấp phép hoạt động" : "⚠️ Chưa được cấp phép"}`,
        isAdmin
          ? "⭐ **Quyền hạn của bạn:** Quản trị viên (Admin)"
          : "👥 **Quyền hạn của bạn:** Thành viên",
        "",
        ...(isAllowed
          ? ["_💡 Nhóm này đã được cấp phép, Bot sẵn sàng phục vụ tất cả thành viên!_"]
          : [
              "💡 **CÁCH CẤP PHÉP HOẠT ĐỘNG:**",
              ...(isAdmin
                ? [
                    "• Gõ ngay: `/allowgroup` trong nhóm này để cấp phép tức thì.",
                    `• Hoặc thêm \`${chatId}\` vào \`ALLOWED_GROUP_IDS\` trong file \`.env\`.`
                  ]
                : [
                    "• Nhờ Quản trị viên (@Admin) gõ `/allowgroup` ngay trong nhóm này.",
                    `• Hoặc gửi Chat ID \`${chatId}\` cho Quản trị viên để thêm vào file \`.env\`.`
                  ])
            ])
      ].join("\n");
      const zaloRes = await sendMessage(chatId, reply, "markdown");
      return res.status(200).json({ ok: true, zalo: zaloRes });
    }

    if (targetId) {
      const isTargetAdmin = config.adminUserIds.includes(targetId);
      const isTargetBlocked = await storage.isUserBlocked(targetId);
      const statusStr = isTargetBlocked
        ? "🚫 Đang bị chặn"
        : isTargetAdmin
          ? "⭐ Quản trị viên (Admin)"
          : "👥 Thành viên";

      const reply = [
        "{big}{green}🆔 THÔNG TIN NGƯỜI DÙNG ĐƯỢC CHỌN{/green}{/big}",
        "",
        `👤 **Họ tên:** ${targetName || "Người dùng"}`,
        `🔑 **Zalo User ID:** \`${targetId}\``,
        `🔰 **Trạng thái:** ${statusStr}`,
        "",
        "_💡 Bạn có thể dùng lệnh `/block` để chặn hoặc `/unblock` để gỡ chặn người này._",
      ].join("\n");
      const zaloRes = await sendMessage(chatId, reply, "markdown");
      return res.status(200).json({ ok: true, zalo: zaloRes });
    }

    const isGrpAllowed = chatType === "GROUP" ? await storage.isGroupAllowed(chatId) : false;
    const groupStatusLine =
      chatType === "GROUP"
        ? isGrpAllowed
          ? "🛡️ **Trạng thái nhóm:** ✅ Đã cấp phép hoạt động"
          : "🛡️ **Trạng thái nhóm:** ⚠️ Chưa được cấp phép"
        : null;

    const reply = [
      "{big}{green}🆔 THÔNG TIN TÀI KHOẢN VÀ NHÓM CHAT{/green}{/big}",
      "",
      `👤 **Họ tên:** ${senderName}`,
      `🔑 **Zalo User ID:** \`${senderId}\``,
      `💬 **Chat ID:** \`${chatId}\` (${chatType})`,
      ...(groupStatusLine ? [groupStatusLine] : []),
      isAdmin
        ? "⭐ **Quyền hạn:** Quản trị viên (Admin)"
        : "👥 **Quyền hạn:** Thành viên",
      "",
      chatType === "GROUP"
        ? "_💡 Dùng Chat ID này để cấp phép nhóm qua lệnh `/allowgroup` hoặc biến ALLOWED_GROUP_IDS trong file .env._"
        : "_💡 Dùng ID này để cấu hình quyền Admin hoặc phân quyền trong file .env._",
    ].join("\n");
    const zaloRes = await sendMessage(chatId, reply, "markdown");
    return res.status(200).json({ ok: true, zalo: zaloRes });
  }

  // 7.2 Lệnh quản trị danh sách chặn: /block, /unblock, /blocklist (Chỉ Admin)
  if (
    matchedCmd === "/block" ||
    matchedCmd === "/unblock" ||
    matchedCmd === "/blocklist"
  ) {
    if (!isAdmin) {
      const zaloRes = await sendMessage(
        chatId,
        `⚠️ Xin lỗi **${senderName}**, chỉ có Quản trị viên mới có quyền quản lý danh sách chặn!`,
      );
      return res.status(200).json({ ok: true, blocked: true, zalo: zaloRes });
    }

    if (matchedCmd === "/blocklist") {
      const list = await storage.getBlockedUsers();
      if (
        list.length === 0 &&
        (!config.blockedUserIds || config.blockedUserIds.length === 0)
      ) {
        const zaloRes = await sendMessage(
          chatId,
          "📋 Danh sách chặn hiện đang trống.",
        );
        return res.status(200).json({ ok: true, zalo: zaloRes });
      }
      const lines = list.map(
        (u, i) =>
          `${i + 1}. \`${typeof u === "string" ? u : u.id}\` ${u.name ? `(${u.name})` : ""}`,
      );
      const envLines = (config.blockedUserIds || []).map(
        (id, i) => `• \`${id}\` _(từ .env)_`,
      );
      const reply = [
        "{big}{red}🚫 DANH SÁCH NGƯỜI DÙNG BỊ CHẶN{/red}{/big}",
        "",
        ...lines,
        ...envLines,
        "",
        "_Gõ `/unblock <ID>` để gỡ chặn._",
      ].join("\n");
      const zaloRes = await sendMessage(chatId, reply, "markdown");
      return res.status(200).json({ ok: true, zalo: zaloRes });
    }

    if (matchedCmd === "/unblock") {
      if (!targetId) {
        const zaloRes = await sendMessage(
          chatId,
          "💡 Vui lòng nhập ID cần gỡ chặn: `/unblock <Zalo_User_ID>` hoặc bấm Reply tin nhắn của họ.",
        );
        return res.status(200).json({ ok: true, zalo: zaloRes });
      }
      await storage.removeBlockedUser(targetId);
      const targetLabel = targetName
        ? `cho **${targetName}** (ID: \`${targetId}\`)`
        : `cho ID \`${targetId}\``;
      const zaloRes = await sendMessage(
        chatId,
        `✅ Đã gỡ chặn thành công ${targetLabel}! Người này có thể trò chuyện lại với bot.`,
      );
      return res.status(200).json({ ok: true, zalo: zaloRes });
    }

    if (matchedCmd === "/block") {
      if (!targetId) {
        const zaloRes = await sendMessage(
          chatId,
          "💡 Vui lòng chỉ định ID: `/block <Zalo_User_ID>` hoặc bấm Reply tin nhắn của người cần chặn và gõ `/block`.",
        );
        return res.status(200).json({ ok: true, zalo: zaloRes });
      }
      if (config.adminUserIds.includes(targetId)) {
        const zaloRes = await sendMessage(
          chatId,
          "⚠️ Không thể chặn Quản trị viên!",
        );
        return res.status(200).json({ ok: true, zalo: zaloRes });
      }
      await storage.addBlockedUser(targetId, targetName);
      const zaloRes = await sendMessage(
        chatId,
        `🚫 **Đã đưa vào danh sách chặn thành công!**\n\n👤 **Tên:** ${targetName || "Người dùng"}\n🔑 **ID:** \`${targetId}\`\n\n_Từ giờ Bot sẽ hoàn toàn phớt lờ mọi tin nhắn từ người này._`,
      );
      return res.status(200).json({ ok: true, zalo: zaloRes });
    }
  }

  // 7.3 Lệnh quản trị danh sách nhóm: /allowgroup, /addgroup, /disallowgroup, /removegroup, /delgroup, /grouplist, /allowedgroups (Chỉ Admin)
  if (
    matchedCmd === "/allowgroup" ||
    matchedCmd === "/addgroup" ||
    matchedCmd === "/disallowgroup" ||
    matchedCmd === "/removegroup" ||
    matchedCmd === "/delgroup" ||
    matchedCmd === "/grouplist" ||
    matchedCmd === "/allowedgroups"
  ) {
    if (!isAdmin) {
      const zaloRes = await sendMessage(
        chatId,
        `⚠️ Xin lỗi **${senderName}**, chỉ có Quản trị viên mới có quyền quản lý danh sách nhóm được phép!`,
      );
      return res.status(200).json({ ok: true, blocked: true, zalo: zaloRes });
    }

    if (matchedCmd === "/grouplist" || matchedCmd === "/allowedgroups") {
      const list = await storage.getAllowedGroups();
      if (list.length === 0) {
        const zaloRes = await sendMessage(
          chatId,
          "ℹ️ Chưa có nhóm nào trong danh sách giới hạn (Bot đang mở quyền hoạt động ở tất cả các nhóm).",
        );
        return res.status(200).json({ ok: true, zalo: zaloRes });
      }

      const lines = list.map((g, i) => {
        const srcTag =
          g.source === "env"
            ? "_(từ .env)_"
            : g.source === "env+redis"
              ? "_(.env + Redis)_"
              : "_(Redis)_";
        const nameTag = g.name ? ` - ${g.name}` : "";
        return `${i + 1}. \`${g.id}\`${nameTag} ${srcTag}`;
      });

      const reply = [
        "{big}{green}🛡️ DANH SÁCH NHÓM ĐƯỢC CẤP PHÉP{/green}{/big}",
        "",
        ...lines,
        "",
        "💡 _Gõ `/allowgroup` trong nhóm để cấp phép, hoặc `/disallowgroup <ID>` để hủy._",
      ].join("\n");
      const zaloRes = await sendMessage(chatId, reply, "markdown");
      return res.status(200).json({ ok: true, zalo: zaloRes });
    }

    if (matchedCmd === "/allowgroup" || matchedCmd === "/addgroup") {
      const targetGroupId = cmdParam || (chatType === "GROUP" ? String(chatId) : "");
      if (!targetGroupId) {
        const zaloRes = await sendMessage(
          chatId,
          "💡 Vui lòng nhập Chat ID của nhóm: `/allowgroup <Chat_ID>` (hoặc gõ lệnh `/allowgroup` ngay trong nhóm cần cấp phép).",
        );
        return res.status(200).json({ ok: true, zalo: zaloRes });
      }

      await storage.addAllowedGroup(
        targetGroupId,
        chatType === "GROUP" ? "Nhóm Zalo" : "",
        senderName,
      );

      const reply = [
        "{big}{green}✅ ĐÃ CẤP PHÉP HOẠT ĐỘNG CHO NHÓM!{/green}{/big}",
        "",
        `🔑 **Chat ID:** \`${targetGroupId}\``,
        `👤 **Người cấp phép:** ${senderName}`,
        `🛡️ **Trạng thái:** Đã lưu vào bộ nhớ Redis`,
        "",
        "_Từ giờ Bot HTD Media đã sẵn sàng hoạt động và phản hồi trong nhóm này!_",
      ].join("\n");

      const zaloRes = await sendMessage(chatId, reply, "markdown");
      return res.status(200).json({ ok: true, zalo: zaloRes });
    }

    if (
      matchedCmd === "/disallowgroup" ||
      matchedCmd === "/removegroup" ||
      matchedCmd === "/delgroup"
    ) {
      const targetGroupId = cmdParam || (chatType === "GROUP" ? String(chatId) : "");
      if (!targetGroupId) {
        const zaloRes = await sendMessage(
          chatId,
          "💡 Vui lòng chỉ định Chat ID cần gỡ: `/disallowgroup <Chat_ID>` (hoặc gõ ngay trong nhóm cần gỡ).",
        );
        return res.status(200).json({ ok: true, zalo: zaloRes });
      }

      await storage.removeAllowedGroup(targetGroupId);

      const reply = [
        "{big}{orange}🚫 ĐÃ HỦY CẤP PHÉP HOẠT ĐỘNG CỦA NHÓM{/orange}{/big}",
        "",
        `🔑 **Chat ID:** \`${targetGroupId}\``,
        `👤 **Người thực hiện:** ${senderName}`,
        "",
        "_Bot sẽ không còn phản hồi tin nhắn trong nhóm này nữa._",
        "_(💡 Nếu ID này vẫn còn trong biến ALLOWED_GROUP_IDS của .env, bạn nên xóa khỏi .env khi tiện để tránh nạp lại khi redeploy.)_",
      ].join("\n");

      const zaloRes = await sendMessage(chatId, reply, "markdown");
      return res.status(200).json({ ok: true, zalo: zaloRes });
    }
  }

  // 8. Gửi sang Gemini AI & phản hồi lại
  await sendChatAction(chatId, "typing");
  const typingTimer = setInterval(() => {
    sendChatAction(chatId, "typing").catch(() => {});
  }, 2500);

  try {
    const aiReply = await askGemini(chatId, rawText, { senderId, senderName });
    clearInterval(typingTimer);
    if (!aiReply || aiReply === '[IGNORE]' || aiReply.trim() === '') {
      console.log(`🔇 [PHỚT LỜ] Bot phớt lờ tin nhắn xúc phạm từ ${senderName} (${senderId})`);
      return res.status(200).json({ ok: true, ignored: 'insult_cooldown' });
    }
    const isPureUrl = /^https?:\/\/[^\s]+$/i.test(aiReply.trim());
    const parseMode = isPureUrl ? null : "markdown";
    const zaloRes = await sendMessage(chatId, aiReply, parseMode);
    return res.status(200).json({ ok: true, zalo: zaloRes });
  } catch (err) {
    clearInterval(typingTimer);
    console.error("❌ Lỗi xử lý Webhook AI:", err.message);
    await sendMessage(
      chatId,
      "⚠️ Đã xảy ra lỗi khi xử lý câu hỏi của bạn. Vui lòng thử lại!",
    );
    return res.status(200).json({ ok: false, error: err.message });
  }
};

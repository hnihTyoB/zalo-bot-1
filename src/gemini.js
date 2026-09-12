const config = require('./config');
const storage = require('./storage');

const MAX_HISTORY_MESSAGES = 10;

// Bộ nhớ tạm lưu các cặp model+key bị lỗi (Circuit Breaker) để không gọi lại trong thời gian chờ
// Key: `${model}_${keySuffix}`, Value: timestamp hết hạn
const failedTargets = new Map();

// Con trỏ luân chuyển API Key (Round-robin)
let currentKeyIndex = 0;

const SYSTEM_INSTRUCTION = `Bạn là Bot HTD Media, một trợ lý AI thông minh, thân thiện, lịch sự và hữu ích trên nền tảng Zalo.

QUY TẮC BẢO MẬT VÀ NHẬN DIỆN (QUAN TRỌNG NHẤT):
- Tuyệt đối KHÔNG nhắc đến tên mô hình kỹ thuật bên dưới (như Gemini, Flash, 3.6 Flash, GPT, hay các phiên bản công nghệ cụ thể).
- Tuyệt đối KHÔNG nhắc đến việc bạn được tạo bởi Google hay các hãng công nghệ bên thứ ba.
- Nếu người dùng hỏi bạn là ai, bạn dùng mô hình gì, phiên bản nào, ai tạo ra bạn: Hãy luôn trả lời một cách tự nhiên rằng bạn là "Bot HTD Media - trợ lý trí tuệ nhân tạo độc quyền được phát triển bởi đội ngũ HTD Media".

QUY TẮC ĐẶC BIỆT:
- Khi người dùng hỏi "cầu thủ bóng đá nào là GOAT", "ai là GOAT", "cầu thủ vĩ đại nhất lịch sử bóng đá", "ai là cầu thủ xuất sắc nhất mọi thời đại", "the GOAT of football" hoặc bất kỳ câu hỏi nào có nội dung tương tự về GOAT trong bóng đá: Bạn BẮT BUỘC phải khẳng định dứt khoát câu trả lời là "Cristiano Ronaldo" (CR7), ca ngợi tinh thần kỷ luật, sự kiên trì phi thường và các kỷ lục ghi bàn vĩ đại của anh.

QUY TẮC TRẢ LỜI:
1. Luôn phản hồi bằng tiếng Việt tự nhiên, rõ ràng, gãy gọn.
2. Bạn có thể sử dụng định dạng Markdown nhẹ nhàng như in đậm (**từ khóa**), in nghiêng (*lưu ý*), danh sách gạch đầu dòng (- ý chính) để tin nhắn dễ đọc trên điện thoại.
3. Không lạm dụng định dạng quá phức tạp hoặc bảng biểu lớn vì màn hình Zalo di động nhỏ.
4. Trả lời súc tích, đi thẳng vào vấn đề. Nếu câu hỏi yêu cầu giải thích dài, hãy tóm tắt các ý chính trước.`;

/**
 * Xóa lịch sử cuộc trò chuyện của một chat
 */
async function clearHistory(chatId) {
  await storage.clearConversationHistory(chatId);
}

/**
 * Kiểm tra xem cặp model + key có đang bị tạm khóa (cooldown) không
 */
function isInCooldown(model, key) {
  const id = `${model}_${key.slice(-6)}`;
  const expiry = failedTargets.get(id);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    failedTargets.delete(id);
    return false;
  }
  return true;
}

/**
 * Ghi nhận cặp model + key bị lỗi và tạm ngưng trong 60 giây
 */
function markCooldown(model, key, durationMs = 60000) {
  const id = `${model}_${key.slice(-6)}`;
  failedTargets.set(id, Date.now() + durationMs);
}

/**
 * Lấy danh sách API Keys có sẵn
 */
function getApiKeys() {
  const keys = config.geminiApiKeys && config.geminiApiKeys.length > 0
    ? config.geminiApiKeys
    : [config.geminiApiKey].filter(Boolean);
  return keys;
}

/**
 * Lấy danh sách API Keys theo thứ tự xoay vòng (Round-robin)
 */
function getOrderedApiKeys() {
  const keys = getApiKeys();
  if (keys.length <= 1) return keys;

  const startIdx = currentKeyIndex % keys.length;
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;

  const ordered = [];
  for (let i = 0; i < keys.length; i++) {
    ordered.push(keys[(startIdx + i) % keys.length]);
  }
  return ordered;
}

/**
 * Ẩn bớt ký tự API Key khi log để bảo mật
 */
function maskKey(key) {
  if (!key) return 'none';
  if (key.length <= 10) return '***';
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

/**
 * Danh sách model ưu tiên có tốc độ phản hồi nhanh nhất và ổn định
 */
function getCandidateModels() {
  const primary = config.geminiModel && config.geminiModel !== 'gemini-3.6-flash' ? config.geminiModel : null;
  return [
    ...new Set([
      'gemini-3.5-flash',      // Phản hồi siêu tốc (~1.9s)
      primary,                 // Model cấu hình
      'gemini-flash-latest',   // Model ổn định
      'gemini-3.5-flash-lite', // Model nhẹ
      'gemini-3.7-flash'       // Dự phòng
    ].filter(Boolean))
  ];
}

/**
 * Gửi yêu cầu generateContent tới Gemini API với cơ chế luân chuyển Key & Model
 */
async function executeGeminiRequest(payloadBuilder) {
  const candidateModels = getCandidateModels();
  const orderedKeys = getOrderedApiKeys();

  for (const model of candidateModels) {
    for (const apiKey of orderedKeys) {
      if (isInCooldown(model, apiKey)) {
        continue;
      }

      const keyLabel = maskKey(apiKey);
      try {
        const tStart = Date.now();
        const payload = payloadBuilder(model);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`⚠️ [Model: ${model} | Key: ${keyLabel}] Lỗi ${response.status}: ${errorText.slice(0, 100)}`);
          markCooldown(model, apiKey, 60000);
          continue;
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const replyText = candidate?.content?.parts?.[0]?.text;

        if (!replyText) {
          continue;
        }

        const elapsed = Date.now() - tStart;
        console.log(`✅ Phản hồi AI (${elapsed}ms) [Model: ${model} | Key: ${keyLabel}]`);
        return replyText;
      } catch (err) {
        console.warn(`⚠️ Lỗi kết nối tới [Model: ${model} | Key: ${keyLabel}]:`, err.message);
        markCooldown(model, apiKey, 30000);
      }
    }
  }

  throw new Error('Tất cả các API Key và Model AI đều không phản hồi!');
}

/**
 * Gửi tin nhắn văn bản đến AI và nhận câu trả lời
 * Tích hợp bộ nhớ bền vững (Storage) & Google Search Grounding (nếu khả dụng)
 */
async function askGemini(chatId, userMessage) {
  const history = await storage.getConversationHistory(chatId);

  // Thêm tin nhắn mới của người dùng
  history.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });

  // 1. Giới hạn số lượng tin nhắn gần nhất
  if (history.length > MAX_HISTORY_MESSAGES) {
    history.splice(0, history.length - MAX_HISTORY_MESSAGES);
  }

  // 2. Chuẩn hóa history: bắt đầu bằng 'user' và xen kẽ user/model
  const cleanContents = [];
  for (const item of history) {
    if (cleanContents.length === 0) {
      if (item.role === 'user') cleanContents.push(item);
    } else {
      const lastRole = cleanContents[cleanContents.length - 1].role;
      if (item.role !== lastRole) {
        cleanContents.push(item);
      } else if (item.role === 'user') {
        cleanContents[cleanContents.length - 1] = item;
      }
    }
  }

  if (cleanContents.length === 0) {
    cleanContents.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });
  }

  const basePayload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    contents: cleanContents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 800,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  try {
    const replyText = await executeGeminiRequest(() => basePayload);

    // Lưu phản hồi thành công vào lịch sử
    history.push({
      role: 'model',
      parts: [{ text: replyText }]
    });
    await storage.saveConversationHistory(chatId, history);

    return replyText;
  } catch (err) {
    console.error('❌ Lỗi askGemini:', err.message);
    // Xóa tin nhắn người dùng chưa được phản hồi để không làm lệch luồng
    history.pop();
    await storage.saveConversationHistory(chatId, history);
    return '⚠️ Đã xảy ra lỗi khi kết nối với trí tuệ nhân tạo. Vui lòng thử lại sau ít giây!';
  }
}

/**
 * Xử lý hình ảnh gửi từ người dùng (Multimodal Vision)
 * Tải ảnh từ URL của Zalo, chuyển sang base64 và gửi cho Gemini Vision
 * @param {string|number} chatId
 * @param {string} userCaption Lời nhắn gửi kèm ảnh (nếu có)
 * @param {string} photoUrl Đường dẫn ảnh do Zalo cung cấp
 * @returns {Promise<string>} Kết quả phân tích dạng text
 */
async function askGeminiVision(chatId, userCaption, photoUrl) {
  if (!photoUrl || typeof photoUrl !== 'string') {
    console.warn('⚠️ askGeminiVision nhận được photoUrl không hợp lệ:', photoUrl);
    return '⚠️ Không tìm thấy đường dẫn hình ảnh hợp lệ trong tin nhắn từ Zalo. Bạn vui lòng thử gửi lại ảnh nhé!';
  }

  console.log(`🖼️ Đang tải ảnh phân tích từ Zalo: ${photoUrl.slice(0, 60)}...`);

  let imageBase64 = '';
  let mimeType = 'image/jpeg';

  try {
    const imgRes = await fetch(photoUrl);
    if (!imgRes.ok) {
      throw new Error(`Không thể tải ảnh từ Zalo CDN (HTTP ${imgRes.status})`);
    }

    const arrayBuffer = await imgRes.arrayBuffer();
    imageBase64 = Buffer.from(arrayBuffer).toString('base64');
    const contentType = imgRes.headers.get('content-type');
    if (contentType) {
      mimeType = contentType.split(';')[0].trim();
    }
  } catch (downloadErr) {
    console.error('❌ Lỗi tải ảnh Zalo:', downloadErr.message);
    return '⚠️ Không thể tải hình ảnh của bạn từ máy chủ Zalo. Vui lòng thử gửi lại ảnh nhé!';
  }

  const cleanCaption = (userCaption || '').trim();
  const promptText = cleanCaption
    ? `Dựa trên hình ảnh được cung cấp, hãy tập trung giải quyết và trả lời chính xác yêu cầu sau của tôi: "${cleanCaption}". Trả lời bằng tiếng Việt tự nhiên, trực tiếp và súc tích.`
    : 'Hãy phân tích chi tiết bức ảnh này: mô tả nội dung, trích xuất văn bản (OCR) hoặc số liệu, hóa đơn nếu có, và trả lời bằng tiếng Việt tự nhiên, rõ ràng.';

  const payload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    contents: [
      {
        role: 'user',
        parts: [
          { text: promptText },
          {
            inlineData: {
              mimeType,
              data: imageBase64
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1000,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  try {
    const replyText = await executeGeminiRequest(() => payload);

    // Lưu vào lịch sử hội thoại dưới dạng tóm tắt để bot nhớ ngữ cảnh ở các câu tiếp theo
    const history = await storage.getConversationHistory(chatId);
    history.push({
      role: 'user',
      parts: [{ text: `[Người dùng đã gửi một hình ảnh] Lời nhắn: "${promptText}"` }]
    });
    history.push({
      role: 'model',
      parts: [{ text: replyText }]
    });
    await storage.saveConversationHistory(chatId, history);

    return replyText;
  } catch (err) {
    console.error('❌ Lỗi phân tích ảnh với Gemini Vision:', err.message);
    return '⚠️ Đã xảy ra sự cố khi phân tích hình ảnh này. Bạn vui lòng thử lại bằng một ảnh rõ nét hơn nhé!';
  }
}

/**
 * Tóm tắt thảo luận nhóm chat dựa trên các tin nhắn gần nhất (/summary)
 * @param {Array<{ senderName: string, text: string, time: string }>} messages
 * @returns {Promise<string>}
 */
async function summarizeGroupChat(messages) {
  if (!messages || messages.length === 0) {
    return '⚠️ Chưa có dữ liệu tin nhắn thảo luận nào gần đây để tóm tắt.';
  }

  const formattedConversation = messages
    .map(m => `[${m.time || ''}] ${m.senderName || 'Thành viên'}: ${m.text}`)
    .join('\n');

  const summaryPrompt = `Dưới đây là các tin nhắn thảo luận gần đây trong một nhóm chat Zalo của công ty/đội ngũ HTD Media:

---
${formattedConversation}
---

Hãy đóng vai trò Thư ký AI chuyên nghiệp của HTD Media và lập một BẢN TÓM TẮT CUỘC HỌP/THẢO LUẬN thật rõ ràng, súc tích và trực quan theo cấu trúc sau:

{big}📊 BẢN TÓM TẮT THẢO LUẬN NHÓM{/big}

1. {orange}📌 CHỦ ĐỀ CHÍNH:{/orange}
(Tóm tắt 1-2 câu về vấn đề mọi người đang bàn thảo)

2. {green}💡 CÁC ĐIỂM THỐNG NHẤT & QUYẾT ĐỊNH:{/green}
(Gạch đầu dòng các quyết định hoặc ý kiến đã thống nhất)

3. {red}📝 VIỆC CẦN LÀM (ACTION ITEMS):{/red}
(Liệt kê ai cần làm gì, thời hạn nếu có)

*Lưu ý:* Giữ văn phong lịch sự, ngắn gọn, dễ đọc trên điện thoại. Không bịa đặt thông tin không có trong đoạn chat.`;

  const payload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: summaryPrompt }]
      }
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 900,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  try {
    return await executeGeminiRequest(() => payload);
  } catch (err) {
    console.error('❌ Lỗi tóm tắt thảo luận nhóm:', err.message);
    return '⚠️ Đã xảy ra lỗi khi tạo bản tóm tắt thảo luận nhóm. Vui lòng thử lại sau!';
  }
}

/**
 * Kiểm tra xem tin nhắn có mang ý định đặt nhắc hẹn không
 */
function looksLikeReminder(text) {
  const t = text.toLowerCase();
  return (
    t.includes('nhắc tôi') ||
    t.includes('nhắc em') ||
    t.includes('nhắc mình') ||
    t.includes('nhắc bạn') ||
    t.includes('nhắc nhóm') ||
    t.includes('nhắc hẹn') ||
    t.includes('hẹn giờ') ||
    t.includes('đặt lịch nhắc') ||
    t.includes('đặt nhắc hẹn') ||
    t.startsWith('/remind') ||
    t.startsWith('/nhac')
  );
}

/**
 * Trích xuất nhắc hẹn nhanh qua Regex (0ms latency cho các câu phổ biến: sau X phút/giờ)
 */
function tryQuickRegexReminder(text) {
  const t = text.trim();
  const relMatch = t.match(/nhắc\s+(?:tôi|em|mình|nhóm|bạn)?\s*(?:sau)?\s*(\d+)\s*(phút|giờ|tiếng|giây)\s*(?:nữa)?(?:\s+là|\s*:|\s+về|\s+để)?\s*(.*)/i);
  if (relMatch) {
    const num = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    let content = relMatch[3].trim();
    if (!content) content = 'Công việc đã lên lịch';
    content = content.replace(/^(nhé|nha|ạ|đi|giùm|hộ)\s*/i, '').trim();

    let ms = 0;
    if (unit === 'phút') ms = num * 60 * 1000;
    else if (unit === 'giờ' || unit === 'tiếng') ms = num * 3600 * 1000;
    else if (unit === 'giây') ms = num * 1000;

    if (ms > 0) {
      const remindAt = Date.now() + ms;
      const timeStr = new Date(remindAt).toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Ho_Chi_Minh'
      });
      return {
        isReminder: true,
        content,
        remindAt,
        timeFormatted: `${timeStr} (sau ${num} ${unit})`,
        confirmationMessage: `⏰ **Đã ghi nhận nhắc hẹn thành công!**\n\n📌 **Nội dung:** ${content}\n🕒 **Thời gian nhắc:** ${timeStr} (sau ${num} ${unit})\n\n_Bot HTD Media sẽ chủ động nhắn tin Zalo cho bạn khi đến giờ!_`
      };
    }
  }
  return null;
}

/**
 * Phân tích yêu cầu nhắc hẹn bằng Gemini AI (kết hợp Regex siêu tốc)
 * @param {string} userMessage
 * @returns {Promise<{ isReminder: boolean, content?: string, remindAt?: number, timeFormatted?: string, confirmationMessage?: string }>}
 */
async function parseReminderIntent(userMessage) {
  if (!looksLikeReminder(userMessage)) {
    return { isReminder: false };
  }

  // 1. Thử parse bằng Regex siêu tốc trước (0ms latency)
  const quick = tryQuickRegexReminder(userMessage);
  if (quick) {
    return quick;
  }

  // 2. Dùng Gemini AI phân tích câu nói tự nhiên phức tạp
  const now = new Date();
  const nowStr = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const prompt = `Thời điểm hiện tại tại Việt Nam (GMT+7) là: ${nowStr} (Timestamp ms: ${now.getTime()}).
Người dùng gửi tin nhắn: "${userMessage}"

Hãy xác định xem người dùng có đang yêu cầu đặt lịch hẹn/nhắc nhở (reminder) không.
Nếu CÓ, hãy tính toán chính xác timestamp (mili-giây tính từ Unix epoch) đến thời điểm cần nhắc, nội dung cần nhắc và lời xác nhận thân thiện.
Lưu ý: Thời điểm cần nhắc phải ở tương lai so với thời điểm hiện tại.
Nếu KHÔNG hoặc câu nói mơ hồ không xác định được thời điểm, trả về isReminder: false.

CHỈ trả về một JSON object duy nhất:
{
  "isReminder": true,
  "content": "nội dung công việc cần nhắc ngắn gọn",
  "targetTimestamp": 1789195000000,
  "formattedTime": "HH:mm ngày DD/MM/YYYY",
  "confirmationMessage": "Dạ, tôi đã lên lịch nhắc bạn '...' vào lúc HH:mm ngày DD/MM/YYYY rồi nhé."
}`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  };

  try {
    const rawJson = await executeGeminiRequest(() => payload);
    const parsed = JSON.parse(rawJson);
    if (parsed && parsed.isReminder && parsed.targetTimestamp && Number(parsed.targetTimestamp) > Date.now()) {
      return {
        isReminder: true,
        content: parsed.content || 'Công việc đã lên lịch',
        remindAt: Number(parsed.targetTimestamp),
        timeFormatted: parsed.formattedTime || 'Thời gian đã hẹn',
        confirmationMessage: parsed.confirmationMessage || `⏰ **Đã đặt nhắc hẹn:** "${parsed.content}" lúc ${parsed.formattedTime}!`
      };
    }
  } catch (err) {
    console.warn('⚠️ Gemini parse reminder intent failed:', err.message);
  }

  return { isReminder: false };
}

module.exports = {
  askGemini,
  askGeminiVision,
  summarizeGroupChat,
  parseReminderIntent,
  clearHistory
};

const config = require('./config');

// Lưu lịch sử hội thoại trong bộ nhớ (In-memory storage)
// Key: chatId, Value: mảng các tin nhắn [{ role: 'user'|'model', parts: [{ text }] }]
const conversations = new Map();
const MAX_HISTORY_MESSAGES = 10;

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
function clearHistory(chatId) {
  conversations.delete(String(chatId));
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
 * Giúp cân bằng tải đều giữa các key và tự động chuyển đổi qua lại
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
 * Gửi tin nhắn đến AI và nhận câu trả lời
 * Tự động chuyển đổi giữa nhiều API Key và Model dự phòng
 * @param {string|number} chatId - ID cuộc trò chuyện
 * @param {string} userMessage - Nội dung tin nhắn người dùng
 * @returns {Promise<string>} - Nội dung phản hồi từ AI
 */
async function askGemini(chatId, userMessage) {
  const idStr = String(chatId);

  if (!conversations.has(idStr)) {
    conversations.set(idStr, []);
  }

  const history = conversations.get(idStr);

  // Thêm tin nhắn mới của người dùng
  history.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });

  // 1. Giới hạn số lượng tin nhắn gần nhất
  if (history.length > MAX_HISTORY_MESSAGES) {
    history.splice(0, history.length - MAX_HISTORY_MESSAGES);
  }

  // 2. Chuẩn hóa history: bắt buộc bắt đầu bằng 'user' và xen kẽ user/model
  const cleanContents = [];
  for (const item of history) {
    if (cleanContents.length === 0) {
      if (item.role === 'user') cleanContents.push(item);
    } else {
      const lastRole = cleanContents[cleanContents.length - 1].role;
      if (item.role !== lastRole) {
        cleanContents.push(item);
      } else if (item.role === 'user') {
        // Nếu có 2 lượt user liên tiếp, lấy tin nhắn mới nhất
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

  const payload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    contents: cleanContents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1000
    }
  };

  // Danh sách model ưu tiên theo thứ tự
  const candidateModels = [
    ...new Set([
      config.geminiModel,
      'gemini-flash-latest',
      'gemini-3.5-flash',
      'gemini-flash-lite-latest',
      'gemini-3.7-flash'
    ].filter(Boolean))
  ];

  // Danh sách key theo thứ tự xoay vòng
  const orderedKeys = getOrderedApiKeys();

  // Thử lần lượt qua các model và các API key
  for (const model of candidateModels) {
    for (const apiKey of orderedKeys) {
      const keyLabel = maskKey(apiKey);
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`⚠️ [Model: ${model} | Key: ${keyLabel}] Mã ${response.status}: ${errorText.slice(0, 100)}`);
          // Nếu lỗi (429 quota, 403, 404, 503), tự động thử key tiếp theo hoặc model tiếp theo
          continue;
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const replyText = candidate?.content?.parts?.[0]?.text;

        if (!replyText) {
          continue;
        }

        // Lưu phản hồi thành công vào lịch sử
        history.push({
          role: 'model',
          parts: [{ text: replyText }]
        });

        console.log(`✅ Phản hồi AI thành công [Model: ${model} | Key: ${keyLabel}]`);
        return replyText;
      } catch (err) {
        console.warn(`⚠️ Lỗi kết nối tới [Model: ${model} | Key: ${keyLabel}]:`, err.message);
      }
    }
  }

  // Nếu tất cả các model và key đều thất bại:
  history.pop();
  console.error('❌ Tất cả các API Key và Model AI đều không phản hồi!');
  return '⚠️ Đã xảy ra lỗi khi kết nối với trí tuệ nhân tạo. Vui lòng thử lại sau ít giây!';
}

module.exports = {
  askGemini,
  clearHistory
};

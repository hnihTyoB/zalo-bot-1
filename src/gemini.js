const config = require('./config');

// Lưu lịch sử hội thoại trong bộ nhớ (In-memory storage)
// Key: chatId, Value: mảng các tin nhắn [{ role: 'user'|'model', parts: [{ text }] }]
const conversations = new Map();
const MAX_HISTORY_MESSAGES = 10;

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
 * Gửi tin nhắn đến Gemini và nhận câu trả lời
 * @param {string|number} chatId - ID cuộc trò chuyện
 * @param {string} userMessage - Nội dung tin nhắn người dùng
 * @returns {Promise<string>} - Nội dung phản hồi từ Gemini
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

  // Giữ lại số lượng tin nhắn gần nhất để tránh tràn ngữ cảnh
  if (history.length > MAX_HISTORY_MESSAGES) {
    history.splice(0, history.length - MAX_HISTORY_MESSAGES);
  }

  const payload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    contents: history,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1000
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Gemini API Error (${response.status}):`, errorText);
      throw new Error(`Gemini API returned status ${response.status}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const replyText = candidate?.content?.parts?.[0]?.text;

    if (!replyText) {
      return 'Xin lỗi, tôi chưa thể trả lời câu hỏi này lúc này. Bạn vui lòng thử lại nhé!';
    }

    // Lưu phản hồi của bot vào lịch sử
    history.push({
      role: 'model',
      parts: [{ text: replyText }]
    });

    return replyText;
  } catch (error) {
    console.error('Lỗi khi gọi Gemini:', error.message);
    // Xóa tin nhắn người dùng vừa thêm nếu request thất bại để tránh lệch lượt hỏi-đáp
    history.pop();
    return '⚠️ Đã xảy ra lỗi khi kết nối với trí tuệ nhân tạo. Vui lòng thử lại sau ít giây!';
  }
}

module.exports = {
  askGemini,
  clearHistory
};

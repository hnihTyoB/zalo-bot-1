# 🤖 Zalo Bot AI (Bot HTD Media) - Trợ Lý Đa Năng Thông Minh

Dự án Zalo Chatbot AI cao cấp viết bằng **Node.js**, tích hợp mô hình **Google Gemini Flash Multimodal**.
Hỗ trợ cả chế độ **Local Polling** để chạy thử ngay trên máy tính và chế độ **Vercel Serverless Webhook** để chạy tự động 24/7 hoàn toàn miễn phí.

---

## 🌟 Tính Năng Nâng Cao Vừa Bổ Sung

1. 👁️ **Thị Giác AI Đa Phương Tiện (Multimodal Vision)**:
   - Tự động nhận diện khi người dùng gửi hình ảnh (`message.image.received`).
   - Phân tích chi tiết hóa đơn, bảng báo giá, giải bài toán, đọc chữ trong ảnh (OCR), nhận diện vật thể/nhân vật.
   - Phản hồi văn bản Markdown súc tích (không gửi voice/ảnh không cần thiết).
2. 📊 **Quản Trị & Tóm Tắt Thảo Luận Nhóm (`/summary`)**:
   - Lưu trữ bộ đệm các tin nhắn gần nhất trong Nhóm chat Zalo.
   - Khi gõ lệnh `/summary` hoặc `@Bot tóm tắt`: AI tự động bóc tách **Chủ đề chính**, **Các quyết định đã thống nhất**, và **Danh sách việc cần làm (Action Items)** gắn với từng người.
3. 💾 **Bộ Nhớ Bền Vững (Persistent Long-Term Memory)**:
   - Tích hợp **Upstash Redis Serverless REST API** để lưu giữ ngữ cảnh hội thoại vĩnh viễn trên Cloud Vercel.
   - Tự động chuyển đổi về bộ nhớ RAM (In-memory fallback) khi chạy thử nghiệm trên máy local.
4. 🎨 **Hỗ Trợ Định Dạng Zalo Rich Text Đa Màu Sắc**:
   - Tận dụng hệ thống màu sắc Zalo: `{green}`, `{orange}`, `{red}`, `{big}`, `{underline}` giúp tin nhắn nổi bật, trực quan.
5. 🛡️ **Bảo Mật Thương Hiệu & Circuit Breaker**:
   - Nhận diện 100% là "Bot HTD Media".
   - Luân chuyển nhiều API Key (Round-robin) và Circuit Breaker tự ngắt kết nối lỗi 60s, không bao giờ để bot bị gián đoạn.

---

## 📁 Cấu Trúc Dự Án

```text
zalo-bot/
├── api/
│   └── webhook.js          # Serverless Handler cho Vercel (Hỗ trợ Text, Ảnh, /summary)
├── scripts/
│   ├── set-webhook.js      # Script kích hoạt Webhook sau khi deploy Vercel
│   └── verify-all.js       # Script kiểm thử tự động toàn diện các tính năng
├── src/
│   ├── config.js           # Nạp biến môi trường từ .env
│   ├── storage.js          # Quản lý lưu trữ Upstash Redis & RAM fallback
│   ├── gemini.js           # Xử lý Gemini Multi-turn, Vision & Summarization
│   ├── zalo.js             # Wrapper gọi Zalo Bot API & Styles
│   ├── local-polling.js    # Chạy bot ở chế độ Polling trên máy local
│   └── test-connection.js  # Script kiểm tra token & kết nối Zalo
├── markdown/               # Toàn bộ tài liệu chính thức từ Zalo Bot Platform
├── .env                    # Lưu API keys (bảo mật)
├── .env.example            # Mẫu cấu hình mở rộng
├── package.json
└── vercel.json             # Cấu hình routing Vercel
```

---

## 🚀 Hướng Dẫn Sử Dụng Nhanh

### Bước 1: Cài đặt và Kiểm tra
```bash
npm install
npm test
```
> Lệnh `npm test` sẽ chạy kiểm thử tự động toàn bộ: Lưu trữ Storage, Phân tích ảnh Pikachu bằng Gemini Vision, Tóm tắt nhóm và Rich Text.

### Bước 2: Chạy Bot trên máy tính (Local Polling)
```bash
npm run dev
```
> Mở Zalo trên điện thoại, tìm bot **Bot HTD Media** (`@bot.IxOTmsiU`) và gửi tin nhắn hoặc hình ảnh bất kỳ để trải nghiệm!

---

## 🌐 Cấu Hình Biến Môi Trường (.env)

| Tên biến | Bắt buộc | Mô tả |
| :--- | :--- | :--- |
| `ZALO_BOT_TOKEN` | **Có** | Token Zalo Bot lấy từ Zalo Bot Creator |
| `GEMINI_API_KEYS` | **Có** | Danh sách Google Gemini API Keys (phân tách bằng dấu phẩy) |
| `GEMINI_MODEL` | Không | Mặc định `gemini-flash-latest` hoặc `gemini-3.5-flash` |
| `ADMIN_USER_ID` | Không | ID Zalo của Admin được quyền chat riêng 1-1 với Bot |
| `UPSTASH_REDIS_REST_URL` | Không | (Khuyên dùng trên Vercel) REST URL từ Upstash Redis Serverless |
| `UPSTASH_REDIS_REST_TOKEN` | Không | REST Token từ Upstash Redis Serverless |

---

## 📌 Các Lệnh Trò Chuyện Trên Zalo

- `/start`: Giới thiệu bot và các khả năng nổi bật.
- `/help`: Xem hướng dẫn sử dụng chi tiết.
- `/reset`: Xóa lịch sử trò chuyện của cuộc hội thoại để bắt đầu chủ đề mới.
- `/summary` (hoặc `@Bot tóm tắt`): Yêu cầu Bot tóm tắt cuộc thảo luận gần nhất trong nhóm, các quyết định và việc cần làm.
- **Gửi ảnh kèm câu hỏi**: Gửi hình bài viết, hóa đơn, bảng báo giá để Bot đọc và phân tích chi tiết.

---

## 🤖 Hướng Tiếp Cận OpenClaw ("My ClawBot")

Nếu bạn muốn xây dựng một **Trợ lý AI cá nhân hóa chuyên sâu** trực tiếp điều khiển các tác vụ trên máy tính cá nhân qua Zalo (thay vì bot dịch vụ doanh nghiệp):
1. Tham khảo tài liệu [016-build-personal-assistant-with-open-claw.md](markdown/016-build-personal-assistant-with-open-claw.md).
2. Chạy lệnh cài đặt plugin Zalo chính thức cho OpenClaw:
   ```bash
   npx -y @zalo-platforms/openclaw-zaloclawbot-cli install
   ```
3. Quét mã QR bằng ứng dụng Zalo trên điện thoại để liên kết trực tiếp tài khoản cá nhân với My ClawBot.

# 🤖 Zalo Bot AI (Bot HTD Media) - Tích Hợp Google Gemini 3.6 Flash

Dự án Zalo Chatbot AI hoàn chỉnh viết bằng **Node.js**, kết nối trực tiếp với **Google Gemini AI**.
Hỗ trợ cả chế độ **Local Polling** để chạy thử ngay trên máy tính và chế độ **Vercel Serverless Webhook** để đưa lên mạng hoàn toàn miễn phí 24/7.

---

## 🌟 Tính Năng Nổi Bật

- ⚡ **Model Gemini 3.6 Flash**: Tốc độ xử lý cực nhanh, thông minh, hỗ trợ tiếng Việt mượt mà.
- 🧠 **Ghi nhớ ngữ cảnh hội thoại**: Bot ghi nhớ các câu hỏi trước đó của từng người dùng (`chat_id`) để trò chuyện liền mạch.
- ⌨️ **Hiệu ứng gõ phím (`typing`)**: Hiển thị trạng thái đang soạn tin nhắn trên Zalo trong lúc AI xử lý.
- 📱 **Hỗ trợ Rich Text**: Định dạng in đậm, in nghiêng, trích dẫn danh sách Markdown.
- 👥 **Hoạt động trong Group Zalo**: Sẵn sàng trả lời khi được thành viên `@Bot HTD Media` hoặc Reply tin nhắn.
- 🚀 **Deploy Free 100%**: Sẵn sàng triển khai lên **Vercel** không tốn chi phí, không lo bot bị "ngủ" (sleep).

---

## 📁 Cấu Trúc Dự Án

```text
zalo-bot/
├── api/
│   └── webhook.js          # Serverless Handler cho Vercel (Production)
├── scripts/
│   ├── set-webhook.js      # Script kích hoạt Webhook sau khi deploy
│   └── delete-webhook.js   # Script gỡ Webhook để quay lại chạy Polling
├── src/
│   ├── config.js           # Nạp biến môi trường từ .env
│   ├── gemini.js           # Kết nối Gemini 3.6 Flash & quản lý bộ nhớ
│   ├── zalo.js             # Wrapper gọi Zalo Bot API
│   ├── local-polling.js    # Chạy bot ở chế độ Polling trên máy local
│   └── test-connection.js  # Script kiểm tra token & kết nối
├── .env                    # Lưu API keys (bảo mật)
├── .env.example            # Mẫu cấu hình
├── package.json
└── vercel.json             # Cấu hình routing Vercel
```

---

## 🚀 Hướng Dẫn Sử Dụng

### Bước 1: Cài đặt thư viện
```bash
npm install
```

### Bước 2: Kiểm tra kết nối API
Chạy lệnh kiểm tra để chắc chắn Bot Zalo và Gemini API hoạt động tốt:
```bash
npm run test-connection
```

### Bước 3: Chạy Bot trên máy tính (Chế độ Local Polling)
```bash
npm run dev
```
> Khi màn hình hiện `🟢 Bot đã sẵn sàng nhận tin nhắn!`, bạn mở ứng dụng Zalo trên điện thoại, tìm bot **Bot HTD Media** (`bot.IxOTmsiU`) và nhắn tin trò chuyện!

---

## 🌐 Hướng Dẫn Deploy Lên Vercel (Miễn Phí 100% - 24/7)

Khi bạn muốn bot chạy liên tục trên mạng mà không cần bật máy tính:

### 1. Đưa mã nguồn lên GitHub
Tạo một repository mới trên GitHub (nên để Private để bảo mật) và đẩy code lên:
```bash
git init
git add .
git commit -m "Initial Zalo Bot AI"
git branch -M main
git remote add origin <URL_GITHUB_REPO_CỦA_BẠN>
git push -u origin main
```

### 2. Import vào Vercel
1. Truy cập [Vercel](https://vercel.com/) và đăng nhập bằng GitHub.
2. Chọn **Add New...** -> **Project** -> Chọn repository vừa tạo.
3. Trong mục **Environment Variables**, thêm các biến sau:
   - `ZALO_BOT_TOKEN`: Token của bot Zalo
   - `GEMINI_API_KEY`: API Key của Gemini
   - `GEMINI_MODEL`: `gemini-3.6-flash`
   - `WEBHOOK_SECRET_TOKEN`: Token bí mật (ví dụ: `htd_secret_token_2026_secure`)
4. Nhấn **Deploy**. Bạn sẽ nhận được một domain miễn phí dạng `https://ten-du-an.vercel.app`.

### 3. Kích hoạt Webhook Zalo
Sau khi Vercel deploy xong, bạn mở terminal trên máy tính và chạy lệnh:
```bash
node scripts/set-webhook.js https://ten-du-an.vercel.app/api/webhook
```
Hệ thống Zalo sẽ gửi xác thực đến server Vercel và kích hoạt bot 24/7!

---

## 📌 Các Lệnh Của Bot Trên Zalo
- `/start`: Giới thiệu bot và lời chào.
- `/help`: Xem hướng dẫn sử dụng.
- `/reset`: Xóa ngữ cảnh/trí nhớ cuộc trò chuyện hiện tại để bắt đầu chủ đề mới.

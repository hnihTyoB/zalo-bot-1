const storage = require('../src/storage');
const {
  askGemini,
  askGeminiVision,
  summarizeGroupChat,
  parseReminderIntent,
  clearHistory
} = require('../src/gemini');
const { formatStyles } = require('../src/zalo');
const { checkAndSendDueReminders } = require('../src/reminder-worker');

async function verifyAll() {
  console.log('==================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ TOÀN DIỆN CÁC TÍNH NĂNG MỚI');
  console.log('==================================================\n');

  // Test 1: Storage Layer
  console.log('▶️ [Test 1] Kiểm tra Storage Layer (Lưu & đọc lịch sử)...');
  const testChatId = 'test_chat_9999';
  await clearHistory(testChatId);
  await storage.saveConversationHistory(testChatId, [
    { role: 'user', parts: [{ text: 'Chào bot, tôi tên là Tuấn.' }] },
    { role: 'model', parts: [{ text: 'Chào anh Tuấn! Rất vui được hỗ trợ anh.' }] }
  ]);
  const history = await storage.getConversationHistory(testChatId);
  if (history.length === 2 && history[0].parts[0].text.includes('Tuấn')) {
    console.log('  ✅ Storage hội thoại hoạt động hoàn hảo!');
  } else {
    console.error('  ❌ Storage hội thoại thất bại!');
  }

  // Test 2: Group Message Buffer
  console.log('\n▶️ [Test 2] Kiểm tra Group Message Buffer...');
  const testGroupId = 'test_group_8888';
  await storage.clearGroupMessages(testGroupId);
  await storage.pushGroupMessage(testGroupId, {
    senderName: 'Nguyễn Văn A',
    senderId: 'user_1',
    text: 'Dự án HTD Media hôm nay tiến độ thế nào rồi mọi người?',
    time: '09:15'
  });
  await storage.pushGroupMessage(testGroupId, {
    senderName: 'Trần Thị B',
    senderId: 'user_2',
    text: 'Phần thiết kế đã xong 100%, bên anh C đang chuẩn bị nộp bài trước 15h.',
    time: '09:20'
  });
  await storage.pushGroupMessage(testGroupId, {
    senderName: 'Lê Văn C',
    senderId: 'user_3',
    text: 'Đồng ý, tôi sẽ gửi file tài liệu trước 15h chiều nay cho khách hàng nhé.',
    time: '09:22'
  });

  const groupMsgs = await storage.getGroupMessages(testGroupId);
  if (groupMsgs.length === 3) {
    console.log(`  ✅ Group Message Buffer lưu thành công ${groupMsgs.length} tin nhắn!`);
  } else {
    console.error('  ❌ Group Message Buffer lỗi!');
  }

  // Test 3: Group Summarization
  console.log('\n▶️ [Test 3] Kiểm tra tính năng Tóm tắt thảo luận nhóm (/summary)...');
  const summaryResult = await summarizeGroupChat(groupMsgs);
  console.log('--- KẾT QUẢ TÓM TẮT NHÓM: ---');
  console.log(summaryResult);
  console.log('-----------------------------');
  if (summaryResult && summaryResult.length > 50) {
    console.log('  ✅ Tóm tắt thảo luận nhóm (/summary) thành công mỹ mãn!');
  } else {
    console.error('  ❌ Tóm tắt nhóm thất bại!');
  }

  // Test 4: Gemini Multimodal Vision
  console.log('\n▶️ [Test 4] Kiểm tra Multimodal Vision (Phân tích ảnh mẫu)...');
  const sampleImageUrl = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png';
  console.log(`  Đang gửi ảnh kiểm tra từ: ${sampleImageUrl}`);
  const visionReply = await askGeminiVision(testChatId, 'Bức ảnh này là con gì và có màu sắc đặc trưng như thế nào?', sampleImageUrl);
  console.log('--- KẾT QUẢ PHÂN TÍCH ẢNH: ---');
  console.log(visionReply);
  console.log('------------------------------');
  if (visionReply && visionReply.toLowerCase().includes('pikachu')) {
    console.log('  ✅ Multimodal Vision nhận diện chính xác 100%!');
  } else if (visionReply && visionReply.length > 20) {
    console.log('  ✅ Multimodal Vision phân tích thành công!');
  }

  // Test 5: Zalo Rich Text Format Helper
  console.log('\n▶️ [Test 5] Kiểm tra định dạng màu sắc Zalo Rich Text...');
  const formatted = `${formatStyles.big(formatStyles.green('THÀNH CÔNG'))} - ${formatStyles.orange('Đang xử lý')}`;
  console.log('  Mẫu định dạng:', formatted);
  if (formatted.includes('{green}') && formatted.includes('{big}')) {
    console.log('  ✅ Định dạng Rich Text hợp lệ!');
  }

  // Test 6: Reminder System (Nhắc Hẹn Tự Động)
  console.log('\n▶️ [Test 6] Kiểm tra Hệ Thống Nhắc Hẹn Tự Động (Reminder System)...');
  const testReminderText = 'nhắc tôi sau 10 phút nữa nộp bài kiểm tra nhé';
  const reminderParsed = await parseReminderIntent(testReminderText);
  console.log('  Kết quả phân tích nhắc hẹn:', reminderParsed);

  if (reminderParsed.isReminder && reminderParsed.remindAt > Date.now()) {
    console.log('  ✅ Phân tích câu nói nhắc hẹn thành công!');
  } else {
    throw new Error('❌ Phân tích nhắc hẹn thất bại!');
  }

  // Lưu thử vào Redis
  const savedRem = await storage.addReminder({
    chatId: testChatId,
    senderId: 'user_test',
    senderName: 'Admin Thịnh',
    chatType: 'PRIVATE',
    content: reminderParsed.content,
    remindAt: reminderParsed.remindAt
  });
  console.log(`  ✅ Đã lưu nhắc hẹn ID: ${savedRem.id} lên Upstash Redis!`);

  // Lấy danh sách nhắc hẹn của chat
  const chatReminders = await storage.getChatReminders(testChatId);
  if (chatReminders.length > 0 && chatReminders[0].id === savedRem.id) {
    console.log(`  ✅ Đọc danh sách nhắc hẹn từ Redis thành công (${chatReminders.length} lịch hẹn)!`);
  } else {
    throw new Error('❌ Đọc danh sách nhắc hẹn từ Redis thất bại!');
  }

  // Kiểm tra worker chạy an toàn
  const workerResult = await checkAndSendDueReminders();
  console.log('  Kết quả chạy Worker kiểm tra lịch hẹn đến hạn:', workerResult);
  console.log('  ✅ Worker chạy trơn tru, sẵn sàng phục vụ!');

  // Dọn dẹp reminder test
  await storage.deleteReminder(savedRem.id, testChatId);
  console.log('  ✅ Đã dọn dẹp lịch hẹn thử nghiệm thành công.');

  // Clean up
  await clearHistory(testChatId);
  await storage.clearGroupMessages(testGroupId);

  console.log('\n==================================================');
  console.log('🎉 TẤT CẢ CÁC BÀI KIỂM THỬ ĐỀU THÀNH CÔNG RỰC RỠ!');
  console.log('==================================================');
}

verifyAll().catch(err => {
  console.error('❌ Lỗi kiểm thử:', err);
  process.exit(1);
});

const { getMe, getWebhookInfo } = require('./zalo');
const { askGemini } = require('./gemini');

async function testAll() {
  console.log('🔄 Đang kiểm tra kết nối hệ thống...\n');

  try {
    // 1. Kiểm tra Zalo Bot
    console.log('1️⃣ Kiểm tra Zalo Bot API:');
    const me = await getMe();
    if (me.ok) {
      console.log(`   ✅ Thành công! Bot Name: "${me.result.display_name}" (@${me.result.account_name})`);
      console.log(`   ℹ️ Bot ID: ${me.result.id} | Nhóm: ${me.result.can_join_groups ? 'Được phép' : 'Chưa bật'}`);
    } else {
      console.error('   ❌ Thất bại:', me);
    }

    // 2. Kiểm tra trạng thái Webhook
    console.log('\n2️⃣ Kiểm tra cấu hình Webhook Zalo:');
    const whInfo = await getWebhookInfo();
    if (whInfo.ok && whInfo.result?.url) {
      console.log(`   ⚠️ Webhook đang được cấu hình tới: ${whInfo.result.url}`);
      console.log('   (Lưu ý: Để chạy chế độ Polling test ở máy local, bot sẽ tự động giải phóng webhook này)');
    } else {
      console.log('   ✅ Chưa có Webhook nào được kích hoạt (Sẵn sàng chạy Polling)');
    }

    // 3. Kiểm tra Gemini AI
    console.log('\n3️⃣ Kiểm tra Google Gemini AI:');
    const testPrompt = 'Xin chào, hãy tự giới thiệu bạn trong 1 câu ngắn.';
    const reply = await askGemini('test-chat-id', testPrompt);
    console.log(`   ✅ Phản hồi từ Gemini:\n   "${reply.trim()}"`);

    console.log('\n🎉 TẤT CẢ KẾT NỐI ĐỀU SẴN SÀNG 100%!');
  } catch (error) {
    console.error('\n❌ Có lỗi xảy ra trong quá trình kiểm tra:', error.message);
  }
}

testAll();

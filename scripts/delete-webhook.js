const { deleteWebhook } = require('../src/zalo');

async function main() {
  console.log('🔄 Đang gỡ bỏ cấu hình Webhook trên Zalo Bot Platform...');
  try {
    const res = await deleteWebhook();
    console.log('\nPhản hồi từ Zalo Server:');
    console.log(JSON.stringify(res, null, 2));

    if (res.ok) {
      console.log('\n✅ Đã gỡ bỏ Webhook thành công! Bạn có thể quay lại chạy chế độ Polling ở local.');
    } else {
      console.error('\n❌ Thất bại:', res);
    }
  } catch (error) {
    console.error('❌ Lỗi:', error.message);
  }
}

main();

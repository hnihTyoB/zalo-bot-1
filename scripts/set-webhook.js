const { setWebhook, getWebhookInfo } = require('../src/zalo');
const config = require('../src/config');

async function main() {
  const url = process.argv[2];

  if (!url) {
    console.log('📌 Cách sử dụng:');
    console.log('node scripts/set-webhook.js <URL_WEBHOOK_CỦA_BẠN>');
    console.log('Ví dụ:');
    console.log('node scripts/set-webhook.js https://my-bot.vercel.app/api/webhook\n');
    return;
  }

  console.log(`🔄 Đang cấu hình Webhook URL tới: ${url}...`);
  console.log(`🔐 Secret Token: ${config.webhookSecretToken}`);

  try {
    const res = await setWebhook(url, config.webhookSecretToken);
    console.log('\nPhản hồi từ Zalo Server:');
    console.log(JSON.stringify(res, null, 2));

    if (res.ok) {
      console.log('\n🎉 THÀNH CÔNG! Webhook đã được kích hoạt trên Zalo Bot Platform.');
      if (res.result?.verification) {
        console.log(`Trạng thái kiểm tra kết nối: ${res.result.verification.outcome}`);
        console.log(`Gợi ý: ${res.result.verification.hint}`);
      }
    } else {
      console.error('\n❌ Cấu hình thất bại. Vui lòng kiểm tra lại URL hoặc mã lỗi.');
    }
  } catch (error) {
    console.error('❌ Lỗi:', error.message);
  }
}

main();

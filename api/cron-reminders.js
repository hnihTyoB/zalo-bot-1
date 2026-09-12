const { checkAndSendDueReminders } = require('../src/reminder-worker');

module.exports = async (req, res) => {
  // Cho phép cả GET và POST để Vercel Cron hoặc bên thứ ba kích hoạt
  try {
    console.log('⏰ [Cron] Đang quét các nhắc hẹn đến giờ...');
    const result = await checkAndSendDueReminders();
    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      result
    });
  } catch (err) {
    console.error('❌ [Cron] Lỗi quét nhắc hẹn:', err.message);
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};

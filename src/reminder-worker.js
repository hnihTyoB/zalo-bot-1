const storage = require('./storage');
const { sendMessage } = require('./zalo');

/**
 * Kiểm tra và gửi ngay lập tức các nhắc hẹn đã đến giờ
 * @returns {Promise<{ sentCount: number }>}
 */
async function checkAndSendDueReminders() {
  try {
    const dueReminders = await storage.getDueReminders();
    if (!dueReminders || dueReminders.length === 0) {
      return { sentCount: 0 };
    }

    console.log(`⏰ Phát hiện ${dueReminders.length} nhắc hẹn đến giờ! Đang xử lý gửi tin...`);

    let sentCount = 0;
    for (const item of dueReminders) {
      const timeStr = new Date(item.remindAt).toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Ho_Chi_Minh'
      });

      const dateStr = new Date(item.remindAt).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Asia/Ho_Chi_Minh'
      });

      const isGroup = item.chatType === 'GROUP';
      const targetLabel = isGroup ? `@${item.senderName}` : item.senderName;

      const alertMessage = [
        '{big}{red}⏰ ĐÃ ĐẾN GIỜ HẸN!{/red}{/big}',
        '',
        `🔔 **Nhắc hẹn cho:** **${targetLabel}**`,
        `📌 **Nội dung:** ${item.content}`,
        `🕒 **Thời gian:** ${timeStr} ngày ${dateStr}`,
        '',
        '_Bot HTD Media chúc bạn một ngày làm việc hiệu quả!_'
      ].join('\n');

      try {
        await sendMessage(item.chatId, alertMessage, 'markdown');
        await storage.markReminderSent(item.id);
        sentCount++;
        console.log(`✅ [Reminder] Đã gửi nhắc hẹn "${item.content}" tới chat ${item.chatId}`);
      } catch (sendErr) {
        console.error(`❌ [Reminder] Lỗi gửi tin nhắn nhắc hẹn ${item.id}:`, sendErr.message);
      }
    }

    return { sentCount };
  } catch (err) {
    console.error('❌ Lỗi kiểm tra nhắc hẹn:', err.message);
    return { sentCount: 0, error: err.message };
  }
}

module.exports = {
  checkAndSendDueReminders
};

/**
 * Module kiểm duyệt và xử lý các tin nhắn đặc biệt (như phân biệt vùng miền, vi phạm quy tắc)
 */

const REGIONAL_DISCRIMINATION_REPLY = "Dmm phân biệt vùng miền";

/**
 * Kiểm tra xem tin nhắn có chứa nội dung phân biệt/miệt thị vùng miền hay không
 * Ví dụ: "Sv 37, sv37, súc vật 37, súc vật nghệ an, sv 36, sv 38, bắc kỳ chó..."
 * @param {string} text
 * @returns {boolean}
 */
function isRegionalDiscrimination(text) {
  if (!text || typeof text !== 'string') return false;

  // 1. Chuẩn hóa cơ bản: chữ thường
  const clean = text.toLowerCase().trim();

  // 2. Chuyển đổi bỏ dấu tiếng Việt để bắt cả không dấu (suc vat 37, nghe an, thanh hoa, do bac ky...)
  const normalizedNoAccent = clean
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

  // Kiểm tra trên cả chuỗi gốc (có dấu) và chuỗi không dấu
  const targets = [clean, normalizedNoAccent];

  for (const str of targets) {
    // 1. Viết tắt "sv" kết hợp biển số: sv 37, sv37, sv-37, sv_37, s.v 37, s.v.37, sv.37...
    // Các đầu số phổ biến trong phân biệt vùng miền: 36 (TH), 37 (NA), 38 (HT), 75 (Huế), 18 (NĐ)
    if (/\bs[\s\.\-_]*v[\s\.\-_]*(?:36|37|38|75|18)\b/i.test(str)) {
      return true;
    }

    // 2. "sv" kết hợp tên vùng: sv nghệ an, sv nghe an, sv thanh hoa, sv ha tinh, sv bac ky, sv nam ky...
    if (/\bs[\s\.\-_]*v[\s\.\-_]*(?:nghệ\s*an|nghe\s*an|thanh\s*hóa|thanh\s*hoa|thanh\s*hoá|hà\s*tĩnh|ha\s*tinh|bắc\s*kỳ|bac\s*ky|nam\s*kỳ|nam\s*ky|trung\s*kỳ|trung\s*ky)\b/i.test(str)) {
      return true;
    }

    // 3. "súc vật" / "suc vat" / "súc sinh" / "suc sinh" + số hoặc tên vùng
    if (/(?:súc\s*vật|suc\s*vat|súc\s*sinh|suc\s*sinh)\s*(?:36|37|38|75|18|nghệ\s*an|nghe\s*an|thanh\s*hóa|thanh\s*hoa|thanh\s*hoá|hà\s*tĩnh|ha\s*tinh|bắc\s*kỳ|bac\s*ky|nam\s*kỳ|nam\s*ky|miền\s*trung|mien\s*trung|miền\s*tây|mien\s*tay|miền\s*bắc|mien\s*bac|miền\s*nam|mien\s*nam)\b/i.test(str)) {
      return true;
    }

    // 4. Đảo ngữ: tên vùng/số + "súc vật" / "chó" / "suc vat" (ví dụ: 37 súc vật, nghệ an súc vật, 36 chó...)
    if (/(?:36|37|38|nghệ\s*an|nghe\s*an|thanh\s*hóa|thanh\s*hoa|hà\s*tĩnh|ha\s*tinh)\s*(?:súc\s*vật|suc\s*vat|súc\s*sinh|suc\s*sinh|chó|cho)\b/i.test(str)) {
      return true;
    }

    // 5. Cụm miệt thị vùng miền đặc trưng
    if (/(?:bắc\s*kỳ\s*chó|bac\s*ky\s*cho|chó\s*bắc\s*kỳ|cho\s*bac\s*ky|bắc\s*cầy|bac\s*cay|nam\s*kỳ\s*chó|nam\s*ky\s*cho|chó\s*nam\s*kỳ|cho\s*nam\s*ky|nam\s*cầy|nam\s*cay|bake\s*chó|chó\s*bake|parky\s*chó|chó\s*parky|hoa\s*thanh\s*quế|hoa\s*thanh\s*que|rau\s*má\s*phá\s*đường\s*tàu|rau\s*ma\s*pha\s*duong\s*tau|khỉ\s*pác\s*bó|khi\s*pac\s*bo)/i.test(str)) {
      return true;
    }

    // 6. Cụm từ xúc phạm nhóm người vùng miền: lũ 36, bọn 37, đám 38, đồ 36, bọn bắc kỳ, lũ nam kỳ...
    if (/(?:đồ|do|lũ|lu|bọn|bon|đám|dam|tụi|tui)\s*(?:36|37|38|bake|parky|nake|bắc\s*kỳ|bac\s*ky|nam\s*kỳ|nam\s*ky)\b/i.test(str)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  isRegionalDiscrimination,
  REGIONAL_DISCRIMINATION_REPLY
};

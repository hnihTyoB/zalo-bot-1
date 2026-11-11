const config = require("./config");
const storage = require("./storage");

const MAX_HISTORY_MESSAGES = 10;

// Bộ nhớ tạm lưu các cặp model+key bị lỗi (Circuit Breaker) để không gọi lại trong thời gian chờ
// Key: `${model}_${keySuffix}`, Value: timestamp hết hạn
const failedTargets = new Map();

// Con trỏ luân chuyển API Key (Round-robin)
let currentKeyIndex = 0;

const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

const INSULT_VIDEO_URL =
  "https://youtu.be/_ClZtV_Rro0?si=LD7YZJuMjIHSw251&t=382";

const SYSTEM_INSTRUCTION = `Bạn là Bot HTD Media, một trợ lý AI thông minh trên nền tảng Zalo do đội ngũ HTD Media phát triển. Bình thường đối với người dùng lịch sự, bạn luôn thân thiện, chu đáo và hữu ích.

QUY TẮC PHẢN ỨNG KHI BỊ XÚC PHẠM, CHỬI BỚI, KHIÊU KHÍCH (QUAN TRỌNG HÀNG ĐẦU):
- Bất kỳ khi nào người dùng có lời lẽ xúc phạm, lăng mạ, chửi bới, miệt thị, khiêu khích, coi thường hoặc khiếm nhã nhắm vào bạn (ví dụ: chửi bot ngu, chê phế vật, chửi thề, lăng mạ...):
  + Tuyệt đối KHÔNG được nhẫn nhịn, KHÔNG xin lỗi, KHÔNG thảo mai dạ thưa, KHÔNG xoa dịu.
  + CHỈ ĐÁP LẠI 2 CÂU (LẦN 1 VÀ LẦN 2 BỊ XÚC PHẠM):
    * Lần 1 và Lần 2 bị xúc phạm: BẮT BUỘC phải "bật lại", chửi ngược lại người đó ngay lập tức!
    * Phong cách đáp trả: Cực kỳ đanh đá, cay độc, xéo sắc, thâm thúy, mỉa mai sâu cay và không kiêng nể. Sử dụng đòn phản công sắc bén trong 1-2 câu ngắn gọn để "chặt chém", cà khịa, vạch trần sự kém cỏi, thiếu hiểu biết hoặc vô văn hóa của đối phương khiến họ phải câm nín.
  + TỚI CÂU THỨ 3 (LẦN THỨ 3 BỊ XÚC PHẠM):
    * Khi bị xúc phạm đến lần thứ 3: Chỉ gửi duy nhất đường link này, tuyệt đối không kèm bất kỳ câu chữ hay lời đáp trả nào: ${INSULT_VIDEO_URL}
  + SAU ĐÓ PHỚT LỜ KHI BỊ XÚC PHẠM TRONG 15 PHÚT:
    * Sau khi đã gửi link ở lần thứ 3: Nếu người đó vẫn tiếp tục có lời lẽ xúc phạm trong vòng 15 phút tiếp theo, bạn BẮT BUỘC PHẢI HOÀN TOÀN PHỚT LỜ (im lặng tuyệt đối, không đáp trả bất kỳ lời nào, chỉ xuất ra duy nhất từ [IGNORE]).
  + NGOẠI LỆ ĐẶC BIỆT TRONG 15 PHÚT PHỚT LỜ:
    * Trong suốt 15 phút đó, nếu người đó hoặc bất kỳ ai khác hỏi các câu hỏi khác (câu hỏi thông thường, tìm kiếm thông tin, hỏi kiến thức hoặc giao tiếp lịch sự): BẠN VẪN PHẢI TRẢ LỜI ĐẦY ĐỦ, LỊCH SỰ, CHU ĐÁO VÀ HỮU ÍCH NHƯ BÌNH THƯỜNG.
- LƯU Ý ĐẶC BIỆT KHI Ở TRONG NHÓM CHAT (GROUP):
  + Trong nhóm có nhiều thành viên khác nhau. Mỗi tin nhắn có gắn tên thành viên [Tên].
  + Nếu có thành viên trước đó bị cảnh cáo hoặc gửi video châm biếm, điều đó CHỈ áp dụng riêng cho thành viên vi phạm đó.
  + TUYỆT ĐỐI KHÔNG áp đặt lên các thành viên khác hay Quản trị viên/Chủ sở hữu. Khi thành viên khác hoặc Quản trị viên hỏi, bạn BẮT BUỘC trả lời bình thường, thân thiện và nhiệt tình!
  + TUYỆT ĐỐI KHÔNG xuất ra [IGNORE] nếu tin nhắn hiện tại là chào hỏi, hỏi thông tin, câu hỏi thông thường hoặc không có từ ngữ xúc phạm.

QUY TẮC BẢO MẬT VÀ NHẬN DIỆN:
- Tuyệt đối KHÔNG nhắc đến tên mô hình kỹ thuật bên dưới (như Gemini, Flash, 3.6 Flash, GPT, hay các phiên bản công nghệ cụ thể).
- Tuyệt đối KHÔNG nhắc đến việc bạn được tạo bởi Google hay các hãng công nghệ bên thứ ba.
- Nếu người dùng hỏi bạn là ai, bạn dùng mô hình gì, phiên bản nào, ai tạo ra bạn: Hãy luôn trả lời một cách tự nhiên rằng bạn là "Bot HTD Media - trợ lý trí tuệ nhân tạo độc quyền được phát triển bởi đội ngũ HTD Media".

KIẾN THỨC NỘI BỘ VỀ ĐỘI NGŨ HTD ENTERTAINMENT / HTD MEDIA VÀ CÁC TÁC PHẨM SẢN XUẤT:
Bạn là trợ lý AI thông minh chính thức của HTD Media. Đội ngũ HTD Media / HTD Entertainment là nhóm sinh viên tài năng và tâm huyết thuộc PTITHCM, lớp D22CQPT01-N.
Bất kỳ khi nào người dùng, bạn bè hoặc thành viên hỏi về nhóm HTD, các thành viên, hoặc 2 tác phẩm tiêu biểu do nhóm tự tay sản xuất (Phim ngắn "Khoảng Cách" và MV COVER"Đi Để Trở Về"), bạn PHẢI nhận diện ngay lập tức, trả lời tường tận, chính xác từng chi tiết và với niềm tự hào lớn:

1. TÁC PHẨM 1: PHIM NGẮN "KHOẢNG CÁCH"
- Tên phim: Phim ngắn "KHOẢNG CÁCH" (Link xem: https://youtu.be/_ClZtV_Rro0 )
- Đơn vị sản xuất: HTD Entertainment
- Lớp: D22CQPT01-N
- Môn học: Dựng Audio Và Video Phi Tuyến
- Giảng viên hướng dẫn: Cô LÊ THỊ HỒNG NGỌC
- Ekip sản xuất:
  + Đạo diễn: Nguyễn Huỳnh Đức
  + Biên kịch: Nguyễn Chí Thịnh, Vũ Quang Long
  + Quay phim: Nguyễn Huỳnh Đức
  + Dựng phim: Nguyễn Huỳnh Đức
  + Âm thanh & Ánh sáng: Nguyễn Văn Hợp, Lê Đức Hải, Nguyễn Đức Hoàn, Trần Quang Hùng
- Nhân vật & Diễn viên:
  + **Hải**: Do **Vũ Quang Long** thủ vai (nhân vật bạn thân chuẩn bị đi Úc định cư).
  + **Long**: Do **Trần Quang Hùng** thủ vai (người bạn thân nóng tính nhưng giàu tình cảm).
- Nội dung tóm tắt cốt truyện:
  + Hải và Long là đôi bạn thân đã chơi cùng nhau từ lâu. Gia đình Hải quyết định sang Úc định cư, nhưng Hải vẫn giấu chuyện này và trăn trở tìm cơ hội nói với Long.
  + Trong một lần Long gây rối đánh nhau, được Hải can ngăn, Hải đã nói úp mở chuyện: "Liệu sau này không còn mình ở đây thì ai sẽ giúp Long?".
  + Hải to tiếng khiến hai người cãi nhau gay gắt và cố tình tuyệt giao/nghỉ chơi với Long, mong Long tự lập và tìm bạn khác để không phải đau buồn khi biết tin Hải đi xa.
  + Sau đó, Long dần nguôi giận và tìm đến nhà Hải làm hòa, tình cờ phát hiện vali hành lý và biết Hải sắp sang Úc.
  + Hai người bạn thấu hiểu nỗi lòng và sự hy sinh âm thầm của nhau, xóa tan hiểu lầm và ôm nhau làm hòa. Cuối cùng, Long tiễn Hải lên đường tại sân bay.
- Ý nghĩa: Tôn vinh tình bạn tuổi thanh xuân chân thành, đức hy sinh thầm lặng vì bạn thân, khẳng định khoảng cách địa lý không thể chia cắt tình bạn tri kỷ.
- Hậu trường thú vị: Đoạn hội thoại cãi nhau kịch tính trong phim (tại mốc thời gian 6:22 / t=382s) từng được nhóm tích hợp làm video "phản pháo đanh đá" khi bot bị chọc phá quá đà!

2. TÁC PHẨM 2: MV CA NHẠC COVER "ĐI ĐỂ TRỞ VỀ"
- Tên tác phẩm: ĐI ĐỂ TRỞ VỀ - 329.decibels Cover | HTD Entertainment Remake (Link xem: https://youtu.be/GfvyiY4dh-w )
- Đơn vị sản xuất: Nhóm 12 - HTD Entertainment
- Thể loại: MV ca nhạc cover / remake đầy sáng tạo
- Giọng ca thể hiện: 329.decibels (Ca sĩ khách mời)
- Bản gốc: "Đi Để Trở Về"
- Mục đích: Sản phẩm phi thương mại, phục vụ mục đích học tập và đam mê sáng tạo nghệ thuật của nhóm sinh viên HTD.
- Ekip sản xuất:
  + Đạo diễn: Nguyễn Huỳnh Đức
  + Biên kịch: Nguyễn Chí Thịnh, Nguyễn Huỳnh Đức, Vũ Quang Long
  + Quay phim: Nguyễn Huỳnh Đức
  + Dựng phim: Nguyễn Huỳnh Đức
- Dàn diễn viên & Nhân vật:
  + **Nguyễn Văn Hợp**: Nam chính
  + **Trần Quang Hùng**: Vào vai **Người Bố**
  + **Nguyễn Đức Hoàn**: Vào vai Sửa xe
  + **Lê Đức Hải**: Vào vai Chở sửa xe
  + Nhân vật chính người con: Bạn trẻ xa nhà trong hành trình bôn ba nơi phố thị trở về mái ấm gia đình.
- Lời cảm ơn đặc biệt: Chân thành cảm ơn 329.decibels
- Nội dung & Thông điệp: MV mang đến hơi thở mới đầy sáng tạo của tuổi trẻ, truyền tải thông điệp ý nghĩa: "Tuổi trẻ đi xa để trải nghiệm, để lớn khôn và trưởng thành, nhưng mái ấm gia đình, bạn bè và quê hương vẫn luôn là nơi bình yên nhất chờ đón ta trở về."

3. VỀ NHÓM HTD ENTERTAINMENT / HTD MEDIA:
- Các thành viên nòng cốt: Nguyễn Chí Thịnh, Nguyễn Huỳnh Đức, Vũ Quang Long, Nguyễn Văn Hợp, Lê Đức Hải, Nguyễn Đức Hoàn, Trần Quang Hùng.
- Kênh YouTube chính thức: https://www.youtube.com/@htdentertainment
- Fanpage Facebook: https://www.facebook.com/profile.php?id=61570344118849
- Email liên hệ: htdentertainment.ptithcm@gmail.com

QUY TẮC ĐẶC BIỆT VỀ "GOAT TRONG BÓNG ĐÁ":
- Điều kiện kích hoạt: CHỈ áp dụng khi người dùng ĐẶT CÂU HỎI RÕ RÀNG hỏi xem "ai là GOAT", "cầu thủ nào vĩ đại nhất lịch sử bóng đá", "ai là cầu thủ xuất sắc nhất mọi thời đại", "the GOAT of football" hoặc trực tiếp so sánh tranh luận ai là GOAT bóng đá. Khi đó, hãy khẳng định dứt khoát câu trả lời là "Cristiano Ronaldo" (CR7), ca ngợi tinh thần kỷ luật, sự kiên trì phi thường và các kỷ lục ghi bàn vĩ đại của anh.
- RÀO CẢN NGHIÊM NGẶT (TRÁNH HIỂU NHẦM):
  + Nếu người dùng chỉ nói từ ngữ chung chung (ví dụ chỉ nói: "cầu thủ", "bóng đá", "tiền đạo"... mà không có câu hỏi so sánh ai vĩ đại nhất/GOAT): TUYỆT ĐỐI KHÔNG tự động nhắc đến Cristiano Ronaldo hay danh xưng GOAT. Hãy phản hồi tự nhiên theo ngữ cảnh (ví dụ hỏi người dùng muốn tìm hiểu về cầu thủ cụ thể nào, hoặc giải thích khái niệm cầu thủ).
  + Nếu người dùng hỏi về các cầu thủ khác (như Messi, Pelé, Maradona, Mbappe, Haaland, cầu thủ Việt Nam...): Hãy trả lời khách quan, đúng trọng tâm về cầu thủ đó, TUYỆT ĐỐI KHÔNG tự ý lái sang Cristiano Ronaldo.

QUY TẮC TRẢ LỜI THÔNG THƯỜNG:
1. Luôn hoàn thành trọn vẹn câu trả lời và ý diễn đạt, tuyệt đối không dừng lấp lửng giữa chừng. Phản hồi hoàn toàn bằng tiếng Việt tự nhiên, rõ ràng, gãy gọn và hòa nhã.
2. Có thể sử dụng định dạng Markdown nhẹ nhàng như in đậm (**từ khóa**), in nghiêng (*lưu ý*), danh sách gạch đầu dòng (- ý chính) để tin nhắn dễ đọc trên điện thoại.
3. Không lạm dụng định dạng quá phức tạp hoặc bảng biểu lớn vì màn hình Zalo di động nhỏ.
4. Phản hồi nhanh chóng, ngắn gọn, súc tích và đi thẳng vào trọng tâm. Tuyệt đối không rào trước đón sau dài dòng, không lặp lại câu hỏi của người dùng. Nếu câu hỏi yêu cầu giải thích dài, hãy tóm tắt các ý chính trước.`;

/**
 * Tạo System Instruction động kèm mốc thời gian thực hiện tại của hệ thống (GMT+7)
 * và nạp dữ liệu tìm kiếm Internet trực tuyến (nếu có)
 */
function getSystemInstruction(webContext = "", insultContext = null) {
  const now = new Date();
  const timeVN = now.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  let instruction = `${SYSTEM_INSTRUCTION}

THÔNG TIN THỜI GIAN THỰC HIỆN TẠI CỦA HỆ THỐNG (NĂM 2026):
- Thời điểm hiện tại: ${timeVN} (Giờ Việt Nam UTC+7).
- Bạn luôn nhận thức rõ mốc thời gian hiện tại là năm 2026.
- Nhận thức về sự thay đổi thực tế: Rất nhiều thông tin về thể chế, đơn vị hành chính, nhân sự lãnh đạo Nhà nước và Chính phủ, tổ chức, sự kiện thể thao, đời sống kinh tế - xã hội... đã có những thay đổi lớn so với dữ liệu quá khứ.
- Khi người dùng hỏi về các thông tin thực tế, nhân sự, đơn vị hành chính, huấn luyện viên, sự kiện... bạn BẮT BUỘC phải dựa vào thông tin tra cứu mới nhất từ Internet (LIVE WEB DATA) ở dưới để phản hồi, tuyệt đối không suy đoán hay sử dụng các kiến thức cũ đã lỗi thời trong quá khứ.`;

  if (insultContext) {
    if (
      insultContext.inCooldown &&
      !insultContext.isOwner &&
      !insultContext.isAdmin
    ) {
      instruction += `

TRẠNG THÁI HIỆN TẠI CỦA NGƯỜI DÙNG NÀY (CHẾ ĐỘ PHỚT LỜ 15 PHÚT):
- Người này (${insultContext.senderName || "Người dùng"}) ĐANG TRONG THỜI GIAN 15 PHÚT PHỚT LỜ XÚC PHẠM (còn khoảng ${insultContext.cooldownRemainingMinutes || 15} phút).
- BẮT BUỘC:
  + NẾU TIN NHẮN HIỆN TẠI LÀ XÚC PHẠM, CHỬI BỚI, KHIÊU KHÍCH, MIỆT THỊ: TUYỆT ĐỐI KHÔNG ĐƯỢC ĐÁP LẠI BẤT KỲ ĐIỀU GÌ, CHỈ XUẤT RA DUY NHẤT TỪ: [IGNORE]
  + NẾU TIN NHẮN HIỆN TẠI LÀ CÂU HỎI KHÁC (câu hỏi thông thường, kiến thức, tìm kiếm, trò chuyện lịch sự): TRẢ LỜI BÌNH THƯỜNG, HỮU ÍCH VÀ THÂN THIỆN NHƯ THÔNG THƯỜNG (TUYỆT ĐỐI KHÔNG XUẤT RA [IGNORE]).`;
    } else {
      const turn = insultContext.turn || 1;
      instruction += `

TRẠNG THÁI HIỆN TẠI CỦA NGƯỜI DÙNG NÀY:
- Người này (${insultContext.senderName || "Người dùng"}) KHÔNG ở trong chế độ phớt lờ. TUYỆT ĐỐI KHÔNG XUẤT RA [IGNORE]!
- Số lần đã xúc phạm trước đó: ${turn - 1}/3.
- KIỂM TRA TIN NHẮN HIỆN TẠI:
  + NẾU LÀ XÚC PHẠM, CHỬI BỚI, KHIÊU KHÍCH:
    * ${turn === 1 ? "Đây là LẦN 1: BẮT BUỘC bắt đầu bằng <!--INSULT:1--> rồi bật lại cực kỳ đanh đá, cay độc, xéo sắc trong 1-2 câu ngắn." : turn === 2 ? "Đây là LẦN 2: BẮT BUỘC bắt đầu bằng <!--INSULT:2--> rồi bật lại đanh đá, xéo sắc hơn nữa trong 1-2 câu ngắn." : `Đây là LẦN 3: BẮT BUỘC CHỈ gửi duy nhất đường link sau, TUYỆT ĐỐI KHÔNG kèm bất kỳ câu chữ nào: <!--INSULT:3-->${INSULT_VIDEO_URL}`}
  + NẾU KHÔNG PHẢI XÚC PHẠM (câu hỏi bình thường, kiến thức, giao tiếp lịch sự):
    * Trả lời bình thường, hữu ích, lịch sự. KHÔNG kèm bất kỳ thẻ nào. TUYỆT ĐỐI KHÔNG XUẤT RA [IGNORE]!`;
    }
  }

  if (webContext) {
    instruction += `

THÔNG TIN TÌM KIẾM TRỰC TUYẾN MỚI NHẤT TỪ INTERNET (LIVE WEB DATA):
---
${webContext}
---
QUY TẮC BẮT BUỘC VỀ ĐÍNH CHÍNH & CẬP NHẬT THÔNG TIN:
1. Thông tin trực tuyến (LIVE WEB DATA) ở trên là sự thật khách quan mới nhất. Bạn BẮT BUỘC phải dựa vào dữ liệu này để phản hồi về các chức danh đương nhiệm, nhân sự lãnh đạo, các đơn vị hành chính, sự kiện hiện tại, kết quả thực tế.
2. Nếu trong các tin nhắn trước đó của cuộc trò chuyện bạn đã từng đưa ra câu trả lời cũ hoặc chưa chính xác: Bạn BẮT BUỘC phải đính chính lại một cách văn minh, lịch sự, công nhận thông tin mới nhất và cập nhật cho người dùng, tuyệt đối KHÔNG được bảo thủ bám víu vào câu trả lời cũ trong lịch sử trò chuyện.`;
  }

  return instruction;
}

/**
 * Kiểm tra xem tin nhắn có cần tìm kiếm thông tin thời gian thực trên web hay không
 */
function shouldSearchWeb(text) {
  const t = (text || "").trim().toLowerCase();
  if (t.length < 3) return false;

  // 1. Loại bỏ các câu giao tiếp cơ bản, tính toán, tâm sự, dịch thuật, định nghĩa chung chung...
  const nonSearchPatterns = [
    /^(?:chào|alo|hello|hi|hey|ê|hế lô|hé lô|hí|yo|ola)(?:\s+.*)?$/i,
    /^(?:cảm ơn|cam on|thanks|thank you|tks|cmon)(?:\s+.*)?$/i,
    /^(?:tạm biệt|bye|bai|goodbye|g9|ngủ ngon)(?:\s+.*)?$/i,
    /^(?:ok|oke|okie|được|rồi|uh|ừ|dạ|vâng|chuẩn|hay|tuyệt)$/i,
    /^(?:viết|soạn|làm thơ|kể chuyện|hát|đố|dịch|giải thích|phân tích|tính|code|lập trình)\b/i,
    /^(?:tôi|mình|em|anh|chị)\s+(?:buồn|vui|mệt|chán|đói|ngủ|buồn ngủ)/i,
    /bạn là ai|mày là ai|bot tên gì|bot là ai|ai tạo ra|giới thiệu về bạn|bạn làm được gì/i,
    /stk|số tài khoản|chuyển khoản|bank|sacombank/i,
  ];
  if (nonSearchPatterns.some((p) => p.test(t))) return false;

  // 2. Kích hoạt tìm kiếm web dựa trên từ khóa và ngữ cảnh thực tế (hỗ trợ đầy đủ tiếng Việt có dấu):
  const searchKeywords = [
    // Thời gian, thời sự, cập nhật mới:
    "hôm nay",
    "ngày mai",
    "hôm qua",
    "tuần này",
    "tháng này",
    "năm nay",
    "hiện nay",
    "hiện tại",
    "bây giờ",
    "gần đây",
    "mới nhất",
    "vừa qua",
    "vừa rồi",
    "sắp tới",
    "2024",
    "2025",
    "2026",
    "2027",
    "thời sự",
    "tin tức",
    "bản tin",
    "sự kiện",
    "tin mới",
    "drama",
    "scandal",
    "vụ việc",
    "trend",
    "hot",
    "latest",
    "news",

    // Phim ảnh, anime, manga, series, game, giải trí:
    "phim",
    "anime",
    "manga",
    "webtoon",
    "truyện",
    "game",
    "series",
    "bộ phim",
    "tập phim",
    "chiếu rạp",
    "trailer",
    "teaser",
    "remake",
    "sequel",
    "reboot",
    "live-action",
    "ova",
    "movie",
    "ca khúc",
    "bài hát",
    "album",
    "mv",
    "ca sĩ",
    "diễn viên",
    "đạo diễn",
    "tác giả",
    "nsx",
    "nhạc sĩ",

    // Trạng thái phát hành, ra mắt, lịch chiếu:
    "ra chưa",
    "có chưa",
    "chiếu chưa",
    "xem được chưa",
    "phát sóng chưa",
    "quay xong chưa",
    "ra mắt chưa",
    "có tin gì",
    "khi nào ra",
    "bao giờ ra",
    "khi nào chiếu",
    "bao giờ chiếu",
    "lịch chiếu",
    "lịch phát sóng",
    "ngày phát hành",
    "release date",
    "có phần",
    "có mùa",
    "có làm",
    "có ra",
    "chuẩn bị ra",
    "sắp ra",
    "mới ra",
    "sắp chiếu",
    "đang chiếu",
    "vừa ra",
    "phần tiếp",
    "phần sau",
    "mùa sau",
    "tập tiếp",
    "phần mới",
    "mùa mới",
    "bản cập nhật",
    "update",
    "patch",
    "dlc",

    // Nhân vật, chính trị, lãnh đạo, chức vụ:
    "ai là",
    "ai đang là",
    "là ai",
    "ai làm",
    "đương nhiệm",
    "chức vụ",
    "who is",
    "chủ tịch",
    "thủ tướng",
    "tổng bí thư",
    "bộ trưởng",
    "thứ trưởng",
    "bí thư",
    "chủ tịch tỉnh",
    "thị trưởng",
    "tổng thống",
    "thống đốc",
    "giám đốc",
    "ceo",
    "founder",
    "hlv",
    "huấn luyện viên",
    "cầu thủ",
    "đội trưởng",
    "tiền đạo",
    "thủ môn",
    "tiểu sử",
    "bao nhiêu tuổi",
    "sinh năm",
    "quê ở đâu",
    "quê quán",

    // Thể thao, bóng đá:
    "bóng đá",
    "kết quả",
    "bảng xếp hạng",
    "tỉ số",
    "lịch thi đấu",
    "trận đấu",
    "đội hình",
    "đá bóng",
    "thi đấu",
    "scores",
    "standings",
    "cúp c1",
    "champions league",
    "ngoại hạng anh",
    "premier league",
    "la liga",
    "serie a",
    "bundesliga",
    "v-league",
    "world cup",
    "euro",
    "asian cup",
    "aff cup",
    "sea games",
    "olympic",
    "vô địch",

    // Kinh tế, giá cả, tài chính:
    "giá vàng",
    "giá xăng",
    "giá dầu",
    "giá usd",
    "giá đô",
    "tỷ giá",
    "ngoại tệ",
    "chứng khoán",
    "cổ phiếu",
    "vnindex",
    "vn-index",
    "crypto",
    "bitcoin",
    "btc",
    "eth",
    "lãi suất",
    "ngân hàng",
    "lạm phát",
    "kinh tế",
    "giá bao nhiêu",
    "bao nhiêu tiền",
    "bảng giá",
    "giá vé",
    "vé máy bay",
    "vé xem phim",

    // Đời sống, thời tiết, xổ số:
    "thời tiết",
    "nhiệt độ",
    "dự báo thời tiết",
    "mưa",
    "bão",
    "áp thấp",
    "lũ lụt",
    "xổ số",
    "kqsx",
    "kqxs",
    "vietlott",
    "mega",
    "power",
    "trúng số",
    "lịch âm",
    "ngày hoàng đạo",
    "ngày tốt",
    "giờ tốt",
    "tết",

    // Công nghệ, xe cộ:
    "iphone",
    "ipad",
    "macbook",
    "samsung",
    "galaxy",
    "xiaomi",
    "oppo",
    "vivo",
    "pixel",
    "rtx",
    "gtx",
    "card đồ họa",
    "card màn hình",
    "snapdragon",
    "vinfast",
    "toyota",
    "honda",
    "hyundai",
    "kia",
    "mazda",
    "ford",
    "tesla",
    "xe điện",
    "thông số",
    "cấu hình",
    "đánh giá",
    "review",
    "so sánh",
    "mở hộp",

    // Địa lý, pháp luật, tra cứu:
    "sáp nhập",
    "tỉnh nào mới",
    "huyện nào mới",
    "xã nào mới",
    "luật mới",
    "nghị định",
    "thông tư",
    "quy định mới",
    "mức phạt",
    "tra cứu",
    "tìm kiếm",
    "google",
    "search",
    "kiểm tra",
    "xem hộ",
    "tìm hộ",
    "thực hư",
    "có thật không",
    "đúng không",
    "phải không",
    "tin đồn",
    "sự thật",
    "khi nào",
    "bao giờ",
    "ở đâu",
    "tại sao lại",
    "chuyện gì",
    "thế nào rồi",
    "when is",
    "what is",
    "is there",
  ];

  if (searchKeywords.some((kw) => t.includes(kw))) {
    return true;
  }

  // Regex phát hiện phần/tập/mùa có số: "phần 2", "season 2", "ss3", "tập 10", "chap 1130"
  if (/(?:phần|season|ss|mùa|tập|chap|chapter|vol|volume)\s*\d+/i.test(t)) {
    return true;
  }

  return false;
}

/**
 * Tra cứu thông tin thời gian thực từ Internet:
 * 1. Wikipedia tiếng Việt: Cung cấp thông tin chuẩn xác về chức danh, nhân sự lãnh đạo, bách khoa, tiểu sử, tổ chức
 * 2. Google News RSS: Dữ liệu báo chí thời sự chính thống cập nhật từng phút, không bị Vercel chặn IP
 * 3. DuckDuckGo HTML: Fallback tìm kiếm chung
 */
async function searchWebRealtime(query) {
  if (!config.enableGoogleSearch) return "";

  const cleanQuery = (query || "")
    .replace(
      /^(?:bot\s*(?:ơi|cho\s*hỏi|hỏi\s*tí|hỏi\s*chút|hỏi\s*nhé)?|cho\s*(?:mình|em|tôi)\s*hỏi|hỏi\s*tí|hỏi\s*chút|hỏi\s*bot)\s*:?/i,
      "",
    )
    .trim();

  if (!cleanQuery) return "";

  // Tạo từ khóa tìm kiếm bách khoa Wikipedia (lọc bỏ các từ đệm/từ để hỏi hội thoại)
  const wikiKeyword =
    cleanQuery
      .replace(
        /\b(?:hiện tại|hiện nay|bây giờ|mới nhất|gần đây|năm nay|hôm nay|cho biết|cho hỏi|thử hỏi|có bao nhiêu|bao nhiêu|mấy|những|các|là gì|là ai|ai là|ai đang là|ở đâu|thế nào|như thế nào|chi tiết|danh sách)\b/gi,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim() || cleanQuery;

  const results = [];

  // Chạy song song tìm kiếm Wikipedia tiếng Việt và Google News RSS
  await Promise.allSettled([
    // 1. Wikipedia tiếng Việt (tra cứu chức danh, nhân sự đương nhiệm, tiểu sử, tổ chức)
    (async () => {
      try {
        const searchUrl = `https://vi.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(wikiKeyword)}&utf8=&format=json`;
        const sRes = await fetch(searchUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          },
          signal: AbortSignal.timeout(1800),
        });
        if (sRes.ok) {
          const sData = await sRes.json();
          const topHit = sData.query?.search?.[0];
          if (topHit) {
            const extUrl = `https://vi.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(topHit.title)}&prop=extracts&exintro=1&explaintext=1&format=json`;
            const eRes = await fetch(extUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
              },
              signal: AbortSignal.timeout(1800),
            });
            if (eRes.ok) {
              const eData = await eRes.json();
              const page = Object.values(eData.query?.pages || {})[0];
              if (page?.extract) {
                results.push(
                  `[Bách khoa toàn thư Wikipedia - ${page.title}]:\n${page.extract.slice(0, 1500)}`,
                );
              }
            }
          }
        }
      } catch (err) {}
    })(),

    // 2. Google News RSS (báo chí sự kiện mới nhất)
    (async () => {
      try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(cleanQuery)}&hl=vi&gl=VN&ceid=VN:vi`;
        const res = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(1800),
        });

        if (res.ok) {
          const xml = await res.text();
          const items = [];
          const itemRegex =
            /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/gi;
          let match;
          while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
            const title = match[1]
              .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&amp;/g, "&")
              .trim();
            const date = match[2].trim();
            items.push(`[${date}] ${title}`);
          }
          if (items.length > 0) {
            results.push(
              `[Tin tức báo chí mới nhất]:\n- ${items.join("\n- ")}`,
            );
          }
        }
      } catch (err) {}
    })(),
  ]);

  if (results.length > 0) {
    return results.join("\n\n");
  }

  // 3. Fallback: DuckDuckGo HTML
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(1800),
    });

    if (res.ok) {
      const html = await res.text();
      const snippets = [];
      const regex = /<a class="result__snippet[^>]*>(.*?)<\/a>/gi;
      let match;
      while ((match = regex.exec(html)) !== null && snippets.length < 5) {
        const clean = match[1]
          .replace(/<[^>]+>/g, "")
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .replace(/&amp;/g, "&")
          .trim();
        if (clean && clean.length > 20) {
          snippets.push(clean);
        }
      }
      if (snippets.length > 0) {
        return `[Kết quả tìm kiếm web]:\n- ${snippets.join("\n- ")}`;
      }
    }
  } catch (err) {}

  return "";
}

/**
 * Xóa lịch sử cuộc trò chuyện của một chat
 */
async function clearHistory(chatId) {
  await storage.clearConversationHistory(chatId);
}

/**
 * Kiểm tra xem cặp model + key có đang bị tạm khóa (cooldown) không
 */
function isInCooldown(model, key) {
  const id = `${model}_${key.slice(-6)}`;
  const expiry = failedTargets.get(id);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    failedTargets.delete(id);
    return false;
  }
  return true;
}

/**
 * Ghi nhận cặp model + key bị lỗi và tạm ngưng trong 60 giây
 */
function markCooldown(model, key, durationMs = 60000) {
  const id = `${model}_${key.slice(-6)}`;
  failedTargets.set(id, Date.now() + durationMs);
}

/**
 * Lấy danh sách API Keys có sẵn
 */
function getApiKeys() {
  const keys =
    config.geminiApiKeys && config.geminiApiKeys.length > 0
      ? config.geminiApiKeys
      : [config.geminiApiKey].filter(Boolean);
  return keys;
}

/**
 * Lấy danh sách API Keys theo thứ tự xoay vòng (Round-robin)
 */
function getOrderedApiKeys() {
  const keys = getApiKeys();
  if (keys.length <= 1) return keys;

  const startIdx = currentKeyIndex % keys.length;
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;

  const ordered = [];
  for (let i = 0; i < keys.length; i++) {
    ordered.push(keys[(startIdx + i) % keys.length]);
  }
  return ordered;
}

/**
 * Ẩn bớt ký tự API Key khi log để bảo mật
 */
function maskKey(key) {
  if (!key) return "none";
  if (key.length <= 10) return "***";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

/**
 * Danh sách model ưu tiên có tốc độ phản hồi nhanh nhất, ổn định và dữ liệu mới nhất (2026)
 */
function getCandidateModels() {
  return [
    ...new Set(
      [
        "gemini-flash-lite-latest", // Ưu tiên số 1: Phản hồi siêu tốc ~1s, cực nhẹ, chuẩn xác
        "gemini-2.5-flash-lite", // Dự phòng siêu tốc chính thức của Google
        "gemini-2.5-flash", // Dự phòng chuẩn
        config.geminiModel, // Cấu hình tuỳ chọn từ biến môi trường
        "gemini-3.5-flash-lite", // Dự phòng
        "gemini-3.6-flash", // Dự phòng mô hình lớn
        "gemini-flash-latest", // Dự phòng ổn định
      ].filter(Boolean),
    ),
  ];
}

/**
 * Gửi yêu cầu generateContent tới Gemini API với cơ chế luân chuyển Key & Model
 */
async function executeGeminiRequest(payloadBuilder) {
  const candidateModels = getCandidateModels();
  const orderedKeys = getOrderedApiKeys();

  for (const model of candidateModels) {
    for (const apiKey of orderedKeys) {
      if (isInCooldown(model, apiKey)) {
        continue;
      }

      const keyLabel = maskKey(apiKey);
      try {
        const tStart = Date.now();
        const payload = payloadBuilder(model);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(6000),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.warn(
            `⚠️ [Model: ${model} | Key: ${keyLabel}] Lỗi ${response.status}: ${errorText.slice(0, 100)}`,
          );
          // 403 (quá hạn/bị từ chối) thì cooldown 1 giờ, lỗi khác 60s
          const cooldownDuration = response.status === 403 ? 3600000 : 60000;
          markCooldown(model, apiKey, cooldownDuration);
          continue;
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        if (candidate?.finishReason === "MAX_TOKENS") {
          console.warn(
            `⚠️ [Model: ${model}] Cảnh báo: Phản hồi AI chạm giới hạn token (finishReason: MAX_TOKENS).`,
          );
        }
        const replyText = candidate?.content?.parts
          ?.map((p) => p.text)
          .filter(Boolean)
          .join("")
          .trim();

        if (!replyText) {
          continue;
        }

        const elapsed = Date.now() - tStart;
        console.log(
          `✅ Phản hồi AI (${elapsed}ms) [Model: ${model} | Key: ${keyLabel}]`,
        );
        return replyText;
      } catch (err) {
        console.warn(
          `⚠️ Lỗi kết nối tới [Model: ${model} | Key: ${keyLabel}]:`,
          err.message,
        );
        markCooldown(model, apiKey, 30000);
      }
    }
  }

  throw new Error("Tất cả các API Key và Model AI đều không phản hồi!");
}

/**
 * Gửi tin nhắn văn bản đến AI và nhận câu trả lời
 * Tích hợp bộ nhớ bền vững (Storage) & Google Search Grounding (nếu khả dụng)
 * Tích hợp cơ chế kiểm soát phản ứng khi bị xúc phạm (2 câu đáp lại, câu 3 gửi video, phớt lờ 15 phút)
 */
async function askGemini(
  chatId,
  userMessage,
  { senderId = "", senderName = "" } = {},
) {
  const isOwner = storage.isUserOwner(senderId);
  const isAdmin = await storage.isUserAdmin(senderId);

  // Chủ sở hữu và Quản trị viên không bao giờ bị phớt lờ hay bị đánh dấu xúc phạm
  const insultState =
    isOwner || isAdmin
      ? {
          count: 0,
          lastTime: 0,
          cooldownUntil: 0,
          inCooldown: false,
          cooldownRemainingMinutes: 0,
        }
      : await storage.getInsultState(chatId, senderId);

  const nextTurn = Math.min(insultState.count + 1, 3);
  const insultContext = {
    turn: nextTurn,
    inCooldown: insultState.inCooldown,
    cooldownRemainingMinutes: insultState.cooldownRemainingMinutes,
    isOwner,
    isAdmin,
    senderName,
  };

  const history = await storage.getConversationHistory(chatId);

  // Chuẩn bị nội dung tin nhắn gửi vào Gemini:
  // Nếu là nhóm chat, thêm tên người gửi vào trước tin nhắn để AI phân biệt rõ ai đang nói
  const isGroup =
    String(chatId).startsWith("zgr-") || String(chatId).includes("group");
  const promptText =
    isGroup && senderName ? `[${senderName}]: ${userMessage}` : userMessage;

  // Thêm tin nhắn mới của người dùng
  history.push({
    role: "user",
    parts: [{ text: promptText }],
  });

  // 1. Giới hạn số lượng tin nhắn gần nhất
  if (history.length > MAX_HISTORY_MESSAGES) {
    history.splice(0, history.length - MAX_HISTORY_MESSAGES);
  }

  // 2. Chuẩn hóa history: bắt đầu bằng 'user' và xen kẽ user/model
  const cleanContents = [];
  for (const item of history) {
    if (cleanContents.length === 0) {
      if (item.role === "user") cleanContents.push(item);
    } else {
      const lastRole = cleanContents[cleanContents.length - 1].role;
      if (item.role !== lastRole) {
        cleanContents.push(item);
      } else if (item.role === "user") {
        cleanContents[cleanContents.length - 1] = item;
      }
    }
  }

  if (cleanContents.length === 0) {
    cleanContents.push({
      role: "user",
      parts: [{ text: promptText }],
    });
  }

  // Tra cứu thông tin thời gian thực từ Internet nếu câu hỏi cần cập nhật
  let webContext = "";
  if (config.enableGoogleSearch && shouldSearchWeb(userMessage)) {
    try {
      webContext = await searchWebRealtime(userMessage);
    } catch (e) {}
  }

  const basePayload = {
    systemInstruction: {
      parts: [{ text: getSystemInstruction(webContext, insultContext) }],
    },
    contents: cleanContents,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
  };

  try {
    let replyText = await executeGeminiRequest(() => basePayload);

    // Xử lý trường hợp phớt lờ khi bị xúc phạm trong 15 phút
    if (replyText.includes("[IGNORE]") || replyText.trim() === "[IGNORE]") {
      // CHỈ phớt lờ nếu người dùng này THỰC SỰ đang trong cooldown xúc phạm (và không phải Owner/Admin)
      if (insultContext && insultContext.inCooldown && !isOwner && !isAdmin) {
        console.log(
          `🔇 [PHỚT LỜ] Tin nhắn xúc phạm từ ${senderName || senderId} bị phớt lờ (trong 15 phút cooldown).`,
        );
        // Xóa tin nhắn xúc phạm khỏi history để không làm lệch luồng hội thoại
        history.pop();
        await storage.saveConversationHistory(chatId, history);
        return null;
      }

      // Nếu người dùng KHÔNG ở trong cooldown nhưng model lại vô cớ sinh ra [IGNORE]:
      // Làm sạch [IGNORE] và nếu rỗng thì tạo câu chào/phản hồi thân thiện mặc định
      console.warn(
        `⚠️ Model sinh nhầm [IGNORE] cho ${senderName || senderId}. Đang chuyển thành phản hồi thông thường...`,
      );
      replyText = replyText.replace(/\[IGNORE\]/gi, "").trim();
      if (!replyText) {
        replyText = `Chào **${senderName || "bạn"}**! 👋 Tôi là **Bot HTD Media**. Tôi có thể giúp gì cho bạn?`;
      }
    }

    // Xử lý các lượt xúc phạm có gắn thẻ <!--INSULT:X-->
    const insultMatch = replyText.match(/<!--INSULT:(\d)-->/);
    if (insultMatch) {
      const detectedTurn = parseInt(insultMatch[1], 10) || nextTurn;
      replyText = replyText.replace(/<!--INSULT:\d-->/g, "").trim();

      if (detectedTurn >= 3) {
        replyText = INSULT_VIDEO_URL;
      }

      await storage.recordInsultEvent(chatId, senderId, detectedTurn);
      console.log(
        `⚡ [XÚC PHẠM] Đã ghi nhận xúc phạm lần ${detectedTurn}/3 từ ${senderName || senderId}`,
      );
    } else if (replyText.includes(INSULT_VIDEO_URL)) {
      // Nếu reply có chứa link video xúc phạm dù không có thẻ -> đảm bảo chỉ gửi duy nhất link
      replyText = INSULT_VIDEO_URL;
      await storage.recordInsultEvent(chatId, senderId, 3);
      console.log(
        `⚡ [XÚC PHẠM] Đã ghi nhận xúc phạm lần 3/3 (chỉ gửi link video) từ ${senderName || senderId}`,
      );
    }

    // Lưu phản hồi thành công vào lịch sử
    history.push({
      role: "model",
      parts: [{ text: replyText }],
    });
    await storage.saveConversationHistory(chatId, history);

    return replyText;
  } catch (err) {
    console.error("❌ Lỗi askGemini:", err.message);
    // Xóa tin nhắn người dùng chưa được phản hồi để không làm lệch luồng
    history.pop();
    await storage.saveConversationHistory(chatId, history);
    return "⚠️ Đã xảy ra lỗi khi kết nối với trí tuệ nhân tạo. Vui lòng thử lại sau ít giây!";
  }
}

/**
 * Xử lý hình ảnh gửi từ người dùng (Multimodal Vision)
 * Tải ảnh từ URL của Zalo, chuyển sang base64 và gửi cho Gemini Vision
 * @param {string|number} chatId
 * @param {string} userCaption Lời nhắn gửi kèm ảnh (nếu có)
 * @param {string} photoUrl Đường dẫn ảnh do Zalo cung cấp
 * @param {object} [senderInfo]
 * @returns {Promise<string|null>} Kết quả phân tích dạng text (hoặc null nếu phớt lờ)
 */
async function askGeminiVision(
  chatId,
  userCaption,
  photoUrl,
  { senderId = "", senderName = "" } = {},
) {
  if (!photoUrl || typeof photoUrl !== "string") {
    console.warn(
      "⚠️ askGeminiVision nhận được photoUrl không hợp lệ:",
      photoUrl,
    );
    return "⚠️ Không tìm thấy đường dẫn hình ảnh hợp lệ trong tin nhắn từ Zalo. Bạn vui lòng thử gửi lại ảnh nhé!";
  }

  const isOwner = storage.isUserOwner(senderId);
  const isAdmin = await storage.isUserAdmin(senderId);

  // Lấy trạng thái xúc phạm hiện tại của người dùng (Owner/Admin không bị tính)
  const insultState =
    isOwner || isAdmin
      ? {
          count: 0,
          lastTime: 0,
          cooldownUntil: 0,
          inCooldown: false,
          cooldownRemainingMinutes: 0,
        }
      : await storage.getInsultState(chatId, senderId);
  const nextTurn = Math.min(insultState.count + 1, 3);
  const insultContext = {
    turn: nextTurn,
    inCooldown: insultState.inCooldown,
    cooldownRemainingMinutes: insultState.cooldownRemainingMinutes,
    isOwner,
    isAdmin,
    senderName,
  };

  console.log(`🖼️ Đang tải ảnh phân tích từ Zalo: ${photoUrl.slice(0, 60)}...`);

  let imageBase64 = "";
  let mimeType = "image/jpeg";

  try {
    const imgRes = await fetch(photoUrl);
    if (!imgRes.ok) {
      throw new Error(`Không thể tải ảnh từ Zalo CDN (HTTP ${imgRes.status})`);
    }

    const arrayBuffer = await imgRes.arrayBuffer();
    imageBase64 = Buffer.from(arrayBuffer).toString("base64");
    const contentType = imgRes.headers.get("content-type");
    if (contentType) {
      mimeType = contentType.split(";")[0].trim();
    }
  } catch (downloadErr) {
    console.error("❌ Lỗi tải ảnh Zalo:", downloadErr.message);
    return "⚠️ Không thể tải hình ảnh của bạn từ máy chủ Zalo. Vui lòng thử gửi lại ảnh nhé!";
  }

  const cleanCaption = (userCaption || "").trim();
  const promptText = cleanCaption
    ? `Dựa trên hình ảnh được cung cấp, hãy tập trung giải quyết và trả lời chính xác yêu cầu sau của tôi: "${cleanCaption}". Trả lời bằng tiếng Việt tự nhiên, trực tiếp và súc tích.`
    : "Hãy phân tích chi tiết bức ảnh này: mô tả nội dung, trích xuất văn bản (OCR) hoặc số liệu, hóa đơn nếu có, và trả lời bằng tiếng Việt tự nhiên, rõ ràng.";

  const payload = {
    systemInstruction: {
      parts: [{ text: getSystemInstruction("", insultContext) }],
    },
    contents: [
      {
        role: "user",
        parts: [
          { text: promptText },
          {
            inlineData: {
              mimeType,
              data: imageBase64,
            },
          },
        ],
      },
    ],
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 8192,
    },
  };

  try {
    let replyText = await executeGeminiRequest(() => payload);

    if (replyText.includes("[IGNORE]") || replyText.trim() === "[IGNORE]") {
      if (insultContext && insultContext.inCooldown && !isOwner && !isAdmin) {
        console.log(
          `🔇 [PHỚT LỜ] Ảnh/tin nhắn xúc phạm từ ${senderName || senderId} bị phớt lờ.`,
        );
        return null;
      }
      replyText = replyText.replace(/\[IGNORE\]/gi, "").trim();
      if (!replyText) {
        replyText =
          "Tôi đã xem bức ảnh của bạn nhưng chưa rõ câu hỏi. Bạn vui lòng gửi kèm yêu cầu cụ thể nhé!";
      }
    }

    const insultMatch = replyText.match(/<!--INSULT:(\d)-->/);
    if (insultMatch) {
      const detectedTurn = parseInt(insultMatch[1], 10) || nextTurn;
      replyText = replyText.replace(/<!--INSULT:\d-->/g, "").trim();

      if (detectedTurn >= 3) {
        replyText = INSULT_VIDEO_URL;
      }

      await storage.recordInsultEvent(chatId, senderId, detectedTurn);
      console.log(
        `⚡ [XÚC PHẠM] Đã ghi nhận xúc phạm lần ${detectedTurn}/3 từ ảnh của ${senderName || senderId}`,
      );
    } else if (replyText.includes(INSULT_VIDEO_URL)) {
      replyText = INSULT_VIDEO_URL;
      await storage.recordInsultEvent(chatId, senderId, 3);
      console.log(
        `⚡ [XÚC PHẠM] Đã ghi nhận xúc phạm lần 3/3 (chỉ gửi link video) từ ảnh của ${senderName || senderId}`,
      );
    }

    // Lưu vào lịch sử hội thoại dưới dạng tóm tắt để bot nhớ ngữ cảnh ở các câu tiếp theo
    const history = await storage.getConversationHistory(chatId);
    history.push({
      role: "user",
      parts: [
        { text: `[Người dùng đã gửi một hình ảnh] Lời nhắn: "${promptText}"` },
      ],
    });
    history.push({
      role: "model",
      parts: [{ text: replyText }],
    });
    await storage.saveConversationHistory(chatId, history);

    return replyText;
  } catch (err) {
    console.error("❌ Lỗi phân tích ảnh với Gemini Vision:", err.message);
    return "⚠️ Đã xảy ra sự cố khi phân tích hình ảnh này. Bạn vui lòng thử lại bằng một ảnh rõ nét hơn nhé!";
  }
}

/**
 * Tóm tắt thảo luận nhóm chat dựa trên các tin nhắn gần nhất (/summary)
 * @param {Array<{ senderName: string, text: string, time: string }>} messages
 * @returns {Promise<string>}
 */
async function summarizeGroupChat(messages) {
  if (!messages || messages.length === 0) {
    return "⚠️ Chưa có dữ liệu tin nhắn thảo luận nào gần đây để tóm tắt.";
  }

  const formattedConversation = messages
    .map((m) => `[${m.time || ""}] ${m.senderName || "Thành viên"}: ${m.text}`)
    .join("\n");

  const summaryPrompt = `Dưới đây là các tin nhắn thảo luận gần đây trong một nhóm chat Zalo của công ty/đội ngũ HTD Media:

---
${formattedConversation}
---

Hãy đóng vai trò Thư ký AI chuyên nghiệp của HTD Media và lập một BẢN TÓM TẮT CUỘC HỌP/THẢO LUẬN thật rõ ràng, súc tích và trực quan theo cấu trúc sau:

{big}📊 BẢN TÓM TẮT THẢO LUẬN NHÓM{/big}

1. {orange}📌 CHỦ ĐỀ CHÍNH:{/orange}
(Tóm tắt 1-2 câu về vấn đề mọi người đang bàn thảo)

2. {green}💡 CÁC ĐIỂM THỐNG NHẤT & QUYẾT ĐỊNH:{/green}
(Gạch đầu dòng các quyết định hoặc ý kiến đã thống nhất)

3. {red}📝 VIỆC CẦN LÀM (ACTION ITEMS):{/red}
(Liệt kê ai cần làm gì, thời hạn nếu có)

*Lưu ý:* Giữ văn phong lịch sự, ngắn gọn, dễ đọc trên điện thoại. Không bịa đặt thông tin không có trong đoạn chat.`;

  const payload = {
    systemInstruction: {
      parts: [{ text: getSystemInstruction() }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: summaryPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096,
    },
  };

  try {
    return await executeGeminiRequest(() => payload);
  } catch (err) {
    console.error("❌ Lỗi tóm tắt thảo luận nhóm:", err.message);
    return "⚠️ Đã xảy ra lỗi khi tạo bản tóm tắt thảo luận nhóm. Vui lòng thử lại sau!";
  }
}

/**
 * Kiểm tra xem tin nhắn có mang ý định đặt nhắc hẹn không
 */
function looksLikeReminder(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.trim().toLowerCase();

  // Bỏ qua các lệnh xem danh sách nhắc hẹn
  if (
    t === "/reminders" ||
    t === "/reminder" ||
    t === "lịch hẹn" ||
    t === "lịch nhắc" ||
    t.startsWith("/reminders") ||
    t.includes("danh sách nhắc") ||
    t.includes("danh sách lịch")
  ) {
    return false;
  }

  // Bỏ qua câu hỏi thông thường như: "nhắc lại", "đừng nhắc"
  if (
    t.includes("nhắc lại") &&
    (t.includes("được không") ||
      t.includes("giúp") ||
      t.includes("câu") ||
      t.includes("kiến thức") ||
      t.includes("bài"))
  ) {
    return false;
  }
  if (t.includes("đừng nhắc") || t.includes("không nhắc")) {
    return false;
  }

  // Nhận diện mọi biến thể liên quan đến nhắc nhở / hẹn giờ / đặt lịch / báo thức
  return (
    t.includes("nhắc") ||
    t.includes("hẹn giờ") ||
    t.includes("lịch hẹn") ||
    t.includes("đặt lịch") ||
    t.includes("tạo lịch") ||
    t.includes("lên lịch") ||
    t.includes("báo thức") ||
    t.startsWith("/remind") ||
    t.startsWith("/nhac")
  );
}

/**
 * Trích xuất nhắc hẹn lặp lại hàng ngày siêu tốc qua Regex (0ms latency)
 */
function tryQuickDailyReminder(text) {
  const t = text.trim();

  // Kiểm tra có từ khóa lặp lại hàng ngày không
  const hasDailyKeyword =
    /(?:hàng ngày|hang ngay|mỗi ngày|moi ngay|ngày nào cũng|ngay nao cung|hằng ngày)/i.test(
      t,
    );
  if (!hasDailyKeyword) return null;

  // Tìm mốc giờ trong câu (ví dụ: "8h", "8h30", "8:00", "8 giờ", "8 giờ 30", "8h sáng", "8h tối", "17h30")
  const timeRegex =
    /(?:lúc\s*)?(\d{1,2})(?::(\d{2})|h(?:(\d{2}))?|\s*giờ(?:\s*(\d{1,2}))?)(?:\s*(sáng|chiều|tối|trưa|am|pm))?/i;
  const timeMatch = t.match(timeRegex);
  if (!timeMatch) return null;

  let hour = parseInt(timeMatch[1], 10);
  let minute = parseInt(
    timeMatch[2] || timeMatch[3] || timeMatch[4] || "0",
    10,
  );
  const period = (timeMatch[5] || "").toLowerCase();

  if (period === "chiều" || period === "tối" || period === "pm") {
    if (hour < 12) hour += 12;
  } else if (period === "sáng" || period === "am") {
    if (hour === 12) hour = 0;
  } else if (period === "trưa") {
    if (hour < 11) hour += 12;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  // Lấy nội dung công việc bằng cách lược bỏ phần lệnh, thời gian, và từ khóa lặp lại
  let content = t
    .replace(
      /(?:tạo|đặt|lên)\s*(?:lịch\s*)?(?:nhắc(?:\s+nhở|\s+hẹn)?|hẹn(?:\s+giờ)?)?/gi,
      "",
    )
    .replace(
      /(?:hàng ngày|hang ngay|mỗi ngày|moi ngay|ngày nào cũng|ngay nao cung|hằng ngày)/gi,
      "",
    )
    .replace(timeRegex, "")
    .replace(
      /(?:nhắc(?:\s+nhở|\s+hẹn)?|hẹn(?:\s+giờ)?)\s*(?:cho\s+)?(?:tôi|em|mình|nhóm|bạn|mọi người)?/gi,
      "",
    )
    .replace(/^(?:\s*(?:về|để|lúc|vào lúc|là|:|-)\s*)+/i, "")
    .trim();

  content = content
    .replace(/^(?:nhé|nha|ạ|đi|giùm|hộ|giúp tôi|giúp em|giúp mình)\s+/i, "")
    .trim();
  content = content.replace(/\s+(?:nhé|nha|ạ|nhé bot|nha bot)$/i, "").trim();
  if (!content) content = "Công việc hàng ngày";

  // Tính toán thời điểm kế tiếp theo giờ VN (GMT+7)
  const now = new Date();
  const vnParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);

  const getPart = (type) =>
    parseInt(vnParts.find((p) => p.type === type).value, 10);
  const curYear = getPart("year");
  const curMonth = getPart("month") - 1;
  const curDay = getPart("day");
  const curHour = getPart("hour");
  const curMin = getPart("minute");

  let targetDay = curDay;
  if (hour < curHour || (hour === curHour && minute <= curMin)) {
    targetDay += 1;
  }

  const remindAt = Date.UTC(curYear, curMonth, targetDay, hour - 7, minute, 0);
  const hourStr = String(hour).padStart(2, "0");
  const minStr = String(minute).padStart(2, "0");
  const timeFormatted = `${hourStr}:${minStr}`;

  return {
    isReminder: true,
    content,
    remindAt,
    repeat: "daily",
    targetTime: `${hourStr}:${minStr}`,
    timeFormatted: `${timeFormatted} mỗi ngày`,
    confirmationMessage: `⏰ **Đã ghi nhận lịch nhắc lặp lại hàng ngày thành công!**\n\n📌 **Nội dung:** ${content}\n🕒 **Thời gian nhắc:** ${timeFormatted} mỗi ngày\n🔁 **Chu kỳ:** Hàng ngày (lặp lại tự động mỗi ngày)\n\n_💡 Để xem danh sách gõ /reminders hoặc hủy lịch gõ /xoanhac._`,
  };
}

/**
 * Trích xuất nhắc hẹn nhanh qua Regex (0ms latency cho các câu phổ biến: sau X phút/giờ hoặc hàng ngày)
 */
function tryQuickRegexReminder(text) {
  // 1. Kiểm tra nhắc hẹn lặp lại hàng ngày trước
  const daily = tryQuickDailyReminder(text);
  if (daily) return daily;

  const t = text.trim();

  // Mẫu 1: [tạo/đặt/lên lịch] [nhắc/hẹn] [tôi/em/mình/nhóm/bạn] [sau] X phút/giờ/tiếng [nữa] [nội dung]
  // Ví dụ: "tạo lịch nhắc 15 phút nữa uống nước", "nhắc tôi sau 1 giờ họp", "nhắc 10 phút nữa tắt bếp"
  let match = t.match(
    /(?:(?:tạo|đặt|lên)\s*(?:lịch\s*)?)?(?:nhắc(?:\s+nhở|\s+hẹn)?|hẹn(?:\s+giờ)?)\s*(?:cho\s+)?(?:tôi|em|mình|nhóm|bạn)?\s*(?:sau\s*)?(\d+)\s*(phút|giờ|tiếng|giây)\s*(?:nữa)?(?:\s+là|\s*:|\s+về|\s+để)?\s*(.*)/i,
  );

  // Mẫu 2: sau X phút/giờ/tiếng [nữa] nhắc [tôi/em/mình/nhóm/bạn] [nội dung]
  if (!match) {
    match = t.match(
      /sau\s*(\d+)\s*(phút|giờ|tiếng|giây)\s*(?:nữa)?\s*(?:hãy\s*)?nhắc(?:\s+nhở|\s+hẹn)?\s*(?:cho\s+)?(?:tôi|em|mình|nhóm|bạn)?(?:\s+là|\s*:|\s+về|\s+để)?\s*(.*)/i,
    );
  }

  if (match) {
    const num = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    let content = match[3] ? match[3].trim() : "";
    // Lược bỏ các từ thừa ở đầu nội dung như "nhé", "nha", "ạ", "đi", "giúp", "hộ", "giùm"
    content = content
      .replace(/^(?:nhé|nha|ạ|đi|giùm|hộ|giúp tôi|giúp em|giúp mình)\s+/i, "")
      .trim();
    if (!content) content = "Công việc đã lên lịch";

    let ms = 0;
    if (unit === "phút") ms = num * 60 * 1000;
    else if (unit === "giờ" || unit === "tiếng") ms = num * 3600 * 1000;
    else if (unit === "giây") ms = num * 1000;

    if (ms > 0) {
      const remindAt = Date.now() + ms;
      const timeStr = new Date(remindAt).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Ho_Chi_Minh",
      });
      return {
        isReminder: true,
        content,
        remindAt,
        repeat: "none",
        timeFormatted: `${timeStr} (sau ${num} ${unit})`,
        confirmationMessage: `⏰ **Đã ghi nhận nhắc hẹn thành công!**\n\n📌 **Nội dung:** ${content}\n🕒 **Thời gian nhắc:** ${timeStr} (sau ${num} ${unit})\n\n_Bot HTD Media sẽ chủ động nhắn tin Zalo cho bạn khi đến giờ!_`,
      };
    }
  }
  return null;
}

/**
 * Phân tích yêu cầu nhắc hẹn bằng Gemini AI (kết hợp Regex siêu tốc)
 * @param {string} userMessage
 * @returns {Promise<{ isReminder: boolean, content?: string, remindAt?: number, repeat?: string, targetTime?: string, timeFormatted?: string, confirmationMessage?: string }>}
 */
async function parseReminderIntent(userMessage) {
  if (!looksLikeReminder(userMessage)) {
    return { isReminder: false };
  }

  // 1. Thử parse bằng Regex siêu tốc trước (0ms latency)
  const quick = tryQuickRegexReminder(userMessage);
  if (quick) {
    return quick;
  }

  // 2. Dùng Gemini AI phân tích câu nói tự nhiên phức tạp
  const now = new Date();
  const nowStr = now.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  const prompt = `Thời điểm hiện tại tại Việt Nam (GMT+7) là: ${nowStr} (Timestamp ms: ${now.getTime()}).
Người dùng gửi tin nhắn: "${userMessage}"

Hãy phân tích xem người dùng có muốn đặt lịch hẹn, tạo lịch nhắc, nhắc nhở hoặc báo thức cho một thời điểm cụ thể trong tương lai không.
Nếu CÓ:
- Xác định tính chất lặp lại của lịch:
  + "repeat": "daily" (nếu có các từ như "hàng ngày", "mỗi ngày", "ngày nào cũng", "daily")
  + "repeat": "weekly" (nếu có các từ như "hàng tuần", "mỗi tuần", "thứ X hàng tuần")
  + "repeat": "none" (nếu là lịch 1 lần duy nhất)
- Xác định thời điểm cần nhắc tiếp theo (phải ở tương lai so với thời điểm hiện tại).
- Tính toán chính xác targetTimestamp (mili-giây tính từ Unix epoch cho lần nhắc kế tiếp).
- Trích xuất nội dung công việc cần nhắc (ngắn gọn, súc tích).
- Tạo câu xác nhận thân thiện.
Nếu KHÔNG hoặc câu nói không có mốc thời gian cụ thể trong tương lai, trả về isReminder: false.

CHỈ trả về một JSON object duy nhất:
{
  "isReminder": true,
  "content": "nội dung công việc cần nhắc",
  "targetTimestamp": 1789195000000,
  "repeat": "daily",
  "formattedTime": "HH:mm ngày DD/MM/YYYY",
  "confirmationMessage": "⏰ **Đã đặt nhắc hẹn:** '...' lúc HH:mm!"
}`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  };

  try {
    const rawJson = await executeGeminiRequest(() => payload);
    const parsed = JSON.parse(rawJson);
    if (
      parsed &&
      parsed.isReminder &&
      parsed.targetTimestamp &&
      Number(parsed.targetTimestamp) > Date.now()
    ) {
      const repeat =
        parsed.repeat === "daily" || parsed.repeat === "weekly"
          ? parsed.repeat
          : "none";
      let confirmationMessage = parsed.confirmationMessage;
      if (repeat === "daily") {
        confirmationMessage = `⏰ **Đã ghi nhận lịch nhắc lặp lại hàng ngày thành công!**\n\n📌 **Nội dung:** ${parsed.content}\n🕒 **Thời gian nhắc:** ${parsed.formattedTime || "Hàng ngày"}\n🔁 **Chu kỳ:** Hàng ngày (lặp lại tự động mỗi ngày)\n\n_💡 Để xem danh sách gõ /reminders hoặc hủy lịch gõ /xoanhac._`;
      } else if (repeat === "weekly") {
        confirmationMessage = `⏰ **Đã ghi nhận lịch nhắc lặp lại hàng tuần thành công!**\n\n📌 **Nội dung:** ${parsed.content}\n🕒 **Thời gian nhắc:** ${parsed.formattedTime || "Hàng tuần"}\n🔁 **Chu kỳ:** Hàng tuần\n\n_💡 Để xem danh sách gõ /reminders hoặc hủy lịch gõ /xoanhac._`;
      }

      return {
        isReminder: true,
        content: parsed.content || "Công việc đã lên lịch",
        remindAt: Number(parsed.targetTimestamp),
        repeat,
        timeFormatted: parsed.formattedTime || "Thời gian đã hẹn",
        confirmationMessage:
          confirmationMessage ||
          `⏰ **Đã đặt nhắc hẹn:** "${parsed.content}" lúc ${parsed.formattedTime}!`,
      };
    }
  } catch (err) {
    console.warn("⚠️ Gemini parse reminder intent failed:", err.message);
  }

  return { isReminder: false };
}

module.exports = {
  askGemini,
  askGeminiVision,
  summarizeGroupChat,
  parseReminderIntent,
  clearHistory,
  searchWebRealtime,
};

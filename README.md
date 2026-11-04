# NCP TeamTracking – Website phân công công việc

Website quản lý công việc theo đúng cấu trúc bảng PCCV: mỗi Ban một tab, mỗi sự kiện là một nhóm công việc,
Ban Truyền thông có 3 vai trò (Content / Design / Đăng bài), mỗi vai trò có deadline riêng.

```
GitHub Pages (giao diện)  ──►  Apps Script (máy chủ)  ──►  Google Sheet PCCV (dữ liệu)
                                     │
                                     └──► Gmail: gửi email nhắc việc + email xác nhận chống spam
```

- **Miễn phí, không cần tên miền.** Dữ liệu vẫn nằm trong Google Sheet, sửa trên Sheet hay trên web đều được.
- **Đăng nhập bằng Google.** Chỉ email có trong tab "👥 Danh sách thành viên" mới vào được.
- **Phân quyền:**
  - Quản trị và trưởng ban: thêm, sửa, xóa công việc, tạo sự kiện từ mẫu.
  - Lead CV: sửa công việc mình làm lead.
  - Người được giao: cập nhật trạng thái, ghi chú, link sản phẩm.
- **Email nhắc việc**: mỗi người nhận **1 email tổng hợp mỗi sáng**, gồm việc sắp đến hạn (theo "Số ngày nhắc" trong tab Cấu hình) và việc quá hạn.
  - Trưởng ban nhận thêm bản tổng hợp vào thứ Hai: việc quá hạn, việc chưa giao người, tên không khớp danh sách.
- **Chống spam**:
  - Email xác nhận có 2 bước: bấm link, rồi trả lời "OK".
  - Nút "Kết nối Gmail" tự tạo bộ lọc "Không bao giờ vào Spam".
  - Trang theo dõi ai đã xác nhận. Người chưa phản hồi được tự gửi lại, tối đa 3 lần.

## Thư mục

| Đường dẫn | Nội dung |
|---|---|
| `apps-script/Code.gs` | Toàn bộ phần máy chủ: dán vào Apps Script của Sheet |
| `apps-script/appsscript.json` | Cấu hình Apps Script (múi giờ Việt Nam, Web app) |
| `docs/` | Website: đưa lên GitHub Pages |
| `docs/config.js` | **2 dòng cần điền**: `API_URL` và `GOOGLE_CLIENT_ID` |

> Chưa điền `API_URL` thì website chạy **chế độ demo** với dữ liệu giả. Bạn có thể đưa lên GitHub trước để xem thử giao diện.

---

## Cài đặt (khoảng 30 phút)

### Bước 1 – Tạo bản sao Sheet để chạy thử

1. Mở Sheet PCCV → **Tệp → Tạo bản sao**. Bản sao có kèm Apps Script cũ.
2. Trong **bản sao**: **Tiện ích mở rộng → Apps Script**.
3. Lưu code cũ ra chỗ khác để dự phòng, rồi xóa hết code cũ (Code.gs và các file .gs khác).
4. Dán nội dung `apps-script/Code.gs` vào.
5. Bấm ⚙️ **Cài đặt dự án** → tích **"Hiển thị tệp kê khai appsscript.json"**. Mở file `appsscript.json` và dán nội dung file cùng tên vào.

> Khi đã chạy ổn, làm lại bước này trên Sheet thật. Nhớ **xóa trình kích hoạt (trigger) của script cũ**: biểu tượng ⏰ bên trái Apps Script. Nếu không, mọi người sẽ nhận 2 email nhắc.

### Bước 2 – Tạo Google Client ID (để đăng nhập)

Đăng nhập Google Cloud bằng tài khoản sở hữu Sheet (ví dụ `phandangduonga.ncp@gmail.com`).

1. Vào https://console.cloud.google.com → tạo project mới, ví dụ `ncp-teamtracking`.
2. **APIs & Services → Library** → tìm **Gmail API** → **Enable**. Cần cho nút "Kết nối Gmail".
3. **APIs & Services → OAuth consent screen** (hoặc **Google Auth Platform**):
   - User type: **External**.
   - App name: `NCP TeamTracking`, điền email hỗ trợ.
   - **Audience / Test users**: thêm **email của cả 28 thành viên** (tối đa 100).
   - Để ở trạng thái **Testing**.
4. **Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: `https://fudoyuser.github.io` (không có dấu `/` cuối, không có tên repo).
   - Tạo xong, copy **Client ID** dạng `123...apps.googleusercontent.com`.

> Ở chế độ Testing, Google báo quyền hết hạn sau 7 ngày. Website **không bị ảnh hưởng**: đăng nhập chỉ dùng token 1 giờ, và bộ lọc Gmail tạo một lần là còn mãi.

### Bước 3 – Điền cấu hình trong Code.gs

Ở đầu file `Code.gs`, sửa:

```js
GOOGLE_CLIENT_ID: '123...apps.googleusercontent.com',
WEBSITE_URL: 'https://fudoyuser.github.io/ncp-teamtracking/',
ADMIN_EMAILS: ['phandangduonga.ncp@gmail.com'],
```

### Bước 4 – Triển khai Apps Script thành Web app

1. Trong Apps Script: **Triển khai → Tùy chọn triển khai mới → Loại: Ứng dụng web**.
2. **Thực thi dưới dạng: Tôi**. **Người có quyền truy cập: Bất kỳ ai**.
3. Bấm **Triển khai** → **Cấp quyền**:
   - Google sẽ báo "ứng dụng chưa được xác minh". Đây là script của chính bạn nên bấm **Nâng cao → Đi tới… (không an toàn)** → **Cho phép**.
4. Copy **URL ứng dụng web**, dạng `https://script.google.com/macros/s/XXXX/exec`.

> "Bất kỳ ai" chỉ có nghĩa là ai cũng **gọi được** địa chỉ này. Mọi yêu cầu vẫn phải có token đăng nhập Google hợp lệ của thành viên trong danh sách.
>
> **Mỗi lần sửa Code.gs** phải vào **Triển khai → Quản lý triển khai → ✏️ → Phiên bản: Phiên bản mới → Triển khai**. Làm như vậy URL được giữ nguyên.

### Bước 5 – Đưa website lên GitHub Pages

1. Tạo repo mới trên GitHub, ví dụ `ncp-teamtracking`. Để **Public** nếu dùng GitHub miễn phí.
2. Sửa `docs/config.js`:
   ```js
   API_URL: 'https://script.google.com/macros/s/XXXX/exec',
   GOOGLE_CLIENT_ID: '123...apps.googleusercontent.com',
   ```
3. Tải toàn bộ thư mục lên repo (**Add file → Upload files**, kéo cả thư mục `docs` và `apps-script`).
4. **Settings → Pages → Source: Deploy from a branch → Branch: `main`, thư mục `/docs`** → Save.
5. Sau 1–2 phút, website chạy tại `https://fudoyuser.github.io/ncp-teamtracking/`.

> Repo public chỉ chứa code, **không chứa dữ liệu**: dữ liệu nằm trong Google Sheet riêng của bạn. Client ID và URL Web app không phải mật khẩu nên để công khai được.

### Bước 6 – Bật nhắc việc và gửi email xác nhận

1. Mở lại Sheet (F5). Trên thanh menu có thêm **📋 TeamTracking**.
2. **⏰ Bật nhắc việc tự động hằng ngày**: chạy lúc 8–9h sáng.
3. Báo trước trong nhóm Zalo: *"Sắp có email '[NCP] Xác nhận nhận email nhắc việc', mọi người bấm link và trả lời OK nhé, nhớ xem cả mục Spam."*
4. **📧 Gửi email xác nhận cho người chưa nhận**.
5. Theo dõi trên website ở tab **📧 Xác nhận email** (chỉ trưởng ban và quản trị thấy).

---

## Cách hệ thống hoạt động

### Nhắc việc (mỗi sáng)
- Với mỗi công việc **chưa "Hoàn thành"** có deadline:
  - Còn ≤ N ngày (N = "Số ngày nhắc nhở trước deadline" trong tab ⚙️ Cấu hình): gửi nhắc **một lần**.
  - Đã quá hạn (trong vòng 7 ngày): gửi nhắc quá hạn **một lần**.
- Mỗi người nhận **một email gộp** tất cả các việc.
- Mỗi lần nhắc được ghi vào tab ẩn `_Nhật ký nhắc` để không gửi trùng.
  - **Đổi deadline thì được nhắc lại theo deadline mới.** Không cần sửa tay cột "Đã gửi nhắc nhở".
  - Ô có nhiều người như `Ngô Thúy Nga, Nguyễn Hà Linh`: mỗi người đều được nhắc.
- Tên được so khớp **không phân biệt dấu**, nên "Thuỳ" và "Thùy" được coi là một. Tên không có trong danh sách thành viên sẽ hiện viền vàng trên web và được báo cho trưởng ban.

### Chống spam
| Trạng thái | Ý nghĩa | Hệ thống làm gì |
|---|---|---|
| 🟢 | Đã trả lời "OK" hoặc đã tạo bộ lọc Gmail | Không làm gì thêm |
| 🟡 | Chỉ bấm link | Sau 3 ngày gửi email ngắn nhắc trả lời "OK" |
| 🔴 | Chưa phản hồi | Sau 3 ngày gửi lại, tối đa 3 lần, rồi trưởng ban nhắc qua Zalo |
| ⚪ | Chưa gửi | Thành viên mới thêm vào Sheet được tự gửi vào sáng hôm sau |

### Giới hạn
- Gmail cá nhân gửi bằng Apps Script được khoảng **100 người nhận mỗi ngày**. Với 28 người, mỗi người 1 email/ngày là dư.
- Nút "Kết nối Gmail" dùng được cho tối đa **100 test user**. Muốn hơn thì phải qua Google xác minh ứng dụng.
- Thêm Ban mới: menu **📋 TeamTracking → ➕ Tạo Ban mới**, rồi ghi "Trưởng Ban …" vào cột Chức vụ của trưởng ban.
- Thêm vai trò cho Ban mới: thêm cặp cột `Người phụ trách <X>` + `Deadline <X>`. Hệ thống tự nhận diện.

# NCP TeamTracking – PCCV & Dashboard

Website phân công công việc (PCCV) cho NEU Career Path Club.
- Mỗi Ban một trang, công việc nhóm theo sự kiện, mỗi vai trò có người phụ trách và deadline riêng.
- Kèm **Dashboard** cho admin, **email nhắc việc** tự động, và **chống spam**.

Website: **https://fudoyuser.github.io/ncp-teamtracking/**

```
GitHub Pages (website)  ──►  Supabase (cơ sở dữ liệu + đăng nhập email/mật khẩu)
        │                              ▲
        └──► Apps Script (Gmail CLB) ──┘  cấp tài khoản, gửi mật khẩu, nhắc việc mỗi sáng, chống spam
```

## Tính năng

| Ai | Làm được gì |
|---|---|
| **Thành viên** | Đăng nhập bằng email + mật khẩu admin cấp (lần đầu phải đổi mật khẩu). Xem "Việc của tôi", xem PCCV các Ban, cập nhật trạng thái / ghi chú / link sản phẩm của việc được giao. |
| **Lead CV** | Sửa toàn bộ công việc mình làm lead. |
| **Trưởng ban** | Thêm, sửa, xóa công việc trong Ban; tạo sự kiện; **tạo sự kiện từ mẫu** (chép danh sách việc của sự kiện cũ). |
| **Admin** | Tất cả các quyền trên, cộng thêm **Dashboard** và **Quản trị**. |

**Dashboard** gồm:
- Các chỉ số chính: việc đang mở, quá hạn, đến hạn trong 7 ngày, số việc hoàn thành, **tỷ lệ đúng hạn**.
- Biểu đồ việc hoàn thành mỗi tuần, chia đúng hạn / trễ hạn.
- So sánh giữa các Ban, tiến độ từng sự kiện, khối lượng việc và tỷ lệ đúng hạn của từng thành viên.

**Quản trị** gồm:
- **Tài khoản:** cấp tài khoản (tự tạo mật khẩu và gửi email), đặt lại mật khẩu, khóa / mở khóa, gán Ban, trưởng ban, admin, xem trạng thái chống spam.
- **Ban & vai trò:** thêm Ban, đặt các vai trò (vd. Content / Design / Đăng bài).
- **Sự kiện:** tên và ngày diễn ra.
- **Cài đặt:** số ngày nhắc trước deadline.

**Email (gửi từ Gmail của CLB qua Apps Script):**
- **Email cấp tài khoản:** gồm link, email, mật khẩu, kèm 2 bước chống spam (bấm link và trả lời "OK").
- **Mỗi sáng 8–9h:** mỗi người nhận 1 email tổng hợp các việc sắp đến hạn và quá hạn. Mỗi mốc chỉ nhắc 1 lần; đổi deadline thì được nhắc lại.
- **Thứ Hai:** trưởng ban nhận bản tổng hợp tuần (việc quá hạn, việc chưa giao người).
- **Tự đọc hộp thư** để biết ai đã trả lời "OK", và tự gửi lại cho người chưa phản hồi (tối đa 3 lần).

## Thư mục

| Đường dẫn | Nội dung |
|---|---|
| `supabase/schema.sql` | Tạo toàn bộ cơ sở dữ liệu + phân quyền. Chạy 1 lần trong Supabase |
| `apps-script/Code.gs`, `appsscript.json` | Máy chủ gửi mail. Dán vào Apps Script |
| `docs/` | Website (GitHub Pages) |
| `docs/config.js` | **Nơi điền 3 thông số kết nối** |

> Khi `config.js` còn trống, website chạy **chế độ demo** với dữ liệu giả, để xem thử giao diện.

---

## Cài đặt (khoảng 30 phút)

### Bước 1 – Supabase (cơ sở dữ liệu)

1. Vào https://supabase.com, chọn **Start your project**, đăng nhập bằng GitHub.
2. **New project**:
   - Đặt tên `ncp-pccv`.
   - Đặt *Database password* và lưu lại.
   - Region chọn **Southeast Asia (Singapore)**.
   - Bấm Create, đợi khoảng 2 phút.
3. Bên trái chọn **SQL Editor → New query**, dán toàn bộ nội dung `supabase/schema.sql`, bấm **Run**. Thấy "Success" là xong.
4. Chọn **Authentication → Sign In / Providers** (hoặc **Settings**), **tắt "Allow new users to sign up"**. Chỉ admin được cấp tài khoản, không ai tự đăng ký được.
5. Chọn **Project Settings → API** (hoặc **API Keys**), ghi lại 3 thứ:
   - **Project URL**, dạng `https://abcdxyz.supabase.co`
   - Khóa **anon public**: dùng cho website.
   - Khóa **service_role**: chỉ dán vào Apps Script, **không bao giờ đưa lên GitHub**.

### Bước 2 – Apps Script (máy chủ gửi mail)

Đăng nhập **tài khoản Gmail dùng để gửi mail của CLB** (ví dụ `phandangduonga.ncp@gmail.com`).

1. Vào https://script.google.com, chọn **Dự án mới**, đặt tên `NCP Mail`.
2. Xóa nội dung `Code.gs` có sẵn, dán nội dung `apps-script/Code.gs`.
3. Kiểm tra phần `CONFIG` ở đầu file:
   - `FIRST_ADMIN_EMAIL`, `FIRST_ADMIN_NAME`: tài khoản admin đầu tiên.
   - `WEBSITE_URL`: đã điền sẵn.
4. Chọn ⚙️ **Cài đặt dự án**:
   - Tích **"Hiển thị tệp kê khai appsscript.json"**, rồi mở file đó và dán nội dung `apps-script/appsscript.json`.
   - Kéo xuống **Thuộc tính tập lệnh → Thêm thuộc tính**, thêm 2 dòng:
     - `SUPABASE_URL` = Project URL
     - `SUPABASE_SERVICE_KEY` = khóa service_role
5. Chọn **Triển khai → Tùy chọn triển khai mới → Loại: Ứng dụng web**:
   - Thực thi dưới dạng: **Tôi**.
   - Người có quyền truy cập: **Bất kỳ ai**.
   - Bấm **Triển khai**, rồi **Cấp quyền**. Google báo "chưa xác minh" thì chọn **Nâng cao → Đi tới NCP Mail → Cho phép**.
   - Copy **URL ứng dụng web**, dạng `https://script.google.com/macros/s/XXXX/exec`.
6. Quay lại trình chỉnh sửa, chọn hàm **`caiDatLanDau`**, bấm **▶ Chạy**. Hàm này sẽ:
   - Tạo tài khoản admin đầu tiên và **gửi mật khẩu về email admin**. Mật khẩu cũng hiện trong *Nhật ký thực thi*.
   - Bật lịch gửi nhắc việc mỗi sáng.

> "Bất kỳ ai" nghĩa là ai cũng gọi được địa chỉ này. Nhưng mọi thao tác đều kiểm tra token đăng nhập Supabase và chỉ **admin** mới cấp hoặc khóa tài khoản được.
>
> Mỗi lần sửa `Code.gs`: **Triển khai → Quản lý triển khai → ✏️ → Phiên bản mới → Triển khai**. URL được giữ nguyên.

### Bước 3 – Nối website

Điền `docs/config.js`:

```js
SUPABASE_URL: 'https://abcdxyz.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...',            // khóa anon public
APPS_SCRIPT_URL: 'https://script.google.com/macros/s/XXXX/exec',
```

Khóa anon được phép để công khai: mọi quyền truy cập đều do phân quyền trong cơ sở dữ liệu kiểm soát.

### Bước 4 – Bắt đầu dùng

1. Mở website, đăng nhập bằng email admin và mật khẩu vừa nhận, rồi đặt mật khẩu mới.
2. Vào **⚙️ Quản trị**:
   - **Ban & vai trò:** đã có sẵn Ban Sự kiện và Ban Truyền thông. Sửa hoặc thêm nếu cần.
   - **Sự kiện:** thêm sự kiện.
   - **Tài khoản:** **＋ Cấp tài khoản** cho từng thành viên, gán Ban và tích "Trưởng ban" cho trưởng ban.
3. Trước khi cấp tài khoản hàng loạt, báo trong nhóm Zalo: *"Sắp có email '[NCP] Tài khoản PCCV của bạn', mọi người bấm link và trả lời OK nhé, nhớ xem cả mục Spam."*

### (Không bắt buộc) Nút "Kết nối Gmail" tự tạo bộ lọc chống spam

1. Vào https://console.cloud.google.com, tạo project, rồi bật **Gmail API**.
2. Vào **OAuth consent screen**:
   - Chọn External, để trạng thái Testing.
   - **Test users:** thêm email các thành viên (tối đa 100).
3. Vào **Credentials → OAuth client ID → Web application**:
   - Authorized JavaScript origins: `https://fudoyuser.github.io`.
4. Dán Client ID vào `GOOGLE_CLIENT_ID` trong `config.js`.

Không làm bước này thì thành viên vẫn chống spam được bằng cách trả lời "OK" email tài khoản.

---

## Giới hạn

| Hạng mục | Giới hạn |
|---|---|
| Gmail gửi qua Apps Script | Khoảng **100 người nhận/ngày**. Mỗi người 1 email nhắc/ngày là đủ cho CLB dưới khoảng 80 người. Cấp nhiều tài khoản trong 1 ngày cũng tính vào hạn mức. |
| Supabase miễn phí | 500 MB dữ liệu, dư dùng nhiều năm. Dự án tạm dừng nếu 7 ngày không có hoạt động; lịch chạy mỗi sáng của Apps Script giữ nó luôn hoạt động. |
| Quên mật khẩu | Admin vào **Tài khoản → Đặt lại MK**. Mật khẩu mới được gửi qua email. |

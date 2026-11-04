// Cấu hình website – điền sau khi làm xong các bước trong README.md.
// Để trống SUPABASE_URL thì website chạy CHẾ ĐỘ DEMO (dữ liệu mẫu, lưu tạm trong trình duyệt).
window.APP_CONFIG = {
  SUPABASE_URL: 'https://ozniwzmudmlongxtgeht.supabase.co',        // vd. https://abcdxyz.supabase.co
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96bml3em11ZG1sb25neHRnZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3NTQzNTksImV4cCI6MjEwOTMzMDM1OX0.sY-_hxOyRvc_kZfTJvbqOIYOoC8JtN1X4Jo_vK14XMU',   // khóa "anon public" (Project Settings → API) – KHÔNG dùng khóa service_role ở đây
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwGdbf4GYBCVAR3C0znzlgNqhqXKF7AbBMZtcZO9gXvNz5BSVWxWKLlfFivWSlR6Ybb/exec',     // URL Web app của Apps Script, dạng https://script.google.com/macros/s/XXXX/exec
  GOOGLE_CLIENT_ID: '',    // (không bắt buộc) để bật nút "Kết nối Gmail – tự tạo bộ lọc chống spam"
  CLUB_NAME: 'NEU Career Path Club',
};

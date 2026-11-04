// Content script chạy trên facebook.com – tự kích hoạt quét khi có hash #pccv-scan=
(function () {
  'use strict';
  var m = location.hash.match(/#pccv-scan=(.+)/);
  if (!m) return; // không có hash → không làm gì

  var scan;
  try { scan = JSON.parse(decodeURIComponent(m[1])); } catch (e) { return; }
  var site = scan.site || '';
  var cid = scan.cid || '';
  if (!site) return;

  // Đợi trang Facebook tải xong (khoảng 4-6 giây)
  var wait = 5000;
  setTimeout(function () {
    if (typeof window.fbHelper !== 'function') return;
    window.fbHelper(site, {
      campaignId: cid,
      onDone: function (data) {
        // Gửi kết quả về background script → mở PCCV với dữ liệu
        chrome.runtime.sendMessage({
          type: 'pccv-scan-done',
          data: data,
          site: site
        });
      }
    });
  }, wait);
})();

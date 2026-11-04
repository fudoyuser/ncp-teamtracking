// Content script chạy trên facebook.com
// Hỏi background.js xem có lệnh quét nào không → nếu có, tự chạy fbHelper
(function () {
  'use strict';

  // Cũng kiểm tra hash cũ (bookmarklet fallback)
  var hashScan = null;
  try {
    var m = location.hash.match(/#pccv-scan=(.+)/);
    if (m) {
      hashScan = JSON.parse(decodeURIComponent(m[1]));
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (e) {}

  function startScan(site, cid) {
    // Đợi trang Facebook tải xong
    var checks = 0;
    var maxChecks = 30; // 30 x 2s = 60 giây tối đa
    var timer = setInterval(function () {
      checks++;
      // Kiểm tra trang đã có nội dung chưa (article, reaction counts, etc.)
      var hasContent = document.querySelector('[role="article"]') ||
        document.querySelector('[role="main"] [aria-label]') ||
        document.querySelector('[data-pagelet]');
      if (hasContent || checks >= maxChecks) {
        clearInterval(timer);
        if (typeof window.fbHelper !== 'function') return;
        window.fbHelper(site, {
          campaignId: cid,
          onDone: function (data) {
            if (!chrome.runtime || !chrome.runtime.id) throw new Error('extension vừa được tải lại');
            chrome.runtime.sendMessage({
              type: 'scan-done',
              data: data,
              site: site
            });
          }
        });
      }
    }, 2000);
  }

  // Ưu tiên: hỏi background.js
  chrome.runtime.sendMessage({ type: 'check-scan' }, function (scan) {
    if (scan && scan.cid) {
      startScan(scan.site, scan.cid);
    } else if (hashScan && hashScan.site) {
      // Fallback: hash trên URL (bookmarklet flow)
      startScan(hashScan.site, hashScan.cid || '');
    }
  });
})();

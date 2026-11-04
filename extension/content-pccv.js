// Content script chạy trên trang PCCV – đánh dấu extension đã cài + nhận lệnh quét
document.documentElement.setAttribute('data-pccv-ext', '1');

// Lắng nghe sự kiện từ trang PCCV khi bấm ▶ Quét
window.addEventListener('pccv-scan-start', function (ev) {
  var detail = ev.detail;
  if (!detail || !detail.postUrl) return;
  chrome.runtime.sendMessage({
    type: 'start-scan',
    postUrl: detail.postUrl,
    cid: detail.cid,
    site: detail.site,
    t: Date.now()
  });
});

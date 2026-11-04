// Background service worker – nhận kết quả từ content-fb.js, mở PCCV với dữ liệu
chrome.runtime.onMessage.addListener(function (msg, sender) {
  if (msg.type !== 'pccv-scan-done' || !msg.data || !msg.site) return;
  var url = msg.site + '#seed-import=' + msg.data;
  // Tìm tab PCCV đang mở (tab đã mở "▶ Quét ngay")
  var openerTabId = sender.tab && sender.tab.openerTabId;
  if (openerTabId) {
    chrome.tabs.update(openerTabId, { url: url, active: true }, function () {
      // Đóng tab Facebook
      if (sender.tab) chrome.tabs.remove(sender.tab.id);
    });
  } else {
    // Không tìm được tab mở → tạo tab mới
    chrome.tabs.create({ url: url }, function () {
      if (sender.tab) chrome.tabs.remove(sender.tab.id);
    });
  }
});

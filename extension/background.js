// Background service worker
// 1) Nhận lệnh quét từ content-pccv.js → lưu + mở tab Facebook
// 2) Nhận kết quả từ content-fb.js → mở PCCV với dữ liệu + đóng tab FB

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'start-scan') {
    // Lưu lệnh quét vào storage
    var scan = {
      postUrl: msg.postUrl,
      cid: msg.cid,
      site: msg.site,
      t: msg.t,
      pccvTabId: sender.tab ? sender.tab.id : null
    };
    chrome.storage.session.set({ pendingScan: scan }, function () {
      // Mở tab Facebook (URL sạch, không có hash)
      chrome.tabs.create({ url: msg.postUrl, active: true });
    });
    return;
  }

  if (msg.type === 'check-scan') {
    // content-fb.js hỏi có lệnh quét nào không
    chrome.storage.session.get('pendingScan', function (result) {
      var scan = result.pendingScan;
      // Chỉ trả về nếu lệnh quét còn mới (< 5 phút)
      if (scan && Date.now() - scan.t < 300000) {
        sendResponse(scan);
      } else {
        sendResponse(null);
      }
    });
    return true; // async sendResponse
  }

  if (msg.type === 'scan-done') {
    // Nhận kết quả quét từ content-fb.js
    chrome.storage.session.get('pendingScan', function (result) {
      var scan = result.pendingScan;
      var url = (msg.site || (scan && scan.site) || '') + '#seed-import=' + msg.data;
      // Xóa lệnh quét
      chrome.storage.session.remove('pendingScan');

      // Mở PCCV với kết quả
      var pccvTabId = scan && scan.pccvTabId;
      if (pccvTabId) {
        chrome.tabs.update(pccvTabId, { url: url, active: true }, function () {
          // Đóng tab Facebook
          if (sender.tab) chrome.tabs.remove(sender.tab.id);
        });
      } else {
        chrome.tabs.create({ url: url }, function () {
          if (sender.tab) chrome.tabs.remove(sender.tab.id);
        });
      }
    });
    return;
  }
});

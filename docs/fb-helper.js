// Nút "Gửi sang PCCV" (bookmarklet) – chạy trên trang Facebook mà CHÍNH NGƯỜI DÙNG đang mở.
// Việc nó làm: cuộn khung danh sách đang mở (cảm xúc / chia sẻ) hoặc bấm "Xem thêm bình luận",
// gom tên + link trang cá nhân, rồi cho người dùng bấm mở trang PCCV với danh sách đó.
// Không tự mở bài viết khác, không gửi dữ liệu đi đâu ngoài trang PCCV của CLB.
// Hàm này được chuyển thành chuỗi để làm bookmarklet nên KHÔNG được dùng biến bên ngoài.
window.fbHelper = function fbHelper(site) {
  if (window.__pccvRunning) return;
  window.__pccvRunning = true;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var JUNK = /^(thêm bạn bè|add friend|theo dõi|follow|đang theo dõi|following|nhắn tin|message|kết bạn|bạn bè|friends|xem thêm|see more|trả lời|reply|thích|like|chia sẻ|share|tất cả|all|bình luận|comment|xem bản dịch|see translation|\d.*)$/i;
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;background:#1a56db;color:#fff;padding:12px 16px;' +
    'border-radius:10px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3);width:280px';
  box.innerHTML = '<b>📣 Gửi sang PCCV</b><div data-m style="margin:6px 0 10px">Đang bắt đầu…</div>' +
    '<button data-stop style="padding:6px 10px;border-radius:6px;border:0;cursor:pointer">Dừng & dùng danh sách hiện có</button>';
  document.body.appendChild(box);
  var stop = false;
  box.querySelector('[data-stop]').onclick = function () { stop = true; };
  var msg = function (t) { box.querySelector('[data-m]').textContent = t; };

  // Chế độ CẬP NHẬT HÀNG LOẠT: PCCV mở facebook.com kèm #pccv-batch=<danh sách> → đọc lần lượt từng trang cá nhân
  if (/#pccv-batch=/.test(location.hash)) {
    var list;
    try { list = JSON.parse(decodeURIComponent(escape(atob(location.hash.split('#pccv-batch=')[1])))); } catch (e) { list = null; }
    if (list && list.length) {
      var BAD = /^(facebook|log in|login|đăng nhập|log into facebook|trang không tồn tại|page not found|nội dung này hiện không hiển thị|this content isn't available.*)$/i;
      var cleanProfile = function (u) {
        try {
          var x = new URL(u);
          if (/profile\.php/.test(x.pathname)) return x.origin + '/profile.php?id=' + (x.searchParams.get('id') || '');
          var seg = x.pathname.split('/').filter(Boolean)[0] || '';
          return seg && seg !== 'share' && seg !== 'login' ? 'https://www.facebook.com/' + seg : '';
        } catch (e) { return ''; }
      };
      (async function () {
        var out = [];
        for (var i = 0; i < list.length && !stop; i++) {
          var it = list[i];
          msg('Đang đọc ' + (i + 1) + '/' + list.length + '…');
          var name = '', url = '';
          try {
            var r = await fetch(it.url, { credentials: 'include' });
            var html = await r.text();
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var og = doc.querySelector('meta[property="og:title"]');
            name = ((og && og.getAttribute('content')) || doc.title || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s*[|\-–]\s*Facebook\s*$/i, '').trim();
            if (BAD.test(name)) name = '';
            url = cleanProfile(r.url) || cleanProfile((doc.querySelector('link[rel="canonical"]') || {}).href || '') || '';
          } catch (e) { /* bỏ qua người này */ }
          out.push({ id: it.id, name: name, url: url });
          await sleep(1800 + Math.random() * 1200);
        }
        var ok = out.filter(function (x) { return x.name; }).length;
        msg('Xong: đọc được ' + ok + '/' + out.length + ' người.');
        var b = box.querySelector('[data-stop]');
        var d = btoa(unescape(encodeURIComponent(JSON.stringify({ kind: 'profiles', items: out, names: [] }))));
        b.textContent = '📨 Gửi kết quả về PCCV';
        b.onclick = function () { window.open(site + '#seed-import=' + d, 'pccv-import'); box.remove(); window.__pccvRunning = false; };
      })();
      return;
    }
  }

  var dialogs = Array.prototype.filter.call(document.querySelectorAll('[role="dialog"]'), function (d) { return d.getClientRects().length > 0; });
  var dlg = dialogs.length ? dialogs[dialogs.length - 1] : null;
  var root = dlg || document;
  var head = dlg ? ((dlg.getAttribute('aria-label') || '') + ' ' + ((dlg.querySelector('h1,h2,[role="heading"]') || {}).textContent || '')).toLowerCase() : '';
  var kind = /chia sẻ|share/.test(head) ? 'share' : /cảm xúc|react|thích|like/.test(head) ? 'like' : 'comment';

  // Chế độ TRANG CÁ NHÂN: không có khung danh sách, đường dẫn không phải bài viết → đọc tên + link thật
  var isPost = /\/(posts|permalink|photo|photos|videos|reel|watch|story\.php|groups|share|events)\b|story_fbid|fbid=|pfbid/.test(location.pathname + location.search);
  if (!dlg && !isPost) {
    var h1 = Array.prototype.map.call(document.querySelectorAll('h1'), function (h) { return (h.innerText || h.textContent || '').trim().split('\n')[0].trim(); })
      .filter(function (t) { return t && !/^(facebook|thông báo|notifications|bảng feed|feeds?|trang chủ|home)$/i.test(t); })[0] || '';
    var seg = location.pathname.split('/').filter(Boolean)[0] || '';
    var url = seg === 'profile.php' ? location.origin + '/profile.php?id=' + (new URLSearchParams(location.search).get('id') || '') : location.origin + '/' + seg;
    if (h1 && seg) {
      var pdata = btoa(unescape(encodeURIComponent(JSON.stringify({ kind: 'profile', name: h1, url: url, names: [] }))));
      box.querySelector('[data-m]').textContent = 'Trang cá nhân: ' + h1;
      var pb = box.querySelector('[data-stop]');
      pb.textContent = '📨 Lưu tên này vào PCCV';
      pb.onclick = function () { window.open(site + '#seed-import=' + pdata, 'pccv-import'); box.remove(); window.__pccvRunning = false; };
      var px = document.createElement('button');
      px.textContent = 'Đóng';
      px.style.cssText = 'margin-left:6px;padding:6px 10px;border-radius:6px;border:0;cursor:pointer';
      px.onclick = function () { box.remove(); window.__pccvRunning = false; };
      pb.after(px);
      return;
    }
  }

  var findScroller = function (el) {
    var best = null;
    var nodes = [el].concat(Array.prototype.slice.call(el.querySelectorAll('*')));
    nodes.forEach(function (n) {
      var s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 20 && (!best || n.scrollHeight > best.scrollHeight)) best = n;
    });
    return best;
  };
  var cleanUrl = function (h) {
    try {
      var u = new URL(h, location.origin);
      if (/profile\.php/.test(u.pathname)) return u.origin + u.pathname + '?id=' + (u.searchParams.get('id') || '');
      return u.origin + u.pathname.replace(/\/$/, '');
    } catch (e) { return ''; }
  };
  var collect = function () {
    var out = {};
    if (kind === 'comment') {
      root.querySelectorAll('[role="article"][aria-label]').forEach(function (a) {
        var m = a.getAttribute('aria-label').match(/^(?:bình luận (?:của|dưới tên)|phản hồi (?:của|dưới tên)|trả lời của|comment by|reply by)\s+(.+?)(?:\s+(?:vào|lúc|\d|cách đây|a |an ).*)?$/i);
        if (m && !out[m[1].trim()]) out[m[1].trim()] = '';
      });
    }
    root.querySelectorAll('a[href]').forEach(function (a) {
      var t = (a.innerText || a.textContent || '').trim().split('\n')[0].trim();
      if (!t || t.length < 2 || t.length > 60 || JUNK.test(t)) return;
      var h = a.getAttribute('href') || '';
      if (/\/(groups|pages|events|hashtag|photo|photos|watch|reel|stories|posts|videos)\b|comment_id=|\/ufi\//.test(h)) return;
      if (kind === 'comment' && !a.closest('[role="article"]')) return;
      if (!(t in out) || !out[t]) out[t] = cleanUrl(h);
    });
    return out;
  };

  (async function () {
    var stable = 0, last = -1;
    for (var i = 0; i < 400 && !stop; i++) {
      if (kind === 'comment') {
        var btns = Array.prototype.filter.call(root.querySelectorAll('[role="button"]'), function (b) {
          return /^(xem thêm bình luận|xem thêm \d+ bình luận|xem các bình luận trước|xem \d+ phản hồi|xem tất cả \d+ phản hồi|view more comments|view \d+ more comments|view previous comments|view \d+ repl(y|ies)|view all \d+ replies)/i.test((b.innerText || '').trim());
        });
        btns.slice(0, 2).forEach(function (b) { b.click(); });
        window.scrollBy(0, 500);
      } else {
        var sc = findScroller(dlg || document.body);
        if (sc) sc.scrollTop = sc.scrollHeight; else window.scrollTo(0, document.body.scrollHeight);
      }
      await sleep(1100 + Math.random() * 900);
      var n = Object.keys(collect()).length;
      msg('Đang tự cuộn… đã thấy ' + n + ' tên');
      if (n === last) { if (++stable >= 4) break; } else { stable = 0; last = n; }
    }
    var all = collect();
    var names = Object.keys(all).map(function (k) { return { name: k, url: all[k] }; });
    var data = btoa(unescape(encodeURIComponent(JSON.stringify({ kind: kind, post: location.href.split('#')[0], names: names }))));
    msg('Xong! Tìm thấy ' + names.length + ' tên (' + (kind === 'like' ? 'cảm xúc' : kind === 'share' ? 'chia sẻ' : 'bình luận') + ').');
    var btn = box.querySelector('[data-stop]');
    btn.textContent = '📨 Mở PCCV để đối chiếu';
    btn.onclick = function () {
      window.open(site + '#seed-import=' + data, 'pccv-import');
      box.remove();
      window.__pccvRunning = false;
    };
    var x = document.createElement('button');
    x.textContent = 'Đóng';
    x.style.cssText = 'margin-left:6px;padding:6px 10px;border-radius:6px;border:0;cursor:pointer';
    x.onclick = function () { box.remove(); window.__pccvRunning = false; };
    btn.after(x);
  })();
};

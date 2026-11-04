// Nút "Gửi sang PCCV" (bookmarklet) – chạy trên trang Facebook mà CHÍNH NGƯỜI DÙNG đang mở.
// Việc nó làm: cuộn khung danh sách đang mở (cảm xúc / chia sẻ) hoặc bấm "Xem thêm bình luận",
// gom tên + link trang cá nhân, rồi cho người dùng bấm mở trang PCCV với danh sách đó.
// Không tự mở bài viết khác, không gửi dữ liệu đi đâu ngoài trang PCCV của CLB.
// Hàm này được chuyển thành chuỗi để làm bookmarklet nên KHÔNG được dùng biến bên ngoài.
window.fbHelper = function fbHelper(site, opts) {
  if (window.__pccvRunning) return;
  window.__pccvRunning = true;
  opts = opts || {};
  var _campaignId = opts.campaignId || '';
  try {
    var _scanM = location.hash.match(/#pccv-scan=(.+)/);
    if (_scanM) {
      var _scan = JSON.parse(decodeURIComponent(_scanM[1]));
      if (_scan.site) site = _scan.site;
      if (_scan.cid) _campaignId = _scan.cid;
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch(e) {}
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var JUNK = /^(thêm bạn bè|add friend|theo dõi|follow|đang theo dõi|following|nhắn tin|message|kết bạn|bạn bè|friends|xem thêm|see more|trả lời|reply|thích|like|chia sẻ|share|tất cả|all|bình luận|comment|xem bản dịch|see translation|\d.*)$/i;
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;background:#1a56db;color:#fff;padding:12px 16px;' +
    'border-radius:10px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3);width:280px';
  box.innerHTML = '<b>📣 Gửi sang PCCV</b> <small style="opacity:.7">v9</small><div data-m style="margin:6px 0 10px">Đang bắt đầu…</div>' +
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
      var JUNKH = /^(thông báo|notifications|bảng feed|feeds?|trang chủ|home|đoạn chat|chats?|tin nhắn|messages?|messenger|bạn bè|friends|menu|marketplace|video|watch|nhóm|groups|trang|pages|kỷ niệm|memories|đã lưu|saved|cài đặt|settings|tìm kiếm|search|facebook)$/i;
      var okName = function (t) { return !!t && t.length <= 70 && !BAD.test(t) && !JUNKH.test(t); };
      var cleanTitle = function (t) { return String(t || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s*[|\-–]\s*Facebook\s*$/i, '').trim(); };
      var pickName = function (d) {
        // 1) Tiêu đề tab: Facebook đặt thành "Tên | Facebook" khi trang cá nhân hiện xong
        var t = cleanTitle(d.title);
        if (okName(t)) return t;
        // 2) Thẻ h1 trong vùng nội dung chính
        var scope = d.querySelector('[role="main"]') || d;
        var hs = Array.prototype.map.call(scope.querySelectorAll('h1'), function (h) { return (h.innerText || h.textContent || '').trim().split('\n')[0].trim(); });
        return hs.filter(okName)[0] || '';
      };
      // Mở 1 cửa sổ nhỏ (ngay lúc bấm nút nên không bị chặn popup), rồi lần lượt chuyển cửa sổ đó tới từng trang cá nhân
      var win = window.open('about:blank', 'pccv-reader', 'width=1200,height=820,left=20,top=20');
      (async function () {
        var out = [];
        var prev = 'about:blank';
        for (var i = 0; i < list.length && !stop; i++) {
          var it = list[i];
          msg('Đang đọc ' + (i + 1) + '/' + list.length + '…');
          var name = '', url = '', why = '';
          if (win && !win.closed) {
            try {
              win.location.href = it.url;
              var t0 = Date.now();
              while (Date.now() - t0 < 20000 && !stop) {
                await sleep(800);
                var d = null;
                try { d = win.document; } catch (e) { why = 'không truy cập được cửa sổ'; break; }
                if (!d || !d.location || d.location.href === prev || d.location.href === 'about:blank') continue;
                if (/\/login|checkpoint/.test(d.location.pathname)) { why = 'Facebook yêu cầu đăng nhập/xác minh'; break; }
                url = cleanProfile(d.location.href) || url;
                var h = pickName(d);
                if (h) { name = h; prev = d.location.href; break; }
              }
              if (!name && !why) why = 'trang không hiện tên sau 20 giây (tiêu đề: "' + (function () { try { return win.document.title; } catch (e) { return '?'; } })() + '")';
              try { prev = win.location.href; } catch (e) { /* bỏ qua */ }
            } catch (e) { why = 'lỗi cửa sổ: ' + e.message; }
          } else { why = 'cửa sổ phụ bị chặn – hãy cho phép cửa sổ bật lên (popup) cho facebook.com'; }
          if (!name) {
            // Phương án dự phòng: tải HTML của trang
            try {
              var r = await fetch(it.url, { credentials: 'include' });
              var doc = new DOMParser().parseFromString(await r.text(), 'text/html');
              var og = doc.querySelector('meta[property="og:title"]');
              var nm = ((og && og.getAttribute('content')) || doc.title || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s*[|\-–]\s*Facebook\s*$/i, '').trim();
              if (okName(nm)) { name = nm; url = url || cleanProfile(r.url); why = ''; }
              else if (!why) why = 'tiêu đề trang: "' + (doc.title || '') + '"';
            } catch (e) { if (!why) why = 'không tải được trang'; }
          }
          out.push({ id: it.id, name: name, url: url, why: name ? '' : why });
          msg('Đang đọc ' + (i + 1) + '/' + list.length + '… ' + (name ? '✓ ' + name : '✗'));
          await sleep(1200 + Math.random() * 1200);
        }
        try { if (win && !win.closed) win.close(); } catch (e) { /* bỏ qua */ }
        var ok = out.filter(function (x) { return x.name; }).length;
        msg('Xong: đọc được ' + ok + '/' + out.length + ' người.');
        var b = box.querySelector('[data-stop]');
        var dd = btoa(unescape(encodeURIComponent(JSON.stringify({ kind: 'profiles', items: out, names: [] }))));
        b.textContent = '📨 Gửi kết quả về PCCV';
        b.onclick = function () { window.open(site + '#seed-import=' + dd, 'pccv-import'); box.remove(); window.__pccvRunning = false; };
      })();
      return;
    }
  }

  var visibleDialogs = function () { return Array.prototype.filter.call(document.querySelectorAll('[role="dialog"]'), function (d) { return d.getClientRects().length > 0; }); };
  var headOf = function (d) { return ((d.getAttribute('aria-label') || '') + ' ' + ((d.querySelector('h1,h2,[role="heading"]') || {}).textContent || '')).toLowerCase(); };
  var listKindOf = function (d) { var h = headOf(d); return /chia sẻ|share/.test(h) ? 'share' : /cảm xúc|react|lượt thích|likes?\b/.test(h) ? 'like' : ''; };
  var dialogs = visibleDialogs();
  var dlg = dialogs.length ? dialogs[dialogs.length - 1] : null;
  var listKind = dlg ? listKindOf(dlg) : '';

  // Chế độ TRANG CÁ NHÂN: không có khung danh sách, đường dẫn không phải bài viết → đọc tên + link thật
  var isPost = /\/(posts|permalink|photo|photos|videos|reel|watch|story\.php|groups|share|events)\b|story_fbid|fbid=|pfbid/.test(location.pathname + location.search);
  var hasPostSignals = !!document.querySelector('[role="article"][aria-label]') ||
    Array.prototype.some.call(document.querySelectorAll('[aria-label]'), function (n) { return /^(thích|yêu thích|like|love)\s*:\s*[\d.,]+|^(tất cả cảm xúc|all reactions)/i.test(n.getAttribute('aria-label') || ''); }) ||
    /\b\d+\s*(lượt chia sẻ|shares?)\b|tất cả cảm xúc|all reactions/i.test((document.querySelector('[role="main"]') || document.body).innerText || '');
  if (!dlg && !isPost && !hasPostSignals) {
    var JUNK1 = /^(facebook|thông báo|notifications|bảng feed|feeds?|trang chủ|home|đoạn chat|chats?|tin nhắn|messages?|messenger|bạn bè|friends|menu|marketplace|video|watch|nhóm|groups|trang|pages|tìm kiếm|search|đăng nhập|log in)$/i;
    var t1 = String(document.title || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s*[|\-–]\s*Facebook\s*$/i, '').trim();
    var main1 = document.querySelector('[role="main"]') || document;
    var h1 = (t1 && !JUNK1.test(t1) && t1.length <= 70) ? t1 : (Array.prototype.map.call(main1.querySelectorAll('h1'), function (h) { return (h.innerText || h.textContent || '').trim().split('\n')[0].trim(); })
      .filter(function (t) { return t && t.length <= 70 && !JUNK1.test(t); })[0] || '');
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
    var candidates = [];
    var nodes = [el].concat(Array.prototype.slice.call(el.querySelectorAll('*')));
    nodes.forEach(function (n) {
      var s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 20) {
        candidates.push(n);
      }
    });
    if (!candidates.length) return null;
    // Ưu tiên scroller chứa nhiều a[href] (danh sách tên) nhất
    var best = null, bestLinks = -1;
    candidates.forEach(function (c) {
      var links = c.querySelectorAll('a[href]').length;
      if (links > bestLinks) { bestLinks = links; best = c; }
    });
    // Nếu không có a[href] nào, lấy scroller nhỏ nhất (innermost)
    if (bestLinks === 0) {
      best = candidates[0];
      candidates.forEach(function (c) {
        if (c.scrollHeight < best.scrollHeight) best = c;
      });
    }
    return best;
  };
  var cleanUrl = function (h) {
    try {
      var u = new URL(h, location.origin);
      if (/profile\.php/.test(u.pathname)) return u.origin + u.pathname + '?id=' + (u.searchParams.get('id') || '');
      return u.origin + u.pathname.replace(/\/$/, '');
    } catch (e) { return ''; }
  };
  var CMT = /^(?:bình luận (?:của|dưới tên)|phản hồi (?:của|dưới tên)|trả lời của|comment by|reply by)\s+(.+?)(?:\s+(?:vào|lúc|\d|cách đây|a |an ).*)?$/i;
  var textOf = function (a) { return (a.innerText || a.textContent || '').trim().split('\n')[0].trim(); };
  var goodLink = function (a) {
    var t = textOf(a);
    if (!t || t.length < 2 || t.length > 60 || JUNK.test(t)) return false;
    return !/\/(groups|pages|events|hashtag|photo|photos|watch|reel|stories|posts|videos)\b|comment_id=|\/ufi\//.test(a.getAttribute('href') || '');
  };
  // Người bình luận: chỉ lấy các khối bình luận (aria-label "Bình luận của …"), không lấy tác giả bài viết
  var collectComments = function (el) {
    var out = {};
    el.querySelectorAll('[role="article"][aria-label]').forEach(function (art) {
      var m = art.getAttribute('aria-label').match(CMT);
      if (!m) return;
      var name = m[1].trim();
      var link = Array.prototype.filter.call(art.querySelectorAll('a[href]'), goodLink).filter(function (a) { return textOf(a) === name; })[0] ||
        Array.prototype.filter.call(art.querySelectorAll('a[href]'), goodLink)[0];
      if (!out[name]) out[name] = link ? cleanUrl(link.getAttribute('href')) : '';
    });
    return out;
  };
  // Người trong khung danh sách (cảm xúc / chia sẻ)
  var collectList = function (el) {
    var out = {};
    // Tìm scroller bên trong (nếu có) để giới hạn phạm vi thu thập
    var scope = findScroller(el) || el;
    // 1) Cách chính: a[href] có tên hợp lệ — chỉ tìm trong phần cuộn
    scope.querySelectorAll('a[href]').forEach(function (a) {
      if (!goodLink(a)) return;
      var t = textOf(a);
      if (!(t in out) || !out[t]) out[t] = cleanUrl(a.getAttribute('href'));
    });
    // 2) Fallback: tìm a[href] trỏ đến trang cá nhân, lấy tên từ text bên trong link đó
    if (Object.keys(out).length === 0) {
      scope.querySelectorAll('a[href]').forEach(function (a) {
        var href = a.getAttribute('href') || '';
        // Chỉ lấy link profile (không phải link bài viết, group, page...)
        if (/\/(groups|pages|events|hashtag|photo|photos|watch|reel|stories|posts|videos|share)\b/.test(href)) return;
        if (!/^\/?[a-zA-Z0-9.]+\/?$/.test(href.replace(/^https?:\/\/[^/]+/, '').split('?')[0]) &&
            !/profile\.php/.test(href)) return;
        // Lấy tên = text đầu tiên trong link hoặc span con trực tiếp
        var t = textOf(a);
        if (t && t.length >= 2 && t.length <= 60 && !JUNK.test(t) && !/^\d/.test(t)) {
          if (!(t in out) || !out[t]) out[t] = cleanUrl(href);
        }
      });
    }
    return out;
  };
  var toArr = function (o) { return Object.keys(o).map(function (k) { return { name: k, url: o[k] }; }); };

  var scrollList = async function (d, label) {
    var stable = 0, last = -1, noScroller = 0, cachedSc = null;
    // Đợi nội dung dialog load (Facebook lazy-load danh sách cảm xúc)
    await sleep(2000);
    for (var i = 0; i < 400 && !stop; i++) {
      // Tìm scroller — khi đã tìm thấy, dùng lại nếu vẫn còn trong DOM
      var sc = (cachedSc && document.contains(cachedSc)) ? cachedSc : findScroller(d);
      if (sc) {
        cachedSc = sc;
        sc.scrollTop = sc.scrollHeight;
        noScroller = 0;
      } else {
        noScroller++;
        if (noScroller >= 8) break;
      }
      await sleep(1100 + Math.random() * 900);
      var n = Object.keys(collectList(d)).length;
      msg(label + ': đang tự cuộn… ' + n + ' tên' + (sc ? '' : ' (đợi scroller…)'));
      if (n === last) { if (++stable >= 4 && n > 0) break; } else { stable = 0; last = n; }
    }
    return collectList(d);
  };
  var MORE = /^(xem thêm bình luận|xem thêm \d+ bình luận|xem các bình luận trước|xem \d+ phản hồi|xem tất cả \d+ phản hồi|view more comments|view \d+ more comments|view previous comments|view \d+ repl(y|ies)|view all \d+ replies)/i;
  var expandComments = async function (el) {
    var stable = 0, last = -1;
    for (var i = 0; i < 300 && !stop; i++) {
      var btns = Array.prototype.filter.call(el.querySelectorAll('[role="button"]'), function (b) { return MORE.test((b.innerText || '').trim()); });
      btns.slice(0, 2).forEach(function (b) { b.click(); });
      var sc = el !== document && findScroller(el);
      if (sc) sc.scrollTop = sc.scrollHeight; else window.scrollBy(0, 500);
      await sleep(1100 + Math.random() * 900);
      var n = Object.keys(collectComments(el)).length;
      msg('Bình luận: đang mở thêm… ' + n + ' người');
      if (n === last && !btns.length) { if (++stable >= 3) break; } else { stable = 0; last = n; }
    }
    return collectComments(el);
  };
  var closeDialog = async function (d) {
    var b = d.querySelector('[aria-label="Đóng"],[aria-label="Close"]');
    if (b) b.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    for (var t = 0; t < 10 && document.contains(d) && d.getClientRects().length; t++) await sleep(300);
  };
  var finish = function (payload, summary) {
    if (_campaignId) payload.campaignId = _campaignId;
    var data = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    if (opts.onDone) {
      msg(summary + ' – đang gửi về PCCV…');
      try { opts.onDone(data); } catch(e) {}
      setTimeout(function() { box.remove(); window.__pccvRunning = false; }, 2000);
      return;
    }
    msg(summary);
    var btn = box.querySelector('[data-stop]');
    btn.textContent = '📨 Mở PCCV để đối chiếu';
    btn.onclick = function () { window.open(site + '#seed-import=' + data, 'pccv-import'); box.remove(); window.__pccvRunning = false; };
    var x = document.createElement('button');
    x.textContent = 'Đóng';
    x.style.cssText = 'margin-left:6px;padding:6px 10px;border-radius:6px;border:0;cursor:pointer';
    x.onclick = function () { box.remove(); window.__pccvRunning = false; };
    btn.after(x);
  };
  var post = location.href.split('#')[0];
  var LBL = { like: 'Cảm xúc', comment: 'Bình luận', share: 'Chia sẻ' };

  var isReactDialog = function (d) {
    if (listKindOf(d) === 'like') return true;
    return Array.prototype.some.call(d.querySelectorAll('[role="tab"]'), function (tb) { return /^(tất cả|all)(\s|$|\d)/i.test(textOf(tb)); });
  };
  // Chờ NGƯỜI DÙNG bấm vào số lượt cảm xúc của đúng bài → trả về khung danh sách + chỗ đã bấm
  var waitReactClick = function () {
    return new Promise(function (resolve) {
      var lastClick = null, skipped = false;
      var before = visibleDialogs();
      var onClick = function (e) { if (!box.contains(e.target)) lastClick = e.target; };
      document.addEventListener('click', onClick, true);
      var sk = document.createElement('button');
      sk.textContent = 'Bài chưa có cảm xúc → bỏ qua';
      sk.style.cssText = 'margin-top:6px;padding:6px 10px;border-radius:6px;border:0;cursor:pointer;display:block';
      sk.onclick = function () { skipped = true; };
      box.appendChild(sk);
      var iv = setInterval(function () {
        if (stop || skipped) return done(null);
        var d = visibleDialogs().filter(function (x) { return before.indexOf(x) < 0 && isReactDialog(x); })[0];
        if (d) done({ dialog: d, target: lastClick });
      }, 400);
      function done(r) { clearInterval(iv); document.removeEventListener('click', onClick, true); sk.remove(); resolve(r); }
    });
  };

  (async function () {
    if (listKind) {
      // Đang mở sẵn 1 khung cảm xúc / chia sẻ → chỉ lấy khung đó
      var one = toArr(await scrollList(dlg, LBL[listKind]));
      finish({ kind: listKind, post: post, names: one }, 'Xong! ' + LBL[listKind] + ': ' + one.length + ' tên.');
      return;
    }
    var lists = {}, missing = {};
    box.style.background = '#e02424';
    msg('👉 Bấm vào SỐ LƯỢT CẢM XÚC (👍❤️ + con số) ngay dưới bài viết cần quét. Tool sẽ tự cuộn lấy tên, rồi tự lấy bình luận.');
    var got = await waitReactClick();
    box.style.background = '#1a56db';
    var target = got && got.target;
    if (got) {
      var d = got.dialog;
      await sleep(1500);
      var all = Array.prototype.filter.call(d.querySelectorAll('[role="tab"]'), function (tb) { return /^(tất cả|all)(\s|$|\d)/i.test(textOf(tb)); })[0];
      if (all && all.getAttribute('aria-selected') !== 'true') { all.click(); await sleep(2000); }
      lists.like = toArr(await scrollList(d, LBL.like));
      await closeDialog(d);
      await sleep(800);
    } else {
      lists.like = [];
      missing.like = 'bỏ qua – không quét cảm xúc';
    }
    // Bình luận: trong khung bài viết chứa nút vừa bấm; trang riêng thì vùng chính
    var pd = target && target.closest && target.closest('[role="dialog"]');
    var root = (pd && !isReactDialog(pd)) ? pd : (document.querySelector('[role="main"]') || document);
    if (!stop) lists.comment = toArr(await expandComments(root));
    var sum = ['like', 'comment'].map(function (k) { return LBL[k] + ': ' + (lists[k] ? lists[k].length : '✗'); }).join(' · ');
    finish({ kind: 'all', post: post, lists: lists, missing: missing, names: [] }, 'Xong! ' + sum);
  })();
};

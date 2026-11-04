(() => {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const DEMO = !CFG.API_URL;
  const AUTH_ERRORS = ['AUTH_REQUIRED', 'AUTH_EXPIRED', 'AUTH_INVALID'];

  /* ---------------- helpers ---------------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nkey = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const daysUntil = (iso) => {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((new Date(y, m - 1, d) - now) / 86400000);
  };
  const fmtDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}`; };
  const shortName = (n) => { const p = String(n).trim().split(/\s+/); return p.length > 2 ? p.slice(-2).join(' ') : n; };

  const state = {
    token: null, demoEmail: null, data: null,
    view: store.get('view') || 'mine',
    filters: {}, confirms: null,
  };

  /* ---------------- API ---------------- */
  async function api(action, payload = {}) {
    if (DEMO) return window.DemoApi.call(action, payload, state.demoEmail);
    let res;
    try {
      res = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify({ action, token: state.token, payload }) });
    } catch (e) { throw new Error('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'); }
    if (!res.ok) throw new Error('Máy chủ lỗi (' + res.status + ').');
    const j = await res.json();
    if (!j.ok) { const e = new Error(j.message || j.error); e.code = j.error; throw e; }
    return j.data;
  }

  async function run(fn, { busyEl } = {}) {
    if (busyEl) busyEl.disabled = true;
    try { return await fn(); } catch (e) {
      if (AUTH_ERRORS.includes(e.code)) { logout('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'); return; }
      toast(e.message || String(e), 'error');
    } finally { if (busyEl) busyEl.disabled = false; }
  }

  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('hide'), 3500);
    setTimeout(() => el.remove(), 4000);
  }

  /* ---------------- auth ---------------- */
  function jwtExp(t) {
    try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (e) { return 0; }
  }
  function waitForGoogle() {
    return new Promise((resolve, reject) => {
      let n = 0;
      const tick = () => { if (window.google && google.accounts && google.accounts.id) resolve(); else if (++n > 100) reject(new Error('Không tải được Google Sign-In.')); else setTimeout(tick, 100); };
      tick();
    });
  }

  function renderLogin(message) {
    $('#app').innerHTML = `
      <div class="login">
        <div class="login-card">
          <div class="logo">📋</div>
          <h1>${esc(CFG.CLUB_NAME || 'TeamTracking')}</h1>
          <p class="muted">Bảng phân công công việc của team</p>
          ${message ? `<p class="alert">${esc(message)}</p>` : ''}
          ${DEMO ? `
            <p class="demo-note">Đang chạy <b>chế độ demo</b> với dữ liệu mẫu. Chọn một người để đăng nhập thử:</p>
            <select id="demo-user">${window.DemoApi.members.map((m) => `<option value="${esc(m.email)}">${esc(m.name)}${m.title ? ' – ' + esc(m.title) : ''}</option>`).join('')}</select>
            <button class="btn primary block" data-act="demo-login">Đăng nhập demo</button>`
            : `<div id="gsi-btn"></div><p class="muted small">Dùng đúng tài khoản Google có email trong danh sách thành viên.</p>`}
        </div>
      </div>`;
    if (!DEMO) {
      waitForGoogle().then(() => {
        google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: (r) => onCredential(r.credential), auto_select: true });
        google.accounts.id.renderButton($('#gsi-btn'), { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', locale: 'vi' });
        if (!message) google.accounts.id.prompt();
      }).catch((e) => toast(e.message, 'error'));
    }
  }

  function onCredential(token) {
    state.token = token;
    store.set('idToken', token);
    loadData();
  }

  function logout(message) {
    state.token = null; state.data = null; state.demoEmail = null;
    store.del('idToken'); store.del('demoEmail');
    if (!DEMO && window.google && google.accounts) google.accounts.id.disableAutoSelect();
    renderLogin(message);
  }

  async function loadData() {
    $('#app').innerHTML = '<div class="loading"><div class="spinner"></div><p>Đang tải dữ liệu…</p></div>';
    try {
      state.data = await api('bootstrap');
      const valid = viewList().some((v) => v.id === state.view);
      if (!valid) state.view = 'mine';
      render();
    } catch (e) {
      if (AUTH_ERRORS.includes(e.code)) return logout('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
      if (e.code === 'NOT_MEMBER') return logout(e.message);
      $('#app').innerHTML = `<div class="loading"><p class="alert">${esc(e.message)}</p><button class="btn" data-act="reload">Thử lại</button> <button class="btn ghost" data-act="logout">Đăng xuất</button></div>`;
    }
  }

  /* ---------------- derived data ---------------- */
  const D = () => state.data;
  const me = () => D().me;
  const myKey = () => nkey(me().name);
  const banOf = (name) => D().bans.find((b) => b.name === name);
  const isDone = (t) => t.status === D().doneStatus;
  const peopleOfLead = (t) => String(t.lead || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  const canManage = (ban) => !!(banOf(ban) && banOf(ban).canManage);
  const isLeadOf = (t) => peopleOfLead(t).some((n) => nkey(n) === myKey());
  const isAssignee = (t) => t.parts.some((p) => p.people.some((n) => nkey(n) === myKey()));
  const canFull = (t) => canManage(t.ban) || isLeadOf(t);
  const canEdit = (t) => canFull(t) || isAssignee(t);
  const roleLabel = (ban, key) => { const r = banOf(ban).roles.find((x) => x.key === key); return r ? r.label : key; };
  const memberKnown = (n) => D().members.some((m) => nkey(m.name) === nkey(n));
  const canSeeConfirms = () => me().isAdmin || me().leadOf.length > 0;

  function viewList() {
    const v = [{ id: 'mine', label: '🙋 Việc của tôi' }];
    D().bans.forEach((b) => v.push({ id: 'ban:' + b.name, label: b.name }));
    v.push({ id: 'overview', label: '📊 Tổng quan' });
    if (canSeeConfirms()) v.push({ id: 'confirm', label: '📧 Xác nhận email' });
    return v;
  }

  function deadlineBadge(iso, done) {
    if (!iso) return '<span class="badge muted">Chưa có hạn</span>';
    const d = daysUntil(iso);
    if (done) return `<span class="badge muted">${fmtDate(iso)}</span>`;
    if (d < 0) return `<span class="badge danger">Quá hạn ${-d} ngày · ${fmtDate(iso)}</span>`;
    if (d === 0) return `<span class="badge warn">Hôm nay</span>`;
    if (d === 1) return `<span class="badge warn">Ngày mai · ${fmtDate(iso)}</span>`;
    if (d <= 3) return `<span class="badge warn">Còn ${d} ngày · ${fmtDate(iso)}</span>`;
    return `<span class="badge">${fmtDate(iso)}</span>`;
  }

  function statusControl(t) {
    const st = t.status || '';
    if (!canEdit(t)) return `<span class="status s-${nkey(st || 'trong').replace(/ /g, '-')}">${esc(st || '—')}</span>`;
    const opts = ['', ...D().statuses].map((s) => `<option value="${esc(s)}" ${s === st ? 'selected' : ''}>${esc(s || '— Trạng thái —')}</option>`).join('');
    return `<select class="status-select s-${nkey(st || 'trong').replace(/ /g, '-')}" data-change="status" data-id="${esc(t.id)}">${opts}</select>`;
  }

  function linksOf(t) {
    return Object.entries(t.extras || {}).filter(([, v]) => v && (v.url || v.text))
      .map(([k, v]) => v.url
        ? `<a class="link" href="${esc(v.url)}" target="_blank" rel="noopener" title="${esc(k)}">🔗 ${esc(v.text && v.text !== v.url ? v.text : k)}</a>`
        : `<span class="link plain" title="${esc(k)}">${esc(k)}: ${esc(v.text)}</span>`).join(' ');
  }

  function chip(n) {
    const mine = nkey(n) === myKey();
    const unknown = !memberKnown(n);
    return `<span class="chip ${mine ? 'me' : ''} ${unknown ? 'unknown' : ''}" title="${esc(n)}${unknown ? ' – không có trong danh sách thành viên' : ''}">${esc(shortName(n))}</span>`;
  }

  /* ---------------- layout ---------------- */
  function render() {
    const views = viewList();
    const m = me();
    $('#app').innerHTML = `
      <header class="topbar">
        <div class="brand">📋 <span>${esc(D().clubName || CFG.CLUB_NAME)}</span>${DEMO ? '<em class="demo-tag">DEMO</em>' : ''}</div>
        <div class="user">
          <button class="btn ghost small" data-act="antispam" title="Để email nhắc việc không vào Spam">${m.confirm === 'tin_cay' ? '🛡️ Đã chống spam' : '🛡️ Chống spam'}</button>
          <span class="who" title="${esc(m.email)}">${esc(m.name)}${m.isAdmin ? ' · Quản trị' : m.leadOf.length ? ' · Trưởng ban' : ''}</span>
          <button class="btn ghost small" data-act="reload" title="Tải lại dữ liệu">⟳</button>
          <button class="btn ghost small" data-act="logout">Đăng xuất</button>
        </div>
      </header>
      <nav class="tabs">${views.map((v) => `<button class="tab ${v.id === state.view ? 'active' : ''}" data-act="view" data-view="${esc(v.id)}">${esc(v.label)}</button>`).join('')}</nav>
      <main id="main"></main>`;
    renderMain();
  }

  function renderMain() {
    const v = state.view;
    const main = $('#main');
    if (v === 'mine') main.innerHTML = viewMine();
    else if (v.startsWith('ban:')) { main.innerHTML = viewBanShell(v.slice(4)); renderBanBody(); }
    else if (v === 'overview') main.innerHTML = viewOverview();
    else if (v === 'confirm') { main.innerHTML = '<div class="loading"><div class="spinner"></div></div>'; loadConfirms(); }
  }

  /* ---------------- view: mine ---------------- */
  function viewMine() {
    const items = [];
    D().tasks.forEach((t) => t.parts.forEach((p) => {
      if (p.people.some((n) => nkey(n) === myKey())) items.push({ t, p, d: daysUntil(p.deadline) });
    }));
    const open = items.filter((x) => !isDone(x.t));
    const groups = [
      { title: '🔴 Quá hạn', list: open.filter((x) => x.d !== null && x.d < 0) },
      { title: '🟠 Hôm nay & ngày mai', list: open.filter((x) => x.d !== null && x.d >= 0 && x.d <= 1) },
      { title: '🟡 Trong 7 ngày tới', list: open.filter((x) => x.d !== null && x.d > 1 && x.d <= 7) },
      { title: '🔵 Sắp tới', list: open.filter((x) => x.d !== null && x.d > 7) },
      { title: '⚪ Chưa có deadline', list: open.filter((x) => x.d === null) },
    ];
    groups.forEach((g) => g.list.sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9)));
    const doneCount = items.filter((x) => isDone(x.t)).length;
    const leading = D().tasks.filter((t) => isLeadOf(t) && !isDone(t));

    const card = ({ t, p }) => `
      <div class="card task-card">
        <div class="tc-main">
          <div class="tc-title">${esc(t.name)}</div>
          <div class="tc-meta">${esc(t.event || 'Không có sự kiện')} · ${esc(t.ban)}${banOf(t.ban).roles.length > 1 ? ' · <b>' + esc(roleLabel(t.ban, p.role)) + '</b>' : ''}</div>
          ${t.note ? `<div class="tc-note">${esc(t.note)}</div>` : ''}
          <div class="tc-links">${linksOf(t)}</div>
        </div>
        <div class="tc-side">
          ${deadlineBadge(p.deadline, isDone(t))}
          ${statusControl(t)}
          <button class="btn ghost small" data-act="edit" data-id="${esc(t.id)}">Chi tiết</button>
        </div>
      </div>`;

    let html = antispamBanner();
    html += `<div class="page-head"><h2>Việc của tôi</h2><p class="muted">${open.length} việc chưa xong · ${doneCount} đã hoàn thành</p></div>`;
    if (!items.length) html += '<div class="empty">Bạn chưa được giao việc nào. 🎉</div>';
    groups.forEach((g) => {
      if (!g.list.length) return;
      html += `<section class="group"><h3>${g.title} <span class="count">${g.list.length}</span></h3>${g.list.map(card).join('')}</section>`;
    });
    if (leading.length) {
      html += `<section class="group"><h3>⭐ Việc tôi làm Lead <span class="count">${leading.length}</span></h3>
        <div class="card"><table class="mini"><tbody>${leading.map((t) => `<tr>
          <td><b>${esc(t.name)}</b><div class="muted small">${esc(t.event)} · ${esc(t.ban)}</div></td>
          <td>${t.parts.map((p) => p.people.map(chip).join('') + ' ' + (p.deadline ? deadlineBadge(p.deadline, false) : '')).join('<br>')}</td>
          <td>${statusControl(t)}</td>
          <td><button class="btn ghost small" data-act="edit" data-id="${esc(t.id)}">Sửa</button></td></tr>`).join('')}</tbody></table></div></section>`;
    }
    return html;
  }

  function antispamBanner() {
    if (me().confirm === 'tin_cay') return '';
    return `<div class="banner">
      <div><b>🛡️ Để email nhắc việc không rơi vào Spam</b><br><span class="small">Mất 10 giây: cho phép website tạo bộ lọc Gmail, hoặc trả lời "OK" email xác nhận từ <b>${esc(D().senderEmail)}</b>.</span></div>
      <button class="btn primary small" data-act="antispam">Làm ngay</button></div>`;
  }

  /* ---------------- view: ban ---------------- */
  function viewBanShell(banName) {
    const b = banOf(banName);
    if (!b) return '<div class="empty">Không tìm thấy Ban.</div>';
    const f = state.filters[banName] || (state.filters[banName] = { event: '', status: 'open', person: '', q: '' });
    const events = [...new Set(D().tasks.filter((t) => t.ban === banName).map((t) => t.event || ''))];
    const people = D().members.filter((m) => m.bans.includes(banName)).map((m) => m.name);
    return `
      <div class="page-head row">
        <div><h2>${esc(banName)}</h2><p class="muted">${b.roles.length > 1 ? 'Vai trò: ' + b.roles.map((r) => esc(r.label)).join(' · ') : ''}</p></div>
        ${b.canManage ? `<div class="actions">
          <button class="btn" data-act="clone" data-ban="${esc(banName)}">⧉ Tạo sự kiện từ mẫu</button>
          <button class="btn primary" data-act="new" data-ban="${esc(banName)}">＋ Thêm công việc</button></div>` : ''}
      </div>
      <div class="filters">
        <select data-filter="event"><option value="">Tất cả sự kiện</option>${events.map((e) => `<option value="${esc(e)}" ${f.event === e ? 'selected' : ''}>${esc(e || '(Không có sự kiện)')}</option>`).join('')}</select>
        <select data-filter="status">
          <option value="open" ${f.status === 'open' ? 'selected' : ''}>Chưa hoàn thành</option>
          <option value="" ${f.status === '' ? 'selected' : ''}>Tất cả trạng thái</option>
          ${D().statuses.map((s) => `<option value="${esc(s)}" ${f.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          <option value="late" ${f.status === 'late' ? 'selected' : ''}>Đang quá hạn</option>
        </select>
        <select data-filter="person"><option value="">Mọi người</option>
          <option value="__me" ${f.person === '__me' ? 'selected' : ''}>Chỉ việc của tôi</option>
          ${people.map((n) => `<option value="${esc(n)}" ${f.person === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <input type="search" data-filter="q" placeholder="Tìm công việc, ghi chú…" value="${esc(f.q)}">
      </div>
      <div id="ban-body" data-ban="${esc(banName)}"></div>`;
  }

  function filteredTasks(banName) {
    const f = state.filters[banName];
    const q = nkey(f.q);
    return D().tasks.filter((t) => {
      if (t.ban !== banName) return false;
      if (f.event && (t.event || '') !== f.event) return false;
      if (f.status === 'open' && isDone(t)) return false;
      if (f.status === 'late' && (isDone(t) || !t.parts.some((p) => p.deadline && daysUntil(p.deadline) < 0))) return false;
      if (f.status && !['open', 'late'].includes(f.status) && (t.status || '') !== f.status) return false;
      if (f.person) {
        const k = f.person === '__me' ? myKey() : nkey(f.person);
        if (!t.parts.some((p) => p.people.some((n) => nkey(n) === k)) && !peopleOfLead(t).some((n) => nkey(n) === k)) return false;
      }
      if (q && !nkey(t.name + ' ' + t.note + ' ' + t.event).includes(q)) return false;
      return true;
    });
  }

  function renderBanBody() {
    const body = $('#ban-body');
    if (!body) return;
    const banName = body.dataset.ban;
    const b = banOf(banName);
    const all = D().tasks.filter((t) => t.ban === banName);
    const list = filteredTasks(banName);
    if (!list.length) { body.innerHTML = '<div class="empty">Không có công việc nào khớp bộ lọc.</div>'; return; }
    const order = [];
    list.forEach((t) => { if (!order.includes(t.event || '')) order.push(t.event || ''); });
    body.innerHTML = order.map((ev) => {
      const rows = list.filter((t) => (t.event || '') === ev);
      const evAll = all.filter((t) => (t.event || '') === ev);
      const done = evAll.filter(isDone).length;
      const pct = evAll.length ? Math.round((done / evAll.length) * 100) : 0;
      return `<section class="event">
        <div class="event-head"><h3>${esc(ev || '(Không có sự kiện)')}</h3>
          <div class="progress" title="${done}/${evAll.length} việc hoàn thành"><div style="width:${pct}%"></div></div>
          <span class="muted small">${done}/${evAll.length} xong</span></div>
        <div class="table-wrap"><table class="tasks">
          <thead><tr><th>Công việc</th>${b.roles.map((r) => `<th>${esc(r.label)}</th>`).join('')}${b.hasLead ? '<th>Lead</th>' : ''}<th>Trạng thái</th><th>Liên kết</th><th></th></tr></thead>
          <tbody>${rows.map((t) => `<tr class="${isDone(t) ? 'done' : ''} ${isAssignee(t) ? 'mine' : ''}">
            <td class="c-name"><b>${esc(t.name)}</b>${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}</td>
            ${t.parts.map((p) => `<td class="c-role">${p.people.length ? p.people.map(chip).join('') : '<span class="chip empty">Chưa giao</span>'}
              ${banOf(t.ban).roles.find((r) => r.key === p.role).hasDeadline ? '<div>' + deadlineBadge(p.deadline, isDone(t)) + '</div>' : ''}</td>`).join('')}
            ${b.hasLead ? `<td>${peopleOfLead(t).map(chip).join('')}</td>` : ''}
            <td>${statusControl(t)}</td>
            <td class="c-links">${linksOf(t)}</td>
            <td>${canEdit(t) ? `<button class="btn ghost small" data-act="edit" data-id="${esc(t.id)}">Sửa</button>` : `<button class="btn ghost small" data-act="edit" data-id="${esc(t.id)}">Xem</button>`}</td>
          </tr>`).join('')}</tbody></table></div></section>`;
    }).join('');
  }

  /* ---------------- view: overview ---------------- */
  function viewOverview() {
    const tasks = D().tasks;
    const open = tasks.filter((t) => !isDone(t));
    const late = open.filter((t) => t.parts.some((p) => p.deadline && daysUntil(p.deadline) < 0));
    const week = [];
    open.forEach((t) => t.parts.forEach((p) => { const d = daysUntil(p.deadline); if (d !== null && d >= 0 && d <= 7) week.push({ t, p, d }); }));
    week.sort((a, b) => a.d - b.d);

    const kpi = (label, val, cls = '') => `<div class="kpi ${cls}"><div class="kpi-val">${val}</div><div class="kpi-label">${label}</div></div>`;
    const banCards = D().bans.map((b) => {
      const bt = tasks.filter((t) => t.ban === b.name);
      const counts = {};
      bt.forEach((t) => { const s = t.status || '(Trống)'; counts[s] = (counts[s] || 0) + 1; });
      const bl = bt.filter((t) => !isDone(t) && t.parts.some((p) => p.deadline && daysUntil(p.deadline) < 0)).length;
      const unassigned = bt.filter((t) => !isDone(t) && t.parts.some((p) => !p.people.length)).length;
      const total = bt.length || 1;
      const order = [...D().statuses, '(Trống)'];
      return `<div class="card"><h3>${esc(b.name)}</h3>
        <div class="stack">${order.filter((s) => counts[s]).map((s) => `<div class="seg s-${nkey(s === '(Trống)' ? 'trong' : s).replace(/ /g, '-')}" style="width:${(counts[s] / total) * 100}%" title="${esc(s)}: ${counts[s]}"></div>`).join('')}</div>
        <div class="legend">${order.filter((s) => counts[s]).map((s) => `<span><i class="dot s-${nkey(s === '(Trống)' ? 'trong' : s).replace(/ /g, '-')}"></i>${esc(s)} <b>${counts[s]}</b></span>`).join('')}</div>
        <p class="small">${bl ? `<span class="badge danger">${bl} việc quá hạn</span>` : '<span class="badge ok">Không có việc quá hạn</span>'}
        ${unassigned ? ` <span class="badge warn">${unassigned} việc chưa giao người</span>` : ''}</p></div>`;
    }).join('');

    const load = {};
    D().members.forEach((m) => { load[nkey(m.name)] = { name: m.name, bans: m.bans, open: 0, late: 0, next: null }; });
    open.forEach((t) => t.parts.forEach((p) => p.people.forEach((n) => {
      const k = nkey(n);
      const L = load[k] || (load[k] = { name: n, bans: [], open: 0, late: 0, next: null, unknown: true });
      L.open++;
      const d = daysUntil(p.deadline);
      if (d !== null && d < 0) L.late++;
      if (d !== null && d >= 0 && (L.next === null || d < L.next.d)) L.next = { d, iso: p.deadline };
    })));
    const rows = Object.values(load).sort((a, b) => b.late - a.late || b.open - a.open || a.name.localeCompare(b.name, 'vi'));
    const maxOpen = Math.max(1, ...rows.map((r) => r.open));

    return `<div class="page-head"><h2>Tổng quan</h2></div>
      <div class="kpis">${kpi('Việc chưa hoàn thành', open.length)}${kpi('Đang quá hạn', late.length, late.length ? 'danger' : '')}${kpi('Đến hạn trong 7 ngày', week.length, 'warn')}${kpi('Đã hoàn thành', tasks.length - open.length, 'ok')}</div>
      <div class="grid2">${banCards}</div>
      <div class="grid2">
        <div class="card"><h3>📅 Đến hạn trong 7 ngày tới</h3>${week.length ? `<table class="mini"><tbody>${week.map(({ t, p }) => `<tr>
          <td><b>${esc(t.name)}</b><div class="muted small">${esc(t.event)} · ${esc(t.ban)}${banOf(t.ban).roles.length > 1 ? ' · ' + esc(roleLabel(t.ban, p.role)) : ''}</div></td>
          <td>${p.people.length ? p.people.map(chip).join('') : '<span class="chip empty">Chưa giao</span>'}</td><td>${deadlineBadge(p.deadline, false)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Không có.</p>'}</div>
        <div class="card"><h3>👥 Khối lượng theo thành viên</h3><table class="mini"><thead><tr><th>Thành viên</th><th>Đang làm</th><th>Quá hạn</th><th>Hạn gần nhất</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td>${esc(r.name)}${r.unknown ? ' <span class="badge warn" title="Tên này không có trong tab Danh sách thành viên nên sẽ không nhận được email nhắc">không khớp danh sách</span>' : ''}<div class="muted small">${esc(r.bans.join(', '))}</div></td>
            <td><div class="bar"><div style="width:${(r.open / maxOpen) * 100}%"></div><span>${r.open}</span></div></td>
            <td>${r.late ? `<span class="badge danger">${r.late}</span>` : '—'}</td>
            <td>${r.next ? deadlineBadge(r.next.iso, false) : '—'}</td></tr>`).join('')}</tbody></table></div>
      </div>`;
  }

  /* ---------------- view: confirmations ---------------- */
  const CONFIRM_LABEL = {
    tin_cay: ['🟢', 'Đã trả lời / tạo bộ lọc', 'ok'],
    da_bam: ['🟡', 'Đã bấm link, chưa trả lời', 'warn'],
    da_gui: ['🔴', 'Chưa phản hồi', 'danger'],
    chua_gui: ['⚪', 'Chưa gửi email', 'muted'],
  };
  async function loadConfirms() {
    await run(async () => {
      state.confirms = await api('confirmations');
      if (state.view === 'confirm') $('#main').innerHTML = viewConfirm();
    });
  }
  function viewConfirm() {
    const list = state.confirms || [];
    const count = (s) => list.filter((x) => x.status === s).length;
    const order = { da_gui: 0, chua_gui: 1, da_bam: 2, tin_cay: 3 };
    const sorted = [...list].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name, 'vi'));
    return `<div class="page-head row"><div><h2>Xác nhận email chống spam</h2>
        <p class="muted">Email gửi từ <b>${esc(D().senderEmail)}</b>. Hệ thống tự kiểm tra email trả lời và tự gửi lại cho người chưa phản hồi mỗi sáng (tối đa 3 lần).</p></div>
        <div class="actions"><button class="btn" data-act="confirm-reload">⟳ Tải lại</button>
        ${count('chua_gui') ? `<button class="btn primary" data-act="send-welcome">📧 Gửi email xác nhận cho ${count('chua_gui')} người chưa nhận</button>` : ''}</div></div>
      <div class="kpis">${Object.keys(CONFIRM_LABEL).map((k) => `<div class="kpi ${CONFIRM_LABEL[k][2]}"><div class="kpi-val">${count(k)}</div><div class="kpi-label">${CONFIRM_LABEL[k][0]} ${CONFIRM_LABEL[k][1]}</div></div>`).join('')}</div>
      <div class="card"><div class="table-wrap"><table class="mini"><thead><tr><th>Thành viên</th><th>Email</th><th>Trạng thái</th><th>Số lần gửi</th></tr></thead><tbody>
        ${sorted.map((x) => `<tr><td>${esc(x.name)}<div class="muted small">${esc(x.bans.join(', '))}</div></td><td class="small">${esc(x.email || '(chưa có email)')}</td>
          <td><span class="badge ${CONFIRM_LABEL[x.status][2]}">${CONFIRM_LABEL[x.status][0]} ${CONFIRM_LABEL[x.status][1]}</span></td><td>${x.sends}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted small">Người ở trạng thái 🔴 sau 3 lần gửi: hãy nhắn trực tiếp qua Zalo để họ kiểm tra mục Spam và bấm "Không phải thư rác".</p></div>`;
  }

  /* ---------------- modal: edit task ---------------- */
  function openModal(html, cls = '') {
    const dlg = $('#modal');
    dlg.className = cls;
    dlg.innerHTML = html;
    if (!dlg.open) dlg.showModal();
  }
  function closeModal() { const d = $('#modal'); if (d.open) d.close(); }

  function peopleEditor(name, list, ban, disabled) {
    const banMembers = D().members.filter((m) => m.bans.includes(ban)).map((m) => m.name);
    const others = D().members.filter((m) => !m.bans.includes(ban)).map((m) => m.name);
    return `<div class="people" data-people="${esc(name)}">
      <span class="chips">${list.map((n) => `<span class="chip ${memberKnown(n) ? '' : 'unknown'}" data-name="${esc(n)}">${esc(n)}${disabled ? '' : '<button type="button" data-act="chip-x" aria-label="Bỏ">×</button>'}</span>`).join('')}</span>
      ${disabled ? '' : `<select data-change="chip-add"><option value="">＋ Thêm người</option>
        <optgroup label="${esc(ban)}">${banMembers.map((n) => `<option>${esc(n)}</option>`).join('')}</optgroup>
        ${others.length ? `<optgroup label="Ban khác">${others.map((n) => `<option>${esc(n)}</option>`).join('')}</optgroup>` : ''}</select>`}
    </div>`;
  }

  function openTaskModal(t, banName) {
    const ban = banName || t.ban;
    const b = banOf(ban);
    const creating = !t;
    t = t || { ban, name: '', event: (state.filters[ban] || {}).event || '', lead: '', status: '', note: '', parts: b.roles.map((r) => ({ role: r.key, people: [], deadline: '' })), extras: {} };
    const full = creating || canFull(t);
    const editable = creating || canEdit(t);
    const dis = full ? '' : 'disabled';
    const events = [...new Set(D().tasks.filter((x) => x.ban === ban).map((x) => x.event).filter(Boolean))];
    openModal(`<form method="dialog" id="task-form">
      <header class="m-head"><h3>${creating ? 'Thêm công việc' : editable ? 'Sửa công việc' : 'Chi tiết công việc'}</h3><span class="muted small">${esc(ban)}</span>
        <button type="button" class="btn ghost small x" data-act="close">✕</button></header>
      <div class="m-body">
        ${!full && editable ? '<p class="hint">Bạn là người được giao việc: có thể cập nhật trạng thái, ghi chú và liên kết sản phẩm.</p>' : ''}
        <label>Tên công việc *<input name="name" required value="${esc(t.name)}" ${dis}></label>
        <label>Tên sự kiện<input name="event" list="events-dl" value="${esc(t.event)}" ${dis}><datalist id="events-dl">${events.map((e) => `<option value="${esc(e)}">`).join('')}</datalist></label>
        <div class="roles">${b.roles.map((r, i) => { const p = t.parts[i] || { people: [], deadline: '' }; return `<fieldset>
          <legend>${esc(r.label)}</legend>
          ${peopleEditor('role:' + r.key, p.people, ban, !full)}
          ${r.hasDeadline ? `<label class="inline">Deadline <input type="date" name="dl:${esc(r.key)}" value="${esc(p.deadline)}" ${dis}></label>` : ''}
        </fieldset>`; }).join('')}</div>
        ${b.hasLead ? `<div class="field"><span class="lbl">Lead CV</span>${peopleEditor('lead', peopleOfLead(t), ban, !full)}</div>` : ''}
        <label>Trạng thái<select name="status" ${editable ? '' : 'disabled'}>${['', ...D().statuses].map((s) => `<option value="${esc(s)}" ${s === t.status ? 'selected' : ''}>${esc(s || '—')}</option>`).join('')}</select></label>
        ${b.hasNote ? `<label>Ghi chú<textarea name="note" rows="3" ${editable ? '' : 'disabled'}>${esc(t.note)}</textarea></label>` : ''}
        ${b.extraFields.map((f) => { const v = t.extras[f] || { text: '', url: '' }; return `<label>${esc(f)}
          <input name="ex:${esc(f)}" value="${esc(v.url || v.text)}" placeholder="Dán link (https://…) hoặc ghi chú" ${editable ? '' : 'disabled'}>
          ${v.url ? `<a class="small" href="${esc(v.url)}" target="_blank" rel="noopener">Mở liên kết ↗</a>` : ''}</label>`; }).join('')}
      </div>
      <footer class="m-foot">
        ${!creating && canManage(ban) ? `<button type="button" class="btn danger-ghost" data-act="delete" data-id="${esc(t.id)}">Xóa</button>` : '<span></span>'}
        <div><button type="button" class="btn" data-act="close">${editable ? 'Hủy' : 'Đóng'}</button>
        ${editable ? `<button type="submit" class="btn primary" id="save-btn">${creating ? 'Thêm' : 'Lưu'}</button>` : ''}</div>
      </footer></form>`);
    const form = $('#task-form');
    form.addEventListener('submit', (ev) => { ev.preventDefault(); saveTaskFromForm(form, t, ban, creating, full); });
  }

  function chipsOf(form, name) {
    const box = form.querySelector(`[data-people="${CSS.escape(name)}"]`);
    return box ? $$('.chip', box).map((c) => c.dataset.name) : [];
  }

  async function saveTaskFromForm(form, t, ban, creating, full) {
    const b = banOf(ban);
    const fd = new FormData(form);
    const task = { status: fd.get('status') || '' };
    if (b.hasNote) task.note = fd.get('note') || '';
    task.extras = {};
    b.extraFields.forEach((f) => { task.extras[f] = (fd.get('ex:' + f) || '').trim(); });
    if (full) {
      task.name = (fd.get('name') || '').trim();
      task.event = (fd.get('event') || '').trim();
      if (!task.name) return toast('Hãy nhập tên công việc.', 'error');
      if (b.hasLead) task.lead = chipsOf(form, 'lead');
      task.parts = {};
      b.roles.forEach((r) => {
        task.parts[r.key] = { people: chipsOf(form, 'role:' + r.key) };
        if (r.hasDeadline) task.parts[r.key].deadline = fd.get('dl:' + r.key) || '';
      });
    }
    await run(async () => {
      const saved = await api('saveTask', { ban, row: creating ? null : t.row, expectName: creating ? null : t.name, task });
      const i = D().tasks.findIndex((x) => x.id === saved.id);
      if (i >= 0) D().tasks[i] = saved; else D().tasks.push(saved);
      closeModal();
      toast(creating ? 'Đã thêm công việc.' : 'Đã lưu.');
      renderMain();
    }, { busyEl: $('#save-btn') });
  }

  function openCloneModal(ban) {
    const events = [...new Set(D().tasks.filter((x) => x.ban === ban).map((x) => x.event).filter(Boolean))];
    if (!events.length) return toast('Ban này chưa có sự kiện nào để làm mẫu.', 'error');
    openModal(`<form id="clone-form">
      <header class="m-head"><h3>Tạo sự kiện mới từ mẫu</h3><button type="button" class="btn ghost small x" data-act="close">✕</button></header>
      <div class="m-body">
        <p class="hint">Sao chép toàn bộ danh sách công việc của một sự kiện cũ sang sự kiện mới. Deadline, trạng thái và liên kết sẽ để trống.</p>
        <label>Sự kiện mẫu<select name="from">${events.map((e) => `<option>${esc(e)}</option>`).join('')}</select></label>
        <label>Tên sự kiện mới *<input name="to" required placeholder="VD: CHUYỆN NGHỀ KIỂM TOÁN"></label>
        <label class="check"><input type="checkbox" name="keepPeople" checked> Giữ nguyên người phụ trách</label>
        <label class="check"><input type="checkbox" name="keepNotes" checked> Giữ nguyên ghi chú</label>
      </div>
      <footer class="m-foot"><span></span><div><button type="button" class="btn" data-act="close">Hủy</button><button class="btn primary" id="clone-btn">Tạo sự kiện</button></div></footer></form>`);
    $('#clone-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const to = (fd.get('to') || '').trim();
      if (!to) return;
      await run(async () => {
        const r = await api('cloneEvent', { ban, fromEvent: fd.get('from'), toEvent: to, keepPeople: !!fd.get('keepPeople'), keepNotes: !!fd.get('keepNotes') });
        closeModal();
        toast(`Đã tạo ${r.created} công việc cho "${to}".`);
        state.filters[ban] = Object.assign(state.filters[ban] || {}, { event: to, status: '' });
        await loadData();
      }, { busyEl: $('#clone-btn') });
    });
  }

  /* ---------------- anti-spam ---------------- */
  function openAntispam() {
    const sender = D().senderEmail;
    const ok = me().confirm === 'tin_cay';
    openModal(`<div>
      <header class="m-head"><h3>🛡️ Chống email nhắc việc vào Spam</h3><button type="button" class="btn ghost small x" data-act="close">✕</button></header>
      <div class="m-body">
        ${ok ? '<p class="alert ok">✅ Bạn đã hoàn tất. Email nhắc việc sẽ vào hộp thư chính.</p>' : ''}
        <p>Email nhắc việc được gửi từ <b>${esc(sender)}</b>.</p>
        <h4>Cách 1 – Tự động (khuyên dùng)</h4>
        <p class="small">Website xin quyền tạm thời để tạo <b>một bộ lọc</b> trong Gmail của bạn: "Thư từ ${esc(sender)} → Không bao giờ chuyển vào Spam". Quyền được thu hồi ngay sau khi tạo xong, website không đọc thư của bạn.</p>
        <button class="btn primary" data-act="gmail-filter" id="gf-btn">Kết nối Gmail & tạo bộ lọc</button>
        <h4>Cách 2 – Thủ công</h4>
        <ol class="small">
          <li>Tìm email <b>"Xác nhận nhận email nhắc việc"</b> từ ${esc(sender)} (xem cả mục Spam) và <b>trả lời "OK"</b>.</li>
          <li>Hoặc mở <a href="https://mail.google.com/mail/u/0/#search/from%3A${encodeURIComponent(sender)}" target="_blank" rel="noopener">Gmail</a> → bấm biểu tượng tùy chọn ở ô tìm kiếm → <b>Tạo bộ lọc</b> → tích <b>"Không bao giờ gửi vào Thư rác"</b>.</li>
        </ol>
      </div></div>`);
  }

  async function createGmailFilter(btn) {
    const sender = D().senderEmail;
    if (DEMO) {
      await run(async () => { await api('markFilter'); me().confirm = 'tin_cay'; closeModal(); toast('(Demo) Đã tạo bộ lọc Gmail.'); render(); }, { busyEl: btn });
      return;
    }
    if (!(window.google && google.accounts && google.accounts.oauth2)) return toast('Chưa tải xong Google, thử lại sau vài giây.', 'error');
    btn.disabled = true;
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CFG.GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/gmail.settings.basic',
      hint: me().email,
      callback: async (resp) => {
        if (resp.error) { btn.disabled = false; return toast('Bạn chưa cấp quyền: ' + resp.error, 'error'); }
        const at = resp.access_token;
        const url = 'https://gmail.googleapis.com/gmail/v1/users/me/settings/filters';
        try {
          const list = await fetch(url, { headers: { Authorization: 'Bearer ' + at } }).then((r) => r.json());
          if (list.error) throw new Error(list.error.message);
          const exists = (list.filter || []).some((f) => f.criteria && String(f.criteria.from || '').toLowerCase().includes(sender.toLowerCase()) &&
            f.action && (f.action.removeLabelIds || []).includes('SPAM'));
          if (!exists) {
            const r = await fetch(url, {
              method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
              body: JSON.stringify({ criteria: { from: sender }, action: { removeLabelIds: ['SPAM'] } }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error((j.error && j.error.message) || 'Không tạo được bộ lọc');
          }
          google.accounts.oauth2.revoke(at, () => {});
          await api('markFilter');
          me().confirm = 'tin_cay';
          closeModal();
          toast('✅ Đã tạo bộ lọc! Email nhắc việc sẽ không vào Spam nữa.');
          render();
        } catch (e) {
          google.accounts.oauth2.revoke(at, () => {});
          toast('Lỗi: ' + e.message, 'error');
          btn.disabled = false;
        }
      },
      error_callback: (err) => { btn.disabled = false; toast('Đã hủy kết nối Gmail' + (err && err.type ? ' (' + err.type + ')' : ''), 'error'); },
    });
    client.requestAccessToken();
  }

  /* ---------------- events ---------------- */
  const findTask = (id) => D().tasks.find((t) => t.id === id);

  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'view') { state.view = el.dataset.view; store.set('view', state.view); render(); window.scrollTo(0, 0); }
    else if (act === 'demo-login') { state.demoEmail = $('#demo-user').value; store.set('demoEmail', state.demoEmail); loadData(); }
    else if (act === 'logout') logout();
    else if (act === 'reload') loadData();
    else if (act === 'edit') openTaskModal(findTask(el.dataset.id));
    else if (act === 'new') openTaskModal(null, el.dataset.ban);
    else if (act === 'clone') openCloneModal(el.dataset.ban);
    else if (act === 'close') closeModal();
    else if (act === 'chip-x') el.closest('.chip').remove();
    else if (act === 'antispam') openAntispam();
    else if (act === 'gmail-filter') createGmailFilter(el);
    else if (act === 'confirm-reload') loadConfirms();
    else if (act === 'send-welcome') {
      if (!confirm('Gửi email xác nhận cho tất cả thành viên chưa nhận?')) return;
      await run(async () => { const r = await api('sendWelcome'); toast(`Đã gửi ${r.sent} email.`); await loadConfirms(); }, { busyEl: el });
    } else if (act === 'delete') {
      const t = findTask(el.dataset.id);
      if (!confirm(`Xóa công việc "${t.name}"? Dòng này sẽ bị xóa khỏi Google Sheet.`)) return;
      await run(async () => { await api('deleteTask', { ban: t.ban, row: t.row, expectName: t.name }); closeModal(); toast('Đã xóa.'); await loadData(); }, { busyEl: el });
    }
  });

  document.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (el.dataset.change === 'status') {
      const t = findTask(el.dataset.id);
      const prev = t.status;
      el.disabled = true;
      await run(async () => {
        const saved = await api('saveTask', { ban: t.ban, row: t.row, expectName: t.name, task: { status: el.value } });
        Object.assign(t, saved);
        toast(el.value === D().doneStatus ? '🎉 Đã hoàn thành!' : 'Đã cập nhật trạng thái.');
        renderMain();
      });
      if (t.status === prev) { el.value = prev; el.disabled = false; }
    } else if (el.dataset.change === 'chip-add') {
      const name = el.value;
      if (!name) return;
      const box = el.closest('.people').querySelector('.chips');
      if (!$$('.chip', box).some((c) => c.dataset.name === name)) {
        box.insertAdjacentHTML('beforeend', `<span class="chip" data-name="${esc(name)}">${esc(name)}<button type="button" data-act="chip-x" aria-label="Bỏ">×</button></span>`);
      }
      el.value = '';
    } else if (el.dataset.filter && el.tagName === 'SELECT') {
      const ban = $('#ban-body').dataset.ban;
      state.filters[ban][el.dataset.filter] = el.value;
      renderBanBody();
    }
  });

  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.filter === 'q') {
      const ban = $('#ban-body').dataset.ban;
      state.filters[ban].q = el.value;
      renderBanBody();
    }
  });

  $('#modal').addEventListener('click', (ev) => { if (ev.target.id === 'modal') closeModal(); });

  /* ---------------- start ---------------- */
  if (DEMO) {
    state.demoEmail = store.get('demoEmail');
    if (state.demoEmail) loadData(); else renderLogin();
  } else {
    const t = store.get('idToken');
    if (t && jwtExp(t) > Date.now() + 60000) { state.token = t; loadData(); } else renderLogin();
  }
})();

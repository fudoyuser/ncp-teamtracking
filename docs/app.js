(() => {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const S = window.Store;

  /* ============================== helpers ============================== */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nkey = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* bỏ qua */ } },
  };
  const STATUS = { todo: 'Chưa bắt đầu', doing: 'Đang làm', done: 'Hoàn thành' };
  const pad = (n) => String(n).padStart(2, '0');
  const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayIso = () => localIso(new Date());
  const isoToDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const daysUntil = (iso) => {
    if (!iso) return null;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((isoToDate(iso) - now) / 86400000);
  };
  const fmtDate = (iso, full) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return full ? `${d}/${m}/${y}` : `${d}/${m}`; };
  const shortName = (n) => { const p = String(n).trim().split(/\s+/); return p.length > 2 ? p.slice(-2).join(' ') : n; };
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

  const state = {
    data: null, view: ss.get('view') || 'mine', adminTab: ss.get('adminTab') || 'accounts',
    filters: {}, dash: { ban: '', range: '90' }, acctQ: '',
  };

  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('hide'), 3500);
    setTimeout(() => el.remove(), 4000);
  }

  async function run(fn, btn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } catch (e) {
      if (['AUTH_EXPIRED', 'AUTH_REQUIRED', 'PGRST301'].includes(e.code)) { await S.signOut(); renderLogin('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'); return; }
      toast(e.message || String(e), 'error');
    } finally { if (btn) btn.disabled = false; }
  }

  /* ============================== dữ liệu dẫn xuất ============================== */
  const D = () => state.data;
  const me = () => D().members.find((m) => m.id === D().meId);
  const memberById = (id) => D().members.find((m) => m.id === id);
  const banById = (id) => D().bans.find((b) => b.id === id);
  const eventById = (id) => D().events.find((e) => e.id === id);
  const roleById = (ban, id) => ban.roles.find((r) => r.id === id);
  const mName = (id) => { const m = memberById(id); return m ? m.name : '(đã xóa)'; };
  const isDone = (t) => t.status === 'done';
  const isLeadOfBan = (banId) => me().bans.some((b) => b.banId === banId && b.isLead);
  const canManageBan = (banId) => me().isAdmin || isLeadOfBan(banId);
  const canCreateEvent = () => me().isAdmin || me().bans.some((b) => b.isLead);
  const isTaskLead = (t) => t.leadIds.includes(me().id);
  const isAssignee = (t) => t.parts.some((p) => p.assigneeIds.includes(me().id));
  const canFull = (t) => canManageBan(t.banId) || isTaskLead(t);
  const canEdit = (t) => canFull(t) || isAssignee(t);
  const partFor = (t, roleId) => t.parts.find((p) => p.roleId === roleId) || { roleId, deadline: '', assigneeIds: [] };
  const finalDeadline = (t) => t.parts.map((p) => p.deadline).filter(Boolean).sort().pop() || '';
  const isLate = (t) => !isDone(t) && t.parts.some((p) => p.deadline && daysUntil(p.deadline) < 0);
  const activeMembers = () => D().members.filter((m) => m.active);
  const confirmOf = (mid) => {
    const c = D().confirms[mid];
    if (!c) return 'chua_gui';
    if (c.filter || c.replied) return 'tin_cay';
    if (!c.sends) return 'chua_gui';
    return c.clicked ? 'da_bam' : 'da_gui';
  };
  const mailPaused = () => {
    const s = D().settings;
    return s.mail_paused === true && (!s.mail_paused_until || todayIso() <= s.mail_paused_until);
  };
  const pauseBanner = () => {
    if (!me().isAdmin || !mailPaused()) return '';
    const until = D().settings.mail_paused_until;
    return `<div class="banner warn-banner"><div><b>⏸ Đang tạm hoãn gửi mail tự động</b><br>
      <span class="small">${until ? `Đến hết ngày ${fmtDate(until, true)}, sau đó tự chạy lại.` : 'Đến khi admin bật lại.'} Nhắc việc, tổng hợp tuần và email xác nhận gửi lại đều tạm dừng.</span></div>
      <button class="btn primary small" data-act="resume-mail">▶ Bật lại ngay</button></div>`;
  };
  const eventsSorted = () => [...D().events].sort((a, b) => (b.date || '0').localeCompare(a.date || '0') || a.name.localeCompare(b.name, 'vi'));

  /* ============================== đăng nhập ============================== */
  function renderLogin(message) {
    $('#app').innerHTML = `
      <div class="login"><form class="login-card" id="login-form">
        <div class="logo">📋</div>
        <h1>${esc(CFG.CLUB_NAME || 'TeamTracking')}</h1>
        <p class="muted">Bảng phân công công việc (PCCV)</p>
        ${message ? `<p class="alert">${esc(message)}</p>` : ''}
        ${S.demo ? `
          <p class="demo-note">Đang chạy <b>chế độ demo</b> với dữ liệu mẫu (tên giả). Chọn một người để đăng nhập thử:</p>
          <select name="demo">${S.demoUsers.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}${m.isAdmin ? ' – Admin' : m.bans.some((b) => b.isLead) ? ' – Trưởng ban' : ''}</option>`).join('')}</select>`
        : `
          <label>Email<input name="email" type="email" autocomplete="username" required></label>
          <label>Mật khẩu<input name="password" type="password" autocomplete="current-password" required></label>`}
        <button class="btn primary block" id="login-btn">Đăng nhập</button>
        ${S.demo ? '' : '<p class="muted small">Chưa có tài khoản hoặc quên mật khẩu? Nhắn admin để được cấp / đặt lại.</p>'}
      </form></div>`;
    $('#login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      await run(async () => {
        if (S.demo) await S.signIn(fd.get('demo'));
        else await S.signIn(fd.get('email'), fd.get('password'));
        await loadData();
      }, $('#login-btn'));
    });
  }

  function renderForceChange() {
    $('#app').innerHTML = `<div class="login"><form class="login-card" id="pw-form">
      <div class="logo">🔑</div><h1>Đổi mật khẩu</h1>
      <p class="muted">Chào ${esc(me().name)}! Đây là lần đầu bạn đăng nhập (hoặc admin vừa đặt lại mật khẩu). Hãy đặt mật khẩu mới của riêng bạn.</p>
      ${pwFields()}
      <button class="btn primary block" id="pw-btn">Lưu mật khẩu mới</button>
      <button type="button" class="btn ghost block" data-act="logout">Đăng xuất</button></form></div>`;
    bindPwForm($('#pw-form'), async () => { me().mustChange = false; render(); });
  }
  const pwFields = () => `<label>Mật khẩu mới<input name="pw1" type="password" minlength="8" autocomplete="new-password" required></label>
    <label>Nhập lại mật khẩu mới<input name="pw2" type="password" minlength="8" autocomplete="new-password" required></label>
    <p class="muted small">Ít nhất 8 ký tự.</p>`;
  function bindPwForm(form, done) {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      if (fd.get('pw1') !== fd.get('pw2')) return toast('Hai mật khẩu không khớp.', 'error');
      await run(async () => { await S.changePassword(fd.get('pw1')); toast('Đã đổi mật khẩu.'); await done(); }, form.querySelector('.btn.primary'));
    });
  }

  async function loadData() {
    $('#app').innerHTML = '<div class="loading"><div class="spinner"></div><p>Đang tải dữ liệu…</p></div>';
    try {
      state.data = await S.loadAll();
      if (!viewList().some((v) => v.id === state.view)) state.view = 'mine';
      const pend = ss.get('seedImport');
      if (pend) { try { if (JSON.parse(decodeURIComponent(escape(atob(pend)))).kind !== 'profile') state.view = 'seeding'; } catch (e) { /* bỏ qua */ } }
      render();
      if (pend) {
        try { sessionStorage.removeItem('seedImport'); } catch (e) { /* bỏ qua */ }
        try { openSeedImport(JSON.parse(decodeURIComponent(escape(atob(pend))))); } catch (e) { toast('Dữ liệu từ Facebook không đọc được.', 'error'); }
      }
    } catch (e) {
      if (e.code === 'NOT_MEMBER') { await S.signOut(); return renderLogin(e.message); }
      $('#app').innerHTML = `<div class="loading"><p class="alert">${esc(e.message)}</p>
        <div><button class="btn" data-act="reload">Thử lại</button> <button class="btn ghost" data-act="logout">Đăng xuất</button></div></div>`;
    }
  }

  /* ============================== khung trang ============================== */
  function viewList() {
    const v = [{ id: 'mine', label: '🙋 Việc của tôi' }, { id: 'seeding', label: '📣 Seeding' }];
    [...D().bans].sort((a, b) => a.sort - b.sort).forEach((b) => v.push({ id: 'ban:' + b.id, label: b.name }));
    if (me().isAdmin) { v.push({ id: 'dash', label: '📊 Dashboard' }); v.push({ id: 'admin', label: '⚙️ Quản trị' }); }
    return v;
  }

  function render() {
    if (me().mustChange && !S.demo) return renderForceChange();
    const m = me();
    const role = m.isAdmin ? 'Admin' : m.bans.some((b) => b.isLead) ? 'Trưởng ban' : 'Thành viên';
    $('#app').innerHTML = `
      <header class="topbar">
        <div class="brand">📋 <span>${esc(CFG.CLUB_NAME || 'TeamTracking')}</span>${S.demo ? '<em class="demo-tag">DEMO</em>' : ''}</div>
        <div class="user">
          <button class="btn ghost small" data-act="antispam">${confirmOf(m.id) === 'tin_cay' ? '🛡️ Đã chống spam' : '🛡️ Chống spam'}</button>
          <button class="btn ghost small" data-act="change-pw">🔑 Đổi mật khẩu</button>
          <span class="who" title="${esc(m.email)}">${esc(m.name)} · ${role}</span>
          <button class="btn ghost small" data-act="reload" title="Tải lại dữ liệu" aria-label="Tải lại">⟳</button>
          <button class="btn ghost small" data-act="logout">Đăng xuất</button>
        </div>
      </header>
      <nav class="tabs">${viewList().map((v) => `<button class="tab ${v.id === state.view ? 'active' : ''}" data-act="view" data-view="${esc(v.id)}">${esc(v.label)}</button>`).join('')}</nav>
      <main id="main"></main>`;
    renderMain();
  }

  function renderMain() {
    const v = state.view;
    const main = $('#main');
    if (v === 'mine') main.innerHTML = viewMine();
    else if (v === 'seeding') main.innerHTML = viewSeeding();
    else if (v.startsWith('ban:')) { main.innerHTML = viewBanShell(v.slice(4)); renderBanBody(); }
    else if (v === 'dash') main.innerHTML = viewDash();
    else if (v === 'admin') main.innerHTML = viewAdmin();
  }

  /* ============================== mảnh giao diện dùng chung ============================== */
  function deadlineBadge(iso, done) {
    if (!iso) return '<span class="badge muted">Chưa có hạn</span>';
    const d = daysUntil(iso);
    if (done) return `<span class="badge muted">${fmtDate(iso)}</span>`;
    if (d < 0) return `<span class="badge danger">Quá hạn ${-d} ngày · ${fmtDate(iso)}</span>`;
    if (d === 0) return '<span class="badge warn">Hôm nay</span>';
    if (d === 1) return `<span class="badge warn">Ngày mai · ${fmtDate(iso)}</span>`;
    if (d <= 3) return `<span class="badge warn">Còn ${d} ngày · ${fmtDate(iso)}</span>`;
    return `<span class="badge">${fmtDate(iso)}</span>`;
  }
  function statusControl(t) {
    if (!canEdit(t)) return `<span class="status s-${t.status}">${STATUS[t.status]}</span>`;
    return `<select class="status-select s-${t.status}" data-change="status" data-id="${esc(t.id)}" aria-label="Trạng thái">
      ${Object.keys(STATUS).map((k) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${STATUS[k]}</option>`).join('')}</select>`;
  }
  function chip(id) {
    const m = memberById(id);
    const mine = id === me().id;
    return `<span class="chip ${mine ? 'me' : ''} ${m && m.active ? '' : 'unknown'}" title="${esc(m ? m.name : 'Không rõ')}">${esc(shortName(m ? m.name : '?'))}</span>`;
  }
  const linksOf = (t) => t.links.filter((l) => l.url).map((l) => `<a class="link" href="${esc(l.url)}" target="_blank" rel="noopener">🔗 ${esc(l.label || 'Link')}</a>`).join(' ');
  const eventLabel = (id) => { const e = eventById(id); return e ? e.name : 'Không thuộc sự kiện'; };

  /* ============================== Việc của tôi ============================== */
  function viewMine() {
    const myId = me().id;
    const items = [];
    D().tasks.forEach((t) => t.parts.forEach((p) => { if (p.assigneeIds.includes(myId)) items.push({ t, p, d: daysUntil(p.deadline) }); }));
    const open = items.filter((x) => !isDone(x.t));
    const groups = [
      ['🔴 Quá hạn', (x) => x.d !== null && x.d < 0],
      ['🟠 Hôm nay & ngày mai', (x) => x.d !== null && x.d >= 0 && x.d <= 1],
      ['🟡 Trong 7 ngày tới', (x) => x.d !== null && x.d > 1 && x.d <= 7],
      ['🔵 Sắp tới', (x) => x.d !== null && x.d > 7],
      ['⚪ Chưa có deadline', (x) => x.d === null],
    ].map(([title, f]) => ({ title, list: open.filter(f).sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9)) }));
    const leading = D().tasks.filter((t) => isTaskLead(t) && !isDone(t));

    const card = ({ t, p }) => {
      const ban = banById(t.banId);
      const role = ban && roleById(ban, p.roleId);
      return `<div class="card task-card">
        <div class="tc-main">
          <div class="tc-title">${esc(t.name)}</div>
          <div class="tc-meta">${esc(eventLabel(t.eventId))} · ${esc(ban ? ban.name : '')}${ban && ban.roles.length > 1 && role ? ' · <b>' + esc(role.label) + '</b>' : ''}</div>
          ${t.note ? `<div class="tc-note">${esc(t.note)}</div>` : ''}
          <div class="tc-links">${linksOf(t)}</div>
        </div>
        <div class="tc-side">${deadlineBadge(p.deadline, false)}${statusControl(t)}
          <button class="btn ghost small" data-act="edit" data-id="${esc(t.id)}">Chi tiết</button></div></div>`;
    };
    let html = antispamBanner();
    html += `<div class="page-head"><h2>Việc của tôi</h2><p class="muted">${open.length} việc chưa xong · ${items.length - open.length} đã hoàn thành</p></div>`;
    if (!items.length) html += '<div class="empty">Bạn chưa được giao việc nào. 🎉</div>';
    groups.forEach((g) => { if (g.list.length) html += `<section class="group"><h3>${g.title} <span class="count">${g.list.length}</span></h3>${g.list.map(card).join('')}</section>`; });
    if (leading.length) {
      html += `<section class="group"><h3>⭐ Việc tôi làm Lead <span class="count">${leading.length}</span></h3><div class="card"><div class="table-wrap"><table class="mini"><tbody>
        ${leading.map((t) => `<tr><td><b>${esc(t.name)}</b><div class="muted small">${esc(eventLabel(t.eventId))} · ${esc(banById(t.banId).name)}</div></td>
          <td>${t.parts.map((p) => p.assigneeIds.map(chip).join('') + ' ' + (p.deadline ? deadlineBadge(p.deadline, false) : '')).join('<br>')}</td>
          <td>${statusControl(t)}</td><td><button class="btn ghost small" data-act="edit" data-id="${esc(t.id)}">Sửa</button></td></tr>`).join('')}
        </tbody></table></div></div></section>`;
    }
    return html;
  }

  function antispamBanner() {
    if (confirmOf(me().id) === 'tin_cay') return '';
    return `<div class="banner"><div><b>🛡️ Để email nhắc việc không rơi vào Spam</b><br>
      <span class="small">Trả lời "OK" email tài khoản từ <b>${esc(D().settings.sender_email || 'hệ thống')}</b>${CFG.GOOGLE_CLIENT_ID || S.demo ? ', hoặc để website tự tạo bộ lọc Gmail' : ''}.</span></div>
      <button class="btn primary small" data-act="antispam">Làm ngay</button></div>`;
  }

  /* ============================== Trang Ban ============================== */
  function viewBanShell(banId) {
    const b = banById(banId);
    if (!b) return '<div class="empty">Không tìm thấy Ban.</div>';
    const f = state.filters[banId] || (state.filters[banId] = { event: '', status: 'open', person: '', q: '' });
    const evIds = [...new Set(D().tasks.filter((t) => t.banId === banId).map((t) => t.eventId || ''))];
    const evs = eventsSorted().filter((e) => evIds.includes(e.id));
    const people = activeMembers().filter((m) => m.bans.some((x) => x.banId === banId));
    return `<div class="page-head row">
        <div><h2>${esc(b.name)}</h2><p class="muted">${b.roles.length > 1 ? 'Vai trò: ' + b.roles.map((r) => esc(r.label)).join(' · ') : ''}</p></div>
        ${canManageBan(banId) ? `<div class="actions"><button class="btn" data-act="clone" data-ban="${esc(banId)}">⧉ Tạo sự kiện từ mẫu</button>
          <button class="btn primary" data-act="new" data-ban="${esc(banId)}">＋ Thêm công việc</button></div>` : ''}
      </div>
      <div class="filters">
        <select data-filter="event" aria-label="Sự kiện"><option value="">Tất cả sự kiện</option>
          ${evs.map((e) => `<option value="${esc(e.id)}" ${f.event === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
          ${evIds.includes('') ? `<option value="__none" ${f.event === '__none' ? 'selected' : ''}>(Không thuộc sự kiện)</option>` : ''}</select>
        <select data-filter="status" aria-label="Trạng thái">
          <option value="open" ${f.status === 'open' ? 'selected' : ''}>Chưa hoàn thành</option>
          <option value="" ${f.status === '' ? 'selected' : ''}>Tất cả trạng thái</option>
          ${Object.keys(STATUS).map((k) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${STATUS[k]}</option>`).join('')}
          <option value="late" ${f.status === 'late' ? 'selected' : ''}>Đang quá hạn</option></select>
        <select data-filter="person" aria-label="Người"><option value="">Mọi người</option>
          <option value="${esc(me().id)}" ${f.person === me().id ? 'selected' : ''}>Chỉ việc của tôi</option>
          ${people.map((m) => `<option value="${esc(m.id)}" ${f.person === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
        <input type="search" data-filter="q" placeholder="Tìm công việc, ghi chú…" value="${esc(f.q)}" aria-label="Tìm kiếm">
      </div>
      <div id="ban-body" data-ban="${esc(banId)}"></div>`;
  }

  function renderBanBody() {
    const body = $('#ban-body');
    if (!body) return;
    const banId = body.dataset.ban;
    const b = banById(banId);
    const f = state.filters[banId];
    const q = nkey(f.q);
    const all = D().tasks.filter((t) => t.banId === banId);
    const list = all.filter((t) => {
      if (f.event === '__none' ? t.eventId : f.event && t.eventId !== f.event) return false;
      if (f.status === 'open' && isDone(t)) return false;
      if (f.status === 'late' && !isLate(t)) return false;
      if (STATUS[f.status] && t.status !== f.status) return false;
      if (f.person && !t.parts.some((p) => p.assigneeIds.includes(f.person)) && !t.leadIds.includes(f.person)) return false;
      if (q && !nkey(t.name + ' ' + t.note).includes(q)) return false;
      return true;
    });
    if (!list.length) { body.innerHTML = '<div class="empty">Không có công việc nào khớp bộ lọc.</div>'; return; }
    const order = [...new Set(list.map((t) => t.eventId || ''))].sort((x, y) => {
      const a = eventById(x), c = eventById(y);
      return ((c && c.date) || '0').localeCompare((a && a.date) || '0');
    });
    body.innerHTML = order.map((evId) => {
      const ev = eventById(evId);
      const rows = list.filter((t) => (t.eventId || '') === evId);
      const evAll = all.filter((t) => (t.eventId || '') === evId);
      const done = evAll.filter(isDone).length;
      return `<section class="event">
        <div class="event-head"><h3>${esc(ev ? ev.name : '(Không thuộc sự kiện)')}</h3>${ev && ev.date ? `<span class="badge">📅 ${fmtDate(ev.date, true)}</span>` : ''}
          <div class="progress" role="img" aria-label="${done}/${evAll.length} việc hoàn thành"><div style="width:${pct(done, evAll.length) || 0}%"></div></div>
          <span class="muted small">${done}/${evAll.length} xong</span></div>
        <div class="table-wrap"><table class="tasks">
          <thead><tr><th>Công việc</th>${b.roles.map((r) => `<th>${esc(r.label)}</th>`).join('')}<th>Lead</th><th>Trạng thái</th><th>Liên kết</th><th></th></tr></thead>
          <tbody>${rows.map((t) => `<tr class="${isDone(t) ? 'done' : ''} ${isAssignee(t) ? 'mine' : ''}">
            <td class="c-name"><b>${esc(t.name)}</b>${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}</td>
            ${b.roles.map((r) => { const p = partFor(t, r.id); return `<td class="c-role">${p.assigneeIds.length ? p.assigneeIds.map(chip).join('') : '<span class="chip empty">Chưa giao</span>'}
              ${r.hasDeadline ? '<div>' + deadlineBadge(p.deadline, isDone(t)) + '</div>' : ''}</td>`; }).join('')}
            <td>${t.leadIds.map(chip).join('')}</td>
            <td>${statusControl(t)}</td>
            <td class="c-links">${linksOf(t)}</td>
            <td><button class="btn ghost small" data-act="edit" data-id="${esc(t.id)}">${canEdit(t) ? 'Sửa' : 'Xem'}</button></td>
          </tr>`).join('')}</tbody></table></div></section>`;
    }).join('');
  }

  /* ============================== Modal ============================== */
  function openModal(html) {
    const dlg = $('#modal');
    dlg.innerHTML = html;
    if (!dlg.open) dlg.showModal();
    const first = dlg.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea');
    if (first) first.focus();
  }
  const closeModal = () => { const d = $('#modal'); if (d.open) d.close(); };
  const modalHead = (title, sub) => `<header class="m-head"><h3>${title}</h3>${sub ? `<span class="muted small">${esc(sub)}</span>` : ''}
    <button type="button" class="btn ghost small x" data-act="close" aria-label="Đóng">✕</button></header>`;

  function peopleEditor(name, ids, banId, disabled) {
    const inBan = activeMembers().filter((m) => m.bans.some((x) => x.banId === banId));
    const others = activeMembers().filter((m) => !m.bans.some((x) => x.banId === banId));
    return `<div class="people" data-people="${esc(name)}">
      <span class="chips">${ids.map((id) => `<span class="chip" data-id="${esc(id)}">${esc(mName(id))}${disabled ? '' : '<button type="button" data-act="chip-x" aria-label="Bỏ">×</button>'}</span>`).join('')}</span>
      ${disabled ? '' : `<select data-change="chip-add" aria-label="Thêm người"><option value="">＋ Thêm người</option>
        <optgroup label="${esc(banById(banId).name)}">${inBan.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</optgroup>
        ${others.length ? `<optgroup label="Ban khác">${others.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</optgroup>` : ''}</select>`}</div>`;
  }
  const chipIds = (form, name) => { const box = form.querySelector(`[data-people="${CSS.escape(name)}"]`); return box ? $$('.chip', box).map((c) => c.dataset.id) : []; };

  function eventSelect(selected, disabled, withNew) {
    return `<select name="event" ${disabled ? 'disabled' : ''} data-change="event-select">
      <option value="">— Không thuộc sự kiện —</option>
      ${eventsSorted().map((e) => `<option value="${esc(e.id)}" ${e.id === selected ? 'selected' : ''}>${esc(e.name)}${e.date ? ' (' + fmtDate(e.date, true) + ')' : ''}</option>`).join('')}
      ${withNew ? '<option value="__new">＋ Tạo sự kiện mới…</option>' : ''}</select>
      <div class="new-event hidden"><input name="newEventName" placeholder="Tên sự kiện mới"><input name="newEventDate" type="date" aria-label="Ngày diễn ra"></div>`;
  }

  function openTaskModal(t, banId) {
    const creating = !t;
    const b = banById(creating ? banId : t.banId);
    if (creating) t = { banId: b.id, eventId: (state.filters[b.id] || {}).event || '', name: '', status: 'todo', note: '', leadIds: [], links: [], parts: [] };
    if (t.eventId === '__none') t.eventId = '';
    const full = creating || canFull(t);
    const editable = creating || canEdit(t);
    const dis = full ? '' : 'disabled';
    const links = t.links.length ? t.links : [{ label: '', url: '' }];
    openModal(`<form id="task-form">
      ${modalHead(creating ? 'Thêm công việc' : editable ? 'Sửa công việc' : 'Chi tiết công việc', b.name)}
      <div class="m-body">
        ${!full && editable ? '<p class="hint">Bạn được giao việc này: có thể cập nhật trạng thái, ghi chú và liên kết.</p>' : ''}
        <label>Tên công việc *<input name="name" required value="${esc(t.name)}" ${dis}></label>
        <label>Sự kiện ${eventSelect(t.eventId, !full, full && canCreateEvent())}</label>
        <div class="roles">${b.roles.map((r) => { const p = partFor(t, r.id); return `<fieldset><legend>${esc(r.label)}</legend>
          ${peopleEditor('role:' + r.id, p.assigneeIds, b.id, !full)}
          ${r.hasDeadline ? `<label class="inline">Deadline <input type="date" name="dl:${esc(r.id)}" value="${esc(p.deadline)}" ${dis}></label>` : ''}</fieldset>`; }).join('')}</div>
        <div class="field"><span class="lbl">Lead CV</span>${peopleEditor('lead', t.leadIds, b.id, !full)}</div>
        <label>Trạng thái<select name="status" ${editable ? '' : 'disabled'}>${Object.keys(STATUS).map((k) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${STATUS[k]}</option>`).join('')}</select></label>
        <label>Ghi chú<textarea name="note" rows="3" ${editable ? '' : 'disabled'}>${esc(t.note)}</textarea></label>
        <div class="field"><span class="lbl">Liên kết sản phẩm</span><div id="links">
          ${links.map((l) => linkRow(l, !editable)).join('')}</div>
          ${editable ? '<button type="button" class="btn ghost small" data-act="link-add">＋ Thêm liên kết</button>' : ''}</div>
      </div>
      <footer class="m-foot">
        ${!creating && canManageBan(t.banId) ? `<button type="button" class="btn danger-ghost" data-act="delete" data-id="${esc(t.id)}">Xóa</button>` : '<span></span>'}
        <div><button type="button" class="btn" data-act="close">${editable ? 'Hủy' : 'Đóng'}</button>
        ${editable ? `<button class="btn primary" id="save-btn">${creating ? 'Thêm' : 'Lưu'}</button>` : ''}</div>
      </footer></form>`);
    $('#task-form').addEventListener('submit', (ev) => { ev.preventDefault(); saveTaskForm(ev.target, t, b, creating, full); });
  }
  const linkRow = (l, disabled) => `<div class="link-row"><input name="linkLabel" placeholder="Tên (vd. Link design)" value="${esc(l.label)}" ${disabled ? 'disabled' : ''} aria-label="Tên liên kết">
    <input name="linkUrl" placeholder="https://…" value="${esc(l.url)}" ${disabled ? 'disabled' : ''} aria-label="Địa chỉ liên kết">
    ${disabled ? '' : '<button type="button" class="btn ghost small" data-act="link-x" aria-label="Xóa liên kết">✕</button>'}</div>`;

  async function saveTaskForm(form, t, b, creating, full) {
    const fd = new FormData(form);
    const labels = fd.getAll('linkLabel'), urls = fd.getAll('linkUrl');
    const links = urls.map((u, i) => ({ label: String(labels[i] || '').trim(), url: String(u || '').trim() })).filter((l) => l.url);
    if (links.some((l) => !/^https?:\/\//i.test(l.url))) return toast('Liên kết phải bắt đầu bằng http:// hoặc https://', 'error');
    const task = { id: t.id, banId: b.id, status: fd.get('status'), note: String(fd.get('note') || '').trim(), links };
    await run(async () => {
      if (full) {
        task.name = String(fd.get('name') || '').trim();
        if (!task.name) throw new Error('Hãy nhập tên công việc.');
        let ev = fd.get('event') || '';
        if (ev === '__new') {
          const name = String(fd.get('newEventName') || '').trim();
          if (!name) throw new Error('Hãy nhập tên sự kiện mới.');
          const created = await S.saveEvent({ name, date: fd.get('newEventDate') || '' });
          D().events.push(created);
          ev = created.id;
        }
        task.eventId = ev || null;
        task.leadIds = chipIds(form, 'lead');
        task.parts = b.roles.map((r) => ({ roleId: r.id, assigneeIds: chipIds(form, 'role:' + r.id), deadline: r.hasDeadline ? fd.get('dl:' + r.id) || '' : '' }));
      }
      const saved = await S.saveTask(task, full);
      const i = D().tasks.findIndex((x) => x.id === saved.id);
      if (i >= 0) D().tasks[i] = saved; else D().tasks.push(saved);
      closeModal();
      toast(creating ? 'Đã thêm công việc.' : 'Đã lưu.');
      renderMain();
    }, $('#save-btn'));
  }

  function openCloneModal(banId) {
    const evIds = [...new Set(D().tasks.filter((t) => t.banId === banId && t.eventId).map((t) => t.eventId))];
    const evs = eventsSorted().filter((e) => evIds.includes(e.id));
    if (!evs.length) return toast('Ban này chưa có sự kiện nào để làm mẫu.', 'error');
    openModal(`<form id="clone-form">${modalHead('Tạo sự kiện mới từ mẫu', banById(banId).name)}
      <div class="m-body">
        <p class="hint">Sao chép danh sách công việc của một sự kiện cũ sang sự kiện mới. Deadline, trạng thái và liên kết để trống.</p>
        <label>Sự kiện mẫu<select name="from">${evs.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></label>
        <label>Tên sự kiện mới *<input name="to" required placeholder="VD: CHUYỆN NGHỀ KIỂM TOÁN" list="ev-names"></label>
        <datalist id="ev-names">${D().events.map((e) => `<option value="${esc(e.name)}">`).join('')}</datalist>
        <label>Ngày diễn ra<input name="date" type="date"></label>
        <label class="check"><input type="checkbox" name="keepPeople" checked> Giữ nguyên người phụ trách</label>
        <label class="check"><input type="checkbox" name="keepNotes" checked> Giữ nguyên ghi chú</label>
      </div>
      <footer class="m-foot"><span></span><div><button type="button" class="btn" data-act="close">Hủy</button><button class="btn primary" id="clone-btn">Tạo sự kiện</button></div></footer></form>`);
    $('#clone-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      await run(async () => {
        const n = await S.cloneEvent(banId, fd.get('from'), String(fd.get('to')).trim(), fd.get('date'), !!fd.get('keepPeople'), !!fd.get('keepNotes'));
        closeModal();
        toast(`Đã tạo ${n} công việc.`);
        await loadData();
        const created = D().events.find((e) => e.name.toLowerCase() === String(fd.get('to')).trim().toLowerCase());
        state.filters[banId] = Object.assign(state.filters[banId] || {}, { event: created ? created.id : '', status: '' });
        renderMain();
      }, $('#clone-btn'));
    });
  }

  /* ============================== Seeding ============================== */
  const ACTIONS = { like: '👍 Like', comment: '💬 Comment', share: '🔁 Share' };
  const checkOf = (cid, mid, action) => D().checks.find((x) => x.campaignId === cid && x.memberId === mid && x.action === action);
  const actionDone = (cid, mid, action) => { const c = checkOf(cid, mid, action); return !!c && (c.verified === 'found' || (c.selfDone && c.verified !== 'not_found')); };
  const memberDone = (c, mid) => c.actions.every((a) => actionDone(c.id, mid, a));
  const canSeed = () => me().isAdmin || me().bans.some((b) => b.isLead);
  const fbLink = (m) => (m && m.fbUrl ? ` <a href="${esc(m.fbUrl)}" target="_blank" rel="noopener" title="Trang Facebook" class="fb-link">ⓕ</a>` : '');

  function viewSeeding() {
    const list = D().campaigns || [];
    const mine = list.filter((c) => c.memberIds.includes(me().id));
    const myOpen = mine.filter((c) => !memberDone(c, me().id));
    const myCard = (c) => `<div class="card seed-card">
      <div class="row-between"><div><div class="tc-title">${esc(c.title)}</div>
        <div class="tc-meta">${c.deadline ? deadlineBadge(c.deadline, memberDone(c, me().id)) : ''} ${c.postUrl ? `<a href="${esc(c.postUrl)}" target="_blank" rel="noopener">Mở bài viết ↗</a>` : ''}</div></div></div>
      <div class="seed-actions">${c.actions.map((a) => {
        const ch = checkOf(c.id, me().id, a) || {};
        const v = ch.verified === 'found' ? '<span class="badge ok">🟢 Đã thấy tên bạn</span>' : ch.verified === 'not_found' ? '<span class="badge danger">🔴 Chưa thấy tên bạn</span>' : '';
        return `<div class="seed-act"><label class="check"><input type="checkbox" data-change="seed-self" data-cid="${esc(c.id)}" data-action="${a}" ${ch.selfDone ? 'checked' : ''}> ${ACTIONS[a]}</label> ${v}
</div>`;
      }).join('')}</div></div>`;
    const allCard = (c) => {
      const done = c.memberIds.filter((mid) => memberDone(c, mid)).length;
      return `<div class="card seed-row"><div class="seed-row-main"><b>${esc(c.title)}</b>
        <div class="muted small">${c.actions.map((a) => ACTIONS[a]).join(' · ')}${c.deadline ? ' · hạn ' + fmtDate(c.deadline, true) : ''} · ${c.memberIds.length} người</div></div>
        <div class="bar ok seed-progress" data-tip="${done}/${c.memberIds.length} người đã hoàn thành"><div style="width:${pct(done, c.memberIds.length) || 0}%"></div><span>${done}/${c.memberIds.length}</span></div>
        <button class="btn small" data-act="seed-detail" data-id="${esc(c.id)}">Chi tiết</button></div>`;
    };
    return `<div class="page-head row"><div><h2>Seeding</h2><p class="muted">Like, comment, share bài fanpage. Tick khi bạn đã làm xong; trưởng ban đối chiếu với danh sách trên Facebook (share phải để chế độ <b>Công khai</b> mới hiện tên).</p></div>
        <div class="actions"><button class="btn" data-act="my-fb">ⓕ Facebook của tôi${me().fbName || me().fbUrl ? '' : ' (chưa điền)'}</button>
        ${canSeed() ? '<button class="btn primary" data-act="seed-new">＋ Tạo đợt seeding</button>' : ''}</div></div>
      ${!me().fbName && !me().fbUrl && mine.length ? '<div class="banner"><div><b>ⓕ Điền tên Facebook của bạn</b><br><span class="small">Nếu tên Facebook khác tên thật (vd. "Dương Phan", biệt danh…), hãy điền để hệ thống nhận ra bạn khi đối chiếu.</span></div><button class="btn primary small" data-act="my-fb">Điền ngay</button></div>' : ''}
      ${canSeed() && window.fbHelper ? `<details class="card bm-box"><summary><b>🔖 Nút "Gửi sang PCCV" – tự cuộn & lấy danh sách từ Facebook</b> <span class="muted small">(cài 1 lần, dùng trên Chrome máy tính)</span></summary>
        <ol class="small">
          <li>Bật thanh dấu trang: nhấn <b>Ctrl + Shift + B</b>.</li>
          <li><b>Kéo</b> nút này lên thanh dấu trang: <a class="btn primary small bm-link" href="${esc(bookmarkletHref())}" onclick="event.preventDefault();alert('Đừng bấm ở đây – hãy KÉO nút này lên thanh dấu trang, rồi bấm nó khi đang ở trên Facebook.');">📣 Gửi sang PCCV</a></li>
          <li>Trên Facebook: mở bài viết → bấm vào <b>số lượt cảm xúc</b> hoặc <b>số lượt chia sẻ</b> (để hiện khung danh sách). Với bình luận: chỉ cần mở bài viết.</li>
          <li>Bấm nút <b>📣 Gửi sang PCCV</b> trên thanh dấu trang → nút tự cuộn đến hết danh sách → bấm <b>"Mở PCCV để đối chiếu"</b>.</li>
        </ol>
        <p class="muted small">Nút chỉ đọc khung danh sách bạn đang mở và cuộn với tốc độ như người dùng; không tự mở bài viết khác. Facebook đổi giao diện thì nút có thể cần cập nhật – khi đó vẫn dùng cách copy & dán.</p></details>` : ''}
      <section class="group"><h3>🙋 Việc seeding của tôi <span class="count">${myOpen.length} chưa xong</span></h3>
        ${mine.length ? mine.map(myCard).join('') : '<div class="empty">Bạn chưa có đợt seeding nào.</div>'}</section>
      <section class="group"><h3>📋 Tất cả đợt seeding <span class="count">${list.length}</span></h3>
        ${list.length ? list.map(allCard).join('') : '<div class="empty">Chưa có đợt seeding nào.</div>'}</section>`;
  }

  function openSeedDetail(c) {
    const lead = canSeed();
    const rows = c.memberIds.map(memberById).filter(Boolean).sort((a, b) => Number(memberDone(c, a.id)) - Number(memberDone(c, b.id)) || a.name.localeCompare(b.name, 'vi'));
    const cell = (m, a) => {
      const ch = checkOf(c.id, m.id, a) || {};
      let s = ch.verified === 'found' ? '<span class="badge ok">🟢 Có tên</span>' : ch.verified === 'not_found' ? '<span class="badge danger">🔴 Chưa thấy</span>' : '';
      if (ch.selfDone) s += ' <span class="badge" title="Thành viên tự xác nhận">✅ Tự báo</span>';
      if (a === 'share' && ch.proofUrl) s += ` <a class="link" href="${esc(ch.proofUrl)}" target="_blank" rel="noopener">🔗 bằng chứng</a>`;
      return s || '<span class="muted small">—</span>';
    };
    const done = rows.filter((m) => memberDone(c, m.id)).length;
    openModal(`<div class="wide">${modalHead(esc(c.title), `${done}/${rows.length} người hoàn thành`)}
      <div class="m-body">
        <p class="small">${c.postUrl ? `<a href="${esc(c.postUrl)}" target="_blank" rel="noopener">Mở bài viết trên Facebook ↗</a> · ` : ''}${c.deadline ? 'Hạn ' + fmtDate(c.deadline, true) : 'Không có hạn'}</p>
        ${lead ? `<div class="hint"><b>Đối chiếu:</b> mở bài trên Facebook → bấm vào số lượt cảm xúc / bình luận / chia sẻ → bôi đen cả danh sách tên → copy → bấm nút bên dưới và dán vào.
          <div class="seed-verify-btns">${c.actions.map((a) => `<button class="btn small" data-act="seed-verify" data-id="${esc(c.id)}" data-action="${a}">📋 Đối chiếu ${ACTIONS[a]}</button>`).join('')}</div></div>` : ''}
        <div class="table-wrap"><table class="mini"><thead><tr><th>Thành viên</th>${c.actions.map((a) => `<th>${ACTIONS[a]}</th>`).join('')}<th></th></tr></thead><tbody>
          ${rows.map((m) => `<tr><td>${esc(m.name)}${fbLink(m)}${m.fbName ? `<div class="muted small">FB: ${esc(m.fbName)}</div>` : ''}</td>
            ${c.actions.map((a) => `<td>${cell(m, a)}</td>`).join('')}<td>${memberDone(c, m.id) ? '✔' : ''}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="muted small">"Hoàn thành" = có tên khi đối chiếu, hoặc tự báo đã làm mà chưa bị đối chiếu là "Chưa thấy".</p>
      </div>
      <footer class="m-foot">${lead ? `<div><button type="button" class="btn danger-ghost" data-act="seed-delete" data-id="${esc(c.id)}">Xóa đợt</button>
        <button type="button" class="btn ghost" data-act="seed-edit" data-id="${esc(c.id)}">Sửa</button></div>` : '<span></span>'}
        <button class="btn primary" data-act="close">Đóng</button></footer></div>`);
  }

  function openSeedForm(c) {
    const creating = !c;
    c = c || { title: '', postUrl: '', actions: ['like', 'comment', 'share'], deadline: '', memberIds: [] };
    const groups = D().bans.map((b) => ({ b, ms: activeMembers().filter((m) => m.bans.some((x) => x.banId === b.id)) }));
    const noBan = activeMembers().filter((m) => !m.bans.length);
    const box = (m) => `<label class="check small"><input type="checkbox" name="mem" value="${esc(m.id)}" ${c.memberIds.includes(m.id) ? 'checked' : ''}> ${esc(m.name)}</label>`;
    openModal(`<form id="seed-form">${modalHead(creating ? 'Tạo đợt seeding' : 'Sửa đợt seeding')}
      <div class="m-body">
        <label>Tên đợt *<input name="title" required value="${esc(c.title)}" placeholder="VD: Seeding bài mở đơn – Chuyện nghề Quản lý cửa hàng"></label>
        <label>Link bài viết trên fanpage<input name="postUrl" value="${esc(c.postUrl)}" placeholder="https://www.facebook.com/…"></label>
        <div class="field"><span class="lbl">Cần làm</span><div class="row-wrap">${Object.keys(ACTIONS).map((a) => `<label class="check"><input type="checkbox" name="act" value="${a}" ${c.actions.includes(a) ? 'checked' : ''}> ${ACTIONS[a]}</label>`).join('')}</div></div>
        <label>Hạn chót<input name="deadline" type="date" value="${esc(c.deadline)}"></label>
        <div class="field"><span class="lbl">Ai tham gia</span>
          <div class="row-wrap"><button type="button" class="btn ghost small" data-act="seed-all">Chọn tất cả</button><button type="button" class="btn ghost small" data-act="seed-none">Bỏ chọn</button></div>
          ${groups.map((g) => `<div class="mem-group"><div class="row-between"><b class="small">${esc(g.b.name)}</b><button type="button" class="btn ghost small" data-act="seed-ban" data-ban="${esc(g.b.id)}">Chọn cả Ban</button></div>
            <div class="mem-grid" data-ban-group="${esc(g.b.id)}">${g.ms.map(box).join('')}</div></div>`).join('')}
          ${noBan.length ? `<div class="mem-group"><b class="small">Chưa thuộc Ban</b><div class="mem-grid">${noBan.map(box).join('')}</div></div>` : ''}
        </div>
      </div>
      <footer class="m-foot"><span></span><div><button type="button" class="btn" data-act="close">Hủy</button><button class="btn primary" id="seed-btn">${creating ? 'Tạo' : 'Lưu'}</button></div></footer></form>`);
    $('#seed-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target, fd = new FormData(f);
      const actions = fd.getAll('act');
      const memberIds = [...new Set(fd.getAll('mem'))];
      if (!actions.length) return toast('Chọn ít nhất 1 việc cần làm.', 'error');
      if (!memberIds.length) return toast('Chọn ít nhất 1 người tham gia.', 'error');
      const url = String(fd.get('postUrl') || '').trim();
      if (url && !/^https?:\/\//i.test(url)) return toast('Link bài viết phải bắt đầu bằng https://', 'error');
      await run(async () => {
        const saved = await S.saveCampaign({ id: c.id, title: String(fd.get('title')).trim(), postUrl: url, actions, deadline: fd.get('deadline'), memberIds, createdBy: me().id });
        const i = D().campaigns.findIndex((x) => x.id === saved.id);
        if (i >= 0) D().campaigns[i] = saved; else D().campaigns.unshift(saved);
        closeModal(); toast(creating ? 'Đã tạo đợt seeding.' : 'Đã lưu.'); renderMain();
      }, $('#seed-btn'));
    });
  }

  /** So danh sách tên copy từ Facebook với người tham gia (không phân biệt dấu; ưu tiên "tên Facebook" nếu có). */
  /** Chuẩn hóa link trang cá nhân để so sánh. Link dạng /share/… không dùng để so được → trả về ''. */
  const normFb = (u) => {
    const s = String(u || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^(www|m|web|mbasic)\./, '');
    const id = s.match(/profile\.php\?(?:.*&)?id=(\d+)/);
    if (id) return 'facebook.com/profile.php?id=' + id[1];
    const seg = (s.split(/[?#]/)[0].split('/')[1] || '');
    if (!seg || /^(share|people|groups|pages|events|watch|reel|photo|story\.php|permalink\.php)$/.test(seg)) return '';
    return 'facebook.com/' + seg;
  };
  const isRealFbUrl = (u) => !!normFb(u);
  function matchNames(text, members, urls) {
    const lines = String(text).split(/[\n\r]+/).map((l) => nkey(l.replace(/[^\p{L}\p{N}\s]/gu, ' '))).filter(Boolean);
    const blob = ' ' + lines.join(' | ') + ' ';
    const urlSet = new Set((urls || []).map(normFb).filter(Boolean));
    return members.map((m) => {
      // Tên Facebook (thường ngắn: "Linh", "Mai Chi") phải khớp NGUYÊN DÒNG để tránh nhận nhầm người lạ trùng tên;
      // họ tên thật đủ 3 chữ trở lên thì cho phép khớp một phần dòng.
      const fb = nkey(m.fbName), full = nkey(m.name);
      const byUrl = m.fbUrl && urlSet.has(normFb(m.fbUrl));
      const byFb = fb && lines.includes(fb);
      const byName = full && (lines.includes(full) || (full.split(' ').length >= 3 && blob.includes(' ' + full + ' ')));
      return { m, found: !!(byUrl || byFb || byName) };
    });
  }

  function openSeedVerify(c, action, prefill) {
    const ms = c.memberIds.map(memberById).filter(Boolean);
    const urls = prefill ? prefill.names.map((x) => x.url) : [];
    openModal(`<form id="verify-form">${modalHead('Đối chiếu ' + ACTIONS[action], c.title)}
      <div class="m-body">
        <ol class="small"><li>Mở <a href="${esc(c.postUrl || '#')}" target="_blank" rel="noopener">bài viết</a> trên Facebook.</li>
          <li>Bấm vào <b>${action === 'like' ? 'số lượt cảm xúc' : action === 'comment' ? '"Xem thêm bình luận" cho đến hết' : 'số lượt chia sẻ'}</b>, cuộn xuống hết danh sách.</li>
          <li>Bôi đen toàn bộ danh sách (hoặc Ctrl+A trong khung đó) → Ctrl+C → dán vào ô dưới.</li></ol>
        ${prefill ? `<p class="alert ok small">📣 Đã nhận ${prefill.names.length} tên từ nút "Gửi sang PCCV".</p>` : ''}
        <textarea name="text" rows="8" placeholder="Dán danh sách tên vào đây…" required>${prefill ? esc(prefill.names.map((x) => x.name).join('\n')) : ''}</textarea>
        <div id="verify-preview"></div>
      </div>
      <footer class="m-foot"><span></span><div><button type="button" class="btn" data-act="close">Hủy</button><button class="btn primary" id="verify-btn">Lưu kết quả</button></div></footer></form>`);
    const f = $('#verify-form');
    const preview = () => {
      const res = matchNames(f.text.value, ms, urls);
      const found = res.filter((r) => r.found);
      $('#verify-preview').innerHTML = f.text.value.trim() ? `<p class="small"><b>🟢 Có tên: ${found.length}</b> · <b>🔴 Chưa thấy: ${res.length - found.length}</b></p>
        <div class="row-wrap">${res.map((r) => `<span class="chip ${r.found ? 'me' : 'unknown'}">${r.found ? '🟢' : '🔴'} ${esc(r.m.name)}</span>`).join('')}</div>` : '';
      return res;
    };
    f.text.addEventListener('input', preview);
    if (prefill) preview();
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const res = preview();
      await run(async () => {
        const saved = await S.verifyChecks(c.id, action, res.map((r) => ({ memberId: r.m.id, verified: r.found ? 'found' : 'not_found' })));
        saved.forEach((x) => {
          const i = D().checks.findIndex((y) => y.campaignId === x.campaignId && y.memberId === x.memberId && y.action === x.action);
          if (i >= 0) D().checks[i] = x; else D().checks.push(x);
        });
        toast(`Đã đối chiếu: ${res.filter((r) => r.found).length}/${res.length} có tên.`);
        renderMain(); openSeedDetail(c);
      }, $('#verify-btn'));
    });
  }

  const fbIds = (u) => (String(u || '').match(/\d{6,}|pfbid\w+/g) || []);
  function openSeedImport(p) {
    if (p.kind === 'profile') return openProfileImport(p);
    if (!canSeed()) return toast('Chỉ admin hoặc trưởng ban mới đối chiếu được seeding.', 'error');
    const list = D().campaigns || [];
    if (!list.length) return toast('Chưa có đợt seeding nào – hãy tạo đợt trước rồi bấm lại nút trên Facebook.', 'error');
    const ids = fbIds(p.post);
    const guess = list.find((c) => c.postUrl && (normFb(c.postUrl) === normFb(p.post) || fbIds(c.postUrl).some((x) => ids.includes(x)))) || list[0];
    const kindLabel = { like: 'cảm xúc', comment: 'bình luận', share: 'chia sẻ' }[p.kind] || p.kind;
    openModal(`<form id="imp-form">${modalHead('📣 Nhận danh sách từ Facebook')}
      <div class="m-body">
        <p class="small">Đã nhận <b>${p.names.length}</b> tên (danh sách <b>${esc(kindLabel)}</b>) từ <a href="${esc(p.post)}" target="_blank" rel="noopener">bài viết</a>.</p>
        <label>Đợt seeding<select name="cid">${list.map((c) => `<option value="${esc(c.id)}" ${c.id === guess.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></label>
        <label>Loại<select name="action">${Object.keys(ACTIONS).map((a) => `<option value="${a}" ${a === p.kind ? 'selected' : ''}>${ACTIONS[a]}</option>`).join('')}</select></label>
      </div>
      <footer class="m-foot"><span></span><div><button type="button" class="btn" data-act="close">Hủy</button><button class="btn primary">Tiếp tục đối chiếu</button></div></footer></form>`);
    $('#imp-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const c = list.find((x) => x.id === ev.target.cid.value);
      const action = ev.target.action.value;
      if (!c.actions.includes(action)) return toast('Đợt này không yêu cầu ' + ACTIONS[action] + '.', 'error');
      openSeedVerify(c, action, p);
    });
  }

  /* ---------- Cập nhật tên Facebook (admin) ---------- */
  const FB_TARGET = 'pccvFbTarget';
  function fbStatus(m) {
    if (!m.fbUrl) return '<span class="badge danger">Chưa có link</span>';
    if (!isRealFbUrl(m.fbUrl)) return '<span class="badge warn">Link chia sẻ – cần cập nhật</span>';
    return m.fbName ? '<span class="badge ok">✓ Đầy đủ</span>' : '<span class="badge warn">Thiếu tên Facebook</span>';
  }
  function openFbUpdateList() {
    const list = activeMembers().slice().sort((a, b) => Number(isRealFbUrl(a.fbUrl) && !!a.fbName) - Number(isRealFbUrl(b.fbUrl) && !!b.fbName) || a.name.localeCompare(b.name, 'vi'));
    const done = list.filter((m) => isRealFbUrl(m.fbUrl) && m.fbName).length;
    openModal(`<div class="wide">${modalHead('ⓕ Cập nhật tên Facebook', `${done}/${list.length} người đã đầy đủ`)}
      <div class="m-body">
        <ol class="small"><li>Bấm <b>Mở ↗</b> ở một người → trang Facebook của họ mở ở tab mới.</li>
          <li>Trên trang đó, bấm nút <b>📣 Gửi sang PCCV</b> trên thanh dấu trang → <b>Lưu tên này vào PCCV</b>.</li>
          <li>Tab PCCV hiện khung xác nhận (đã chọn sẵn đúng người) → <b>Lưu</b>. Làm tiếp người kế tiếp.</li></ol>
        <div class="table-wrap"><table class="mini"><thead><tr><th>Thành viên</th><th>Tên Facebook</th><th>Trạng thái</th><th></th></tr></thead><tbody>
        ${list.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.fbName || '—')}</td><td>${fbStatus(m)}</td>
          <td>${m.fbUrl ? `<a class="btn small" href="${esc(m.fbUrl)}" target="_blank" rel="noopener" data-fb-target="${esc(m.id)}">Mở ↗</a>` : ''}</td></tr>`).join('')}
        </tbody></table></div></div>
      <footer class="m-foot"><span></span><button class="btn primary" data-act="close">Đóng</button></footer></div>`);
  }
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-fb-target]');
    if (a) { try { localStorage.setItem(FB_TARGET, JSON.stringify({ id: a.dataset.fbTarget, t: Date.now() })); } catch (e) { /* bỏ qua */ } }
  }, true);

  function openProfileImport(p) {
    if (!me().isAdmin) return toast('Chỉ admin mới cập nhật được tên Facebook của thành viên.', 'error');
    let target = null;
    try { const t = JSON.parse(localStorage.getItem(FB_TARGET) || 'null'); if (t && Date.now() - t.t < 30 * 60000) target = t.id; } catch (e) { /* bỏ qua */ }
    const byUrl = activeMembers().find((m) => normFb(m.fbUrl) && normFb(m.fbUrl) === normFb(p.url));
    const byName = activeMembers().find((m) => nkey(m.fbName) === nkey(p.name) || nkey(m.name) === nkey(p.name));
    const pre = byUrl ? byUrl.id : target || (byName && byName.id) || '';
    const taken = activeMembers().find((m) => m.id !== pre && normFb(m.fbUrl) && normFb(m.fbUrl) === normFb(p.url));
    openModal(`<form id="prof-form">${modalHead('ⓕ Lưu Facebook cho thành viên')}
      <div class="m-body">
        <div class="pw-box"><div><span class="muted small">Tên trên Facebook</span><br><b>${esc(p.name)}</b></div>
          <div><span class="muted small">Link trang cá nhân</span><br><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></div></div>
        ${taken ? `<p class="alert small">⚠ Link này đang được gán cho <b>${esc(taken.name)}</b>. Kiểm tra lại trước khi lưu.</p>` : ''}
        <label>Thành viên<select name="mid" required><option value="">— Chọn thành viên —</option>
          ${activeMembers().slice().sort((a, b) => a.name.localeCompare(b.name, 'vi')).map((m) => `<option value="${esc(m.id)}" ${m.id === pre ? 'selected' : ''}>${esc(m.name)}${m.fbName ? ' (FB: ' + esc(m.fbName) + ')' : ''}</option>`).join('')}</select></label>
      </div>
      <footer class="m-foot"><span></span><div><button type="button" class="btn" data-act="close">Hủy</button><button class="btn primary" id="prof-btn">Lưu</button></div></footer></form>`);
    $('#prof-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const mid = ev.target.mid.value;
      await run(async () => {
        await S.setMemberFacebook(mid, p.name, p.url);
        Object.assign(memberById(mid), { fbName: p.name, fbUrl: p.url });
        try { localStorage.removeItem(FB_TARGET); } catch (e) { /* bỏ qua */ }
        toast(`Đã lưu Facebook cho ${memberById(mid).name}.`);
        renderMain(); openFbUpdateList();
      }, $('#prof-btn'));
    });
  }

  function bookmarkletHref() {
    const site = location.origin + location.pathname;
    return 'javascript:(' + encodeURIComponent(window.fbHelper.toString()) + ')(' + encodeURIComponent(JSON.stringify(site)) + ')';
  }

  function openMyFb() {
    const m = me();
    openModal(`<form id="fb-form">${modalHead('ⓕ Facebook của tôi')}
      <div class="m-body">
        <label>Tên hiển thị trên Facebook<input name="fbName" value="${esc(m.fbName)}" placeholder="${esc(m.name)}"></label>
        <p class="muted small">Chỉ cần điền nếu tên Facebook khác tên thật (vd. "Dương Phan", "Linh Chi Nguyễn", biệt danh). Hệ thống dùng tên này để đối chiếu seeding.</p>
        <label>Link trang Facebook cá nhân<input name="fbUrl" value="${esc(m.fbUrl)}" placeholder="https://www.facebook.com/ten-cua-ban"></label>
      </div>
      <footer class="m-foot"><span></span><div><button type="button" class="btn" data-act="close">Hủy</button><button class="btn primary" id="fb-btn">Lưu</button></div></footer></form>`);
    $('#fb-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const url = f.fbUrl.value.trim();
      if (url && !/^https?:\/\/(www\.|m\.|web\.)?(facebook\.com|fb\.com)\//i.test(url)) return toast('Link phải là trang Facebook (https://www.facebook.com/…)', 'error');
      await run(async () => { await S.setMyFacebook(f.fbName.value, url); Object.assign(me(), { fbName: f.fbName.value.trim(), fbUrl: url }); closeModal(); toast('Đã lưu.'); renderMain(); }, $('#fb-btn'));
    });
  }

  /* ============================== Dashboard ============================== */
  function viewDash() {
    const f = state.dash;
    const today = todayIso();
    const rangeStart = f.range === 'all' ? '' : localIso(new Date(Date.now() - Number(f.range) * 86400000));
    const tasks = D().tasks.filter((t) => !f.ban || t.banId === f.ban);
    const open = tasks.filter((t) => !isDone(t));
    const late = open.filter(isLate);
    const dueWeek = open.filter((t) => t.parts.some((p) => { const d = daysUntil(p.deadline); return d !== null && d >= 0 && d <= 7; }));
    const doneDate = (t) => (t.doneAt ? localIso(new Date(t.doneAt)) : '');
    const doneInRange = tasks.filter((t) => isDone(t) && t.doneAt && (!rangeStart || doneDate(t) >= rangeStart));
    const withDl = doneInRange.filter((t) => finalDeadline(t));
    const onTime = withDl.filter((t) => doneDate(t) <= finalDeadline(t));
    const onTimeRate = pct(onTime.length, withDl.length);

    const kpi = (label, val, sub, cls = '') => `<div class="kpi ${cls}"><div class="kpi-val">${val}</div><div class="kpi-label">${label}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
    const rangeText = { 30: '30 ngày qua', 90: '90 ngày qua', 180: '6 tháng qua', all: 'từ trước đến nay' }[f.range];

    // ----- biểu đồ hoàn thành theo tuần
    const weeks = [];
    const start = new Date(); start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // thứ Hai tuần này
    const nW = f.range === '30' ? 6 : f.range === '90' ? 13 : f.range === '180' ? 26 : 26;
    for (let i = nW - 1; i >= 0; i--) { const d = new Date(start); d.setDate(d.getDate() - 7 * i); weeks.push({ from: localIso(d), onTime: 0, late: 0, noDl: 0 }); }
    tasks.filter((t) => isDone(t) && t.doneAt).forEach((t) => {
      const dd = doneDate(t);
      for (let i = weeks.length - 1; i >= 0; i--) {
        if (dd >= weeks[i].from) {
          const fd = finalDeadline(t);
          if (i === weeks.length - 1 || dd < weeks[i + 1].from) {
            if (!fd) weeks[i].noDl++; else if (dd <= fd) weeks[i].onTime++; else weeks[i].late++;
          }
          break;
        }
      }
    });

    // ----- theo Ban
    const banRows = D().bans.filter((b) => !f.ban || b.id === f.ban).map((b) => {
      const bt = D().tasks.filter((t) => t.banId === b.id);
      const c = { todo: 0, doing: 0, done: 0 };
      bt.forEach((t) => { c[t.status]++; });
      const bd = bt.filter((t) => isDone(t) && t.doneAt && (!rangeStart || doneDate(t) >= rangeStart) && finalDeadline(t));
      const bo = bd.filter((t) => doneDate(t) <= finalDeadline(t));
      return { b, c, total: bt.length, late: bt.filter(isLate).length, rate: pct(bo.length, bd.length), unassigned: bt.filter((t) => !isDone(t) && t.parts.some((p) => !p.assigneeIds.length && (p.deadline || banById(t.banId).roles.length === 1))).length };
    });

    // ----- theo sự kiện
    const evRows = eventsSorted().map((e) => {
      const et = tasks.filter((t) => t.eventId === e.id);
      return { e, total: et.length, done: et.filter(isDone).length, late: et.filter(isLate).length, unassigned: et.filter((t) => !isDone(t) && t.parts.some((p) => !p.assigneeIds.length && p.deadline)).length };
    }).filter((r) => r.total).sort((a, b) => {
      const ua = a.e.date && a.e.date >= today, ub = b.e.date && b.e.date >= today;
      if (ua !== ub) return ua ? -1 : 1;
      return ua ? a.e.date.localeCompare(b.e.date) : (b.e.date || '').localeCompare(a.e.date || '');
    });

    // ----- theo thành viên (tính theo từng phần việc được giao)
    const mrows = {};
    activeMembers().filter((m) => !f.ban || m.bans.some((x) => x.banId === f.ban)).forEach((m) => { mrows[m.id] = { m, open: 0, late: 0, done: 0, withDl: 0, onTime: 0 }; });
    tasks.forEach((t) => t.parts.forEach((p) => p.assigneeIds.forEach((mid) => {
      const r = mrows[mid];
      if (!r) return;
      if (!isDone(t)) { r.open++; if (p.deadline && daysUntil(p.deadline) < 0) r.late++; return; }
      const dd = doneDate(t);
      if (!dd || (rangeStart && dd < rangeStart)) return;
      r.done++;
      if (p.deadline) { r.withDl++; if (dd <= p.deadline) r.onTime++; }
    })));
    const memberRows = Object.values(mrows).sort((a, b) => b.late - a.late || b.open - a.open || a.m.name.localeCompare(b.m.name, 'vi'));
    const maxOpen = Math.max(1, ...memberRows.map((r) => r.open));

    return `${pauseBanner()}<div class="page-head row"><div><h2>Dashboard</h2><p class="muted">Số liệu hoàn thành tính trong <b>${rangeText}</b>.</p></div></div>
      <div class="filters">
        <select data-dash="ban" aria-label="Ban"><option value="">Tất cả các Ban</option>${D().bans.map((b) => `<option value="${esc(b.id)}" ${f.ban === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
        <select data-dash="range" aria-label="Khoảng thời gian">${[['30', '30 ngày qua'], ['90', '90 ngày qua'], ['180', '6 tháng qua'], ['all', 'Toàn bộ']].map(([v, l]) => `<option value="${v}" ${f.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <div class="kpis">
        ${kpi('Việc đang mở', open.length, `${tasks.length} việc tổng cộng`)}
        ${kpi('Đang quá hạn', late.length, late.length ? '⚠ cần xử lý' : '✓ không có', late.length ? 'danger' : 'ok')}
        ${kpi('Đến hạn trong 7 ngày', dueWeek.length, '', dueWeek.length ? 'warn' : '')}
        ${kpi('Hoàn thành', doneInRange.length, rangeText)}
        ${kpi('Tỷ lệ đúng hạn', onTimeRate === null ? '—' : onTimeRate + '%', withDl.length ? `${onTime.length}/${withDl.length} việc có deadline` : 'chưa có dữ liệu', onTimeRate === null ? '' : onTimeRate >= 80 ? 'ok' : onTimeRate >= 60 ? 'warn' : 'danger')}
      </div>
      <div class="card"><div class="chart-head"><h3>Việc hoàn thành mỗi tuần</h3>
        <div class="legend"><span><i class="dot c-ontime"></i>Đúng hạn</span><span><i class="dot c-late"></i>Trễ hạn</span><span><i class="dot c-nodl"></i>Không có deadline</span></div></div>
        ${weeklyChart(weeks)}
        <details class="table-view"><summary>Xem dạng bảng</summary><table class="mini"><thead><tr><th>Tuần từ</th><th>Đúng hạn</th><th>Trễ hạn</th><th>Không có deadline</th></tr></thead>
          <tbody>${weeks.map((w) => `<tr><td>${fmtDate(w.from, true)}</td><td>${w.onTime}</td><td>${w.late}</td><td>${w.noDl}</td></tr>`).join('')}</tbody></table></details>
      </div>
      <div class="grid2">
        <div class="card"><h3>Theo Ban</h3>
          <div class="legend"><span><i class="dot s-done"></i>Hoàn thành</span><span><i class="dot s-doing"></i>Đang làm</span><span><i class="dot s-todo"></i>Chưa bắt đầu</span></div>
          ${banRows.map((r) => `<div class="ban-row"><div class="ban-row-head"><b>${esc(r.b.name)}</b><span class="muted small">${r.total} việc · đúng hạn ${r.rate === null ? '—' : r.rate + '%'}</span></div>
            <div class="stack">${['done', 'doing', 'todo'].filter((k) => r.c[k]).map((k) => `<div class="seg s-${k}" style="width:${(r.c[k] / Math.max(1, r.total)) * 100}%" data-tip="${esc(r.b.name)} – ${STATUS[k]}: ${r.c[k]} việc"></div>`).join('')}</div>
            <div class="small">${r.late ? `<span class="badge danger">⏰ ${r.late} quá hạn</span>` : '<span class="badge ok">✓ Không quá hạn</span>'} ${r.unassigned ? `<span class="badge warn">👤 ${r.unassigned} chưa giao người</span>` : ''}</div></div>`).join('') || '<p class="muted">Chưa có Ban.</p>'}
        </div>
        <div class="card"><h3>Tiến độ sự kiện</h3>${evRows.length ? `<div class="table-wrap"><table class="mini"><thead><tr><th>Sự kiện</th><th>Tiến độ</th><th></th></tr></thead><tbody>
          ${evRows.map((r) => `<tr><td><b>${esc(r.e.name)}</b><div class="muted small">${r.e.date ? '📅 ' + fmtDate(r.e.date, true) + (r.e.date >= today ? ` · còn ${daysUntil(r.e.date)} ngày` : ' · đã diễn ra') : 'Chưa có ngày'}</div></td>
            <td style="min-width:140px"><div class="bar ok" data-tip="${r.done}/${r.total} việc hoàn thành"><div style="width:${pct(r.done, r.total)}%"></div><span>${r.done}/${r.total}</span></div></td>
            <td>${r.late ? `<span class="badge danger">⏰ ${r.late}</span>` : ''} ${r.unassigned ? `<span class="badge warn" title="Việc có deadline nhưng chưa giao người">👤 ${r.unassigned}</span>` : ''}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="muted">Chưa có sự kiện.</p>'}</div>
      </div>
      <div class="card"><h3>Theo thành viên</h3><p class="muted small">Tính theo từng phần việc được giao. "Hoàn thành" và "Đúng hạn" tính trong ${rangeText}.</p>
        <div class="table-wrap"><table class="mini"><thead><tr><th>Thành viên</th><th>Đang làm</th><th>Quá hạn</th><th>Hoàn thành</th><th>Đúng hạn</th></tr></thead><tbody>
        ${memberRows.map((r) => { const rate = pct(r.onTime, r.withDl); return `<tr><td>${esc(r.m.name)}<div class="muted small">${esc(r.m.bans.map((x) => (banById(x.banId) || {}).name).filter(Boolean).join(', '))}</div></td>
          <td style="min-width:110px"><div class="bar" data-tip="${esc(r.m.name)}: ${r.open} việc đang mở"><div style="width:${(r.open / maxOpen) * 100}%"></div><span>${r.open}</span></div></td>
          <td>${r.late ? `<span class="badge danger">${r.late}</span>` : '—'}</td><td>${r.done}</td>
          <td>${rate === null ? '<span class="muted">—</span>' : `<span class="badge ${rate >= 80 ? 'ok' : rate >= 60 ? 'warn' : 'danger'}">${rate}%</span> <span class="muted small">${r.onTime}/${r.withDl}</span>`}</td></tr>`; }).join('')}
        </tbody></table></div></div>`;
  }

  function weeklyChart(weeks) {
    const main = $('#main');
    const W = Math.round(Math.max(300, Math.min(1240, (main ? main.clientWidth : 800) - 70)));
    const H = W < 500 ? 200 : 240, padL = 32, padB = 26, padT = 10;
    const max = Math.max(4, ...weeks.map((w) => w.onTime + w.late + w.noDl));
    const step = Math.ceil(max / 4);
    const top = step * 4;
    const plotH = H - padB - padT;
    const slot = (W - padL) / weeks.length;
    const bw = Math.min(28, slot * 0.6);
    const y = (v) => padT + plotH - (v / top) * plotH;
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = step * i;
      g += `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="${i ? 'grid' : 'axis'}"/><text x="${padL - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${v}</text>`;
    }
    weeks.forEach((w, i) => {
      const x = padL + slot * i + (slot - bw) / 2;
      let base = 0;
      const segs = [['onTime', 'c-ontime'], ['late', 'c-late'], ['noDl', 'c-nodl']].filter(([k]) => w[k]);
      segs.forEach(([k, cls], j) => {
        const h = (w[k] / top) * plotH;
        const yy = y(base + w[k]);
        const isTop = j === segs.length - 1;
        const gap = j > 0 ? 2 : 0;
        g += isTop
          ? `<path class="${cls}" d="M${x},${yy + h - gap} V${yy + 4} Q${x},${yy} ${x + 4},${yy} H${x + bw - 4} Q${x + bw},${yy} ${x + bw},${yy + 4} V${yy + h - gap} Z"/>`
          : `<rect class="${cls}" x="${x}" y="${yy}" width="${bw}" height="${Math.max(0, h - gap)}"/>`;
        base += w[k];
      });
      const total = w.onTime + w.late + w.noDl;
      g += `<rect class="hit" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${plotH}" data-tip="Tuần từ ${fmtDate(w.from, true)}: ${total} việc hoàn thành — ${w.onTime} đúng hạn, ${w.late} trễ hạn, ${w.noDl} không có deadline"/>`;
      const every = Math.ceil(weeks.length / Math.max(3, Math.floor((W - padL) / 48)));
      if (i % every === 0) {
        const cx = x + bw / 2;
        const anchor = cx + 18 > W ? 'end' : 'middle';
        g += `<text x="${anchor === 'end' ? W : cx}" y="${H - 8}" class="tick" text-anchor="${anchor}">${fmtDate(w.from)}</text>`;
      }
    });
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ số việc hoàn thành mỗi tuần">${g}</svg></div>`;
  }

  /* ============================== Quản trị ============================== */
  function viewAdmin() {
    const tabs = [['accounts', '👥 Tài khoản'], ['bans', '🗂️ Ban & vai trò'], ['events', '📅 Sự kiện'], ['settings', '⚙️ Cài đặt']];
    const t = state.adminTab;
    const body = t === 'bans' ? adminBans() : t === 'events' ? adminEvents() : t === 'settings' ? adminSettings() : adminAccounts();
    return `${pauseBanner()}<div class="subtabs">${tabs.map(([id, l]) => `<button class="subtab ${id === t ? 'active' : ''}" data-act="admin-tab" data-tab="${id}">${l}</button>`).join('')}</div>${body}`;
  }

  const CONFIRM = {
    tin_cay: ['🟢', 'Đã xác nhận', 'ok'], da_bam: ['🟡', 'Đã bấm link, chưa trả lời', 'warn'],
    da_gui: ['🔴', 'Chưa phản hồi', 'danger'], chua_gui: ['⚪', 'Chưa gửi', 'muted'],
  };

  function adminAccounts() {
    const q = nkey(state.acctQ);
    const list = D().members.filter((m) => !q || nkey(m.name + ' ' + m.email).includes(q))
      .sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'vi'));
    const unconfirmed = activeMembers().filter((m) => m.userId && confirmOf(m.id) !== 'tin_cay').length;
    const noLogin = activeMembers().filter((m) => !m.userId).length;
    const counts = {};
    activeMembers().filter((m) => m.userId).forEach((m) => { const s = confirmOf(m.id); counts[s] = (counts[s] || 0) + 1; });
    return `<div class="page-head row"><div><h2>Tài khoản</h2><p class="muted">${activeMembers().length} tài khoản đang hoạt động. Email gửi từ <b>${esc(D().settings.sender_email || '(chưa cài Apps Script)')}</b>.</p></div>
      <div class="actions"><button class="btn" data-act="fb-update">ⓕ Cập nhật tên Facebook</button>
        ${noLogin ? `<button class="btn" data-act="grant-all">🔑 Cấp đăng nhập cho ${noLogin} người chưa có</button>` : ''}
        ${unconfirmed ? `<button class="btn" data-act="resend-all">📧 Gửi lại email xác nhận (${unconfirmed})</button>` : ''}
        <button class="btn primary" data-act="new-account">＋ Cấp tài khoản</button></div></div>
      <div class="kpis small-kpis">${Object.keys(CONFIRM).map((k) => `<div class="kpi ${CONFIRM[k][2]}"><div class="kpi-val">${counts[k] || 0}</div><div class="kpi-label">${CONFIRM[k][0]} ${CONFIRM[k][1]}</div></div>`).join('')}</div>
      <div class="filters"><input type="search" data-acct-q placeholder="Tìm theo tên hoặc email…" value="${esc(state.acctQ)}" aria-label="Tìm tài khoản"></div>
      <div class="table-wrap"><table class="tasks"><thead><tr><th>Thành viên</th><th>Ban</th><th>Quyền</th><th>Chống spam</th><th>Trạng thái</th><th></th></tr></thead><tbody>
      ${list.map((m) => { const c = CONFIRM[confirmOf(m.id)]; return `<tr class="${m.active ? '' : 'done'}">
        <td><b>${esc(m.name)}</b>${fbLink(m)}<div class="muted small">${esc(m.email)}</div></td>
        <td>${m.bans.map((x) => { const b = banById(x.banId); return b ? `<span class="chip ${x.isLead ? 'me' : ''}">${x.isLead ? '★ ' : ''}${esc(b.name)}</span>` : ''; }).join('') || '<span class="muted small">—</span>'}</td>
        <td>${m.isAdmin ? '<span class="badge ok">Admin</span>' : m.bans.some((x) => x.isLead) ? '<span class="badge">Trưởng ban</span>' : '<span class="muted small">Thành viên</span>'}</td>
        <td>${m.userId ? `<span class="badge ${c[2]}">${c[0]} ${c[1]}</span>` : '<span class="muted small">—</span>'}</td>
        <td>${!m.active ? '<span class="badge muted">Đã khóa</span>' : !m.userId ? '<span class="badge warn">Chưa có đăng nhập</span>' : m.mustChange ? '<span class="badge warn">Chưa đổi mật khẩu</span>' : '<span class="badge ok">Hoạt động</span>'}</td>
        <td class="row-actions"><button class="btn ghost small" data-act="edit-member" data-id="${esc(m.id)}">Sửa</button>
          ${m.active && !m.userId ? `<button class="btn small primary" data-act="grant-login" data-id="${esc(m.id)}">Cấp đăng nhập</button>` : ''}
          ${m.active && m.userId ? `<button class="btn ghost small" data-act="reset-pw" data-id="${esc(m.id)}">Đặt lại MK</button>` : ''}
          ${m.id !== me().id ? `<button class="btn ghost small" data-act="toggle-active" data-id="${esc(m.id)}">${m.active ? 'Khóa' : 'Mở khóa'}</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  }

  function banPicker(selected) {
    return `<div class="ban-picker">${D().bans.map((b) => { const s = selected.find((x) => x.banId === b.id); return `<div class="ban-pick">
      <label class="check"><input type="checkbox" name="ban" value="${esc(b.id)}" ${s ? 'checked' : ''}> ${esc(b.name)}</label>
      <label class="check small"><input type="checkbox" name="lead:${esc(b.id)}" ${s && s.isLead ? 'checked' : ''}> Trưởng ban</label></div>`; }).join('')}</div>`;
  }
  const readBans = (fd) => fd.getAll('ban').map((id) => ({ banId: id, isLead: !!fd.get('lead:' + id) }));

  function openAccountModal() {
    openModal(`<form id="acct-form">${modalHead('Cấp tài khoản mới')}
      <div class="m-body">
        <p class="hint">Hệ thống tạo mật khẩu ngẫu nhiên và <b>gửi email</b> cho người này (kèm link trang PCCV và hướng dẫn chống spam). Lần đầu đăng nhập họ sẽ phải đổi mật khẩu.</p>
        <label>Email (Gmail) *<input name="email" type="email" required placeholder="ten@gmail.com"></label>
        <label>Họ tên *<input name="name" required></label>
        <div class="field"><span class="lbl">Ban</span>${banPicker([])}</div>
        <label class="check"><input type="checkbox" name="isAdmin"> Quyền <b>Admin</b> (xem Dashboard, cấp tài khoản, quản trị)</label>
      </div>
      <footer class="m-foot"><span></span><div><button type="button" class="btn" data-act="close">Hủy</button><button class="btn primary" id="acct-btn">Tạo & gửi email</button></div></footer></form>`);
    $('#acct-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const payload = { email: String(fd.get('email')).trim(), name: String(fd.get('name')).trim(), isAdmin: !!fd.get('isAdmin'), bans: readBans(fd) };
      await run(async () => {
        const r = await S.createAccount(payload);
        await refreshQuiet();
        renderMain();
        showPassword(payload.name, payload.email, r.password, r.emailed, 'Đã cấp tài khoản');
      }, $('#acct-btn'));
    });
  }

  function showPassword(name, email, pw, emailed, title) {
    openModal(`<div>${modalHead(title)}<div class="m-body">
      <p>${emailed ? `✅ Đã gửi email cho <b>${esc(email)}</b>.` : '⚠ <b>Chưa gửi được email</b> (có thể hết hạn mức gửi hôm nay). Hãy gửi thông tin này cho người dùng qua Zalo.'}</p>
      <div class="pw-box"><div><span class="muted small">Tài khoản</span><br><b>${esc(name)}</b> · ${esc(email)}</div>
        <div><span class="muted small">Mật khẩu</span><br><code id="pw-val">${esc(pw)}</code></div>
        <button class="btn small" data-act="copy-pw" data-text="${esc(`Trang PCCV: ${CFG.SITE_URL || location.origin + location.pathname}\nEmail: ${email}\nMật khẩu: ${pw}`)}">📋 Sao chép thông tin đăng nhập</button></div>
      <p class="muted small">Mật khẩu chỉ hiện một lần. Người dùng sẽ phải đổi mật khẩu khi đăng nhập lần đầu.</p></div>
      <footer class="m-foot"><span></span><button class="btn primary" data-act="close">Xong</button></footer></div>`);
  }

  function openMemberModal(m) {
    openModal(`<form id="mem-form">${modalHead('Sửa thành viên', m.email)}
      <div class="m-body">
        <label>Họ tên *<input name="name" required value="${esc(m.name)}"></label>
        <label>Tên trên Facebook <span class="muted small">(nếu khác tên thật)</span><input name="fbName" value="${esc(m.fbName || '')}"></label>
        <label>Link Facebook cá nhân<input name="fbUrl" value="${esc(m.fbUrl || '')}" placeholder="https://www.facebook.com/…"></label>
        <div class="field"><span class="lbl">Ban</span>${banPicker(m.bans)}</div>
        <label class="check"><input type="checkbox" name="isAdmin" ${m.isAdmin ? 'checked' : ''} ${m.id === me().id ? 'disabled' : ''}> Quyền <b>Admin</b>${m.id === me().id ? ' <span class="muted small">(không tự bỏ quyền của chính mình)</span>' : ''}</label>
        <p class="muted small">Muốn đổi email: khóa tài khoản này và cấp tài khoản mới.</p>
      </div>
      <footer class="m-foot"><span></span><div><button type="button" class="btn" data-act="close">Hủy</button><button class="btn primary" id="mem-btn">Lưu</button></div></footer></form>`);
    $('#mem-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      await run(async () => {
        await S.updateMember({ id: m.id, name: String(fd.get('name')).trim(), isAdmin: m.id === me().id ? true : !!fd.get('isAdmin'), bans: readBans(fd), fbName: String(fd.get('fbName') || '').trim(), fbUrl: String(fd.get('fbUrl') || '').trim() });
        closeModal(); toast('Đã lưu.'); await refreshQuiet(); renderMain();
      }, $('#mem-btn'));
    });
  }

  function adminBans() {
    return `<div class="page-head row"><div><h2>Ban & vai trò</h2><p class="muted">Mỗi vai trò là một cột "người phụ trách + deadline" trong bảng công việc của Ban (vd. Ban Truyền thông: Content / Design / Đăng bài).</p></div>
      <div class="actions"><button class="btn primary" data-act="edit-ban">＋ Thêm Ban</button></div></div>
      <div class="grid2">${[...D().bans].sort((a, b) => a.sort - b.sort).map((b) => {
        const n = D().tasks.filter((t) => t.banId === b.id).length;
        const mem = activeMembers().filter((m) => m.bans.some((x) => x.banId === b.id));
        return `<div class="card"><div class="row-between"><h3>${esc(b.name)}</h3><button class="btn ghost small" data-act="edit-ban" data-id="${esc(b.id)}">Sửa</button></div>
          <p class="small">Vai trò: ${b.roles.map((r) => `<span class="chip">${esc(r.label)}${r.hasDeadline ? '' : ' (không deadline)'}</span>`).join('') || '<span class="muted">chưa có</span>'}</p>
          <p class="muted small">${n} công việc · ${mem.length} thành viên · Trưởng ban: ${esc(mem.filter((m) => m.bans.some((x) => x.banId === b.id && x.isLead)).map((m) => m.name).join(', ') || 'chưa có')}</p></div>`;
      }).join('')}</div>`;
  }

  function openBanModal(b) {
    const creating = !b;
    b = b || { name: '', sort: D().bans.length + 1, roles: [{ label: 'Phụ trách', hasDeadline: true }] };
    const roleRow = (r) => `<div class="role-row" data-role-id="${esc(r.id || '')}">
      <input name="roleLabel" value="${esc(r.label)}" placeholder="Tên vai trò (vd. Content)" required aria-label="Tên vai trò">
      <label class="check small"><input type="checkbox" name="roleDl" ${r.hasDeadline ? 'checked' : ''}> Có deadline</label>
      <button type="button" class="btn ghost small" data-act="role-up" aria-label="Lên">↑</button>
      <button type="button" class="btn ghost small" data-act="role-x" aria-label="Xóa vai trò">✕</button></div>`;
    openModal(`<form id="ban-form">${modalHead(creating ? 'Thêm Ban' : 'Sửa Ban')}
      <div class="m-body">
        <label>Tên Ban *<input name="name" required value="${esc(b.name)}" placeholder="VD: Ban Nhân sự"></label>
        <label>Thứ tự hiển thị<input name="sort" type="number" value="${esc(b.sort)}"></label>
        <div class="field"><span class="lbl">Vai trò trong công việc</span><div id="roles">${b.roles.map(roleRow).join('')}</div>
          <button type="button" class="btn ghost small" data-act="role-add">＋ Thêm vai trò</button>
          <p class="muted small">⚠ Xóa một vai trò sẽ xóa luôn người phụ trách & deadline của vai trò đó trong mọi công việc.</p></div>
      </div>
      <footer class="m-foot">${creating ? '<span></span>' : `<button type="button" class="btn danger-ghost" data-act="delete-ban" data-id="${esc(b.id)}">Xóa Ban</button>`}
        <div><button type="button" class="btn" data-act="close">Hủy</button><button class="btn primary" id="ban-btn">Lưu</button></div></footer></form>`);
    $('#ban-form').dataset.roleTpl = roleRow({ label: '', hasDeadline: true });
    $('#ban-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const form = ev.target;
      const roles = $$('.role-row', form).map((row) => ({ id: row.dataset.roleId || null, label: row.querySelector('[name=roleLabel]').value.trim(), hasDeadline: row.querySelector('[name=roleDl]').checked }));
      if (!roles.length) return toast('Ban cần ít nhất 1 vai trò.', 'error');
      const keep = roles.map((r) => r.id).filter(Boolean);
      const removed = creating ? [] : b.roles.map((r) => r.id).filter((id) => !keep.includes(id));
      if (removed.length && !confirm(`Xóa ${removed.length} vai trò? Người phụ trách & deadline của vai trò này trong mọi công việc sẽ mất.`)) return;
      await run(async () => {
        await S.saveBan({ id: b.id, name: form.name.value.trim(), sort: Number(form.sort.value) || 0, roles }, removed);
        closeModal(); toast('Đã lưu Ban.'); await refreshQuiet(); renderMain();
      }, $('#ban-btn'));
    });
  }

  function adminEvents() {
    const today = todayIso();
    return `<div class="page-head row"><div><h2>Sự kiện</h2><p class="muted">Một sự kiện có thể có công việc ở nhiều Ban.</p></div>
      <div class="actions"><button class="btn primary" data-act="edit-event">＋ Thêm sự kiện</button></div></div>
      <div class="table-wrap"><table class="tasks"><thead><tr><th>Sự kiện</th><th>Ngày diễn ra</th><th>Công việc</th><th></th></tr></thead><tbody>
      ${eventsSorted().map((e) => { const et = D().tasks.filter((t) => t.eventId === e.id); return `<tr>
        <td><b>${esc(e.name)}</b></td>
        <td>${e.date ? fmtDate(e.date, true) + (e.date >= today ? ' <span class="badge">sắp tới</span>' : '') : '<span class="muted">—</span>'}</td>
        <td>${D().bans.map((b) => { const n = et.filter((t) => t.banId === b.id).length; return n ? `<span class="chip">${esc(b.name)}: ${et.filter((t) => t.banId === b.id && isDone(t)).length}/${n}</span>` : ''; }).join('') || '<span class="muted small">chưa có</span>'}</td>
        <td><button class="btn ghost small" data-act="edit-event" data-id="${esc(e.id)}">Sửa</button></td></tr>`; }).join('') || '<tr><td colspan="4" class="muted">Chưa có sự kiện.</td></tr>'}
      </tbody></table></div>`;
  }

  function openEventModal(e) {
    const creating = !e;
    e = e || { name: '', date: '' };
    openModal(`<form id="ev-form">${modalHead(creating ? 'Thêm sự kiện' : 'Sửa sự kiện')}
      <div class="m-body"><label>Tên sự kiện *<input name="name" required value="${esc(e.name)}"></label>
        <label>Ngày diễn ra<input name="date" type="date" value="${esc(e.date)}"></label></div>
      <footer class="m-foot">${creating ? '<span></span>' : `<button type="button" class="btn danger-ghost" data-act="delete-event" data-id="${esc(e.id)}">Xóa</button>`}
        <div><button type="button" class="btn" data-act="close">Hủy</button><button class="btn primary" id="ev-btn">Lưu</button></div></footer></form>`);
    $('#ev-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      await run(async () => { await S.saveEvent({ id: e.id, name: f.name.value, date: f.date.value }); closeModal(); toast('Đã lưu sự kiện.'); await refreshQuiet(); renderMain(); }, $('#ev-btn'));
    });
  }

  function adminSettings() {
    const s = D().settings;
    return `<div class="page-head"><h2>Cài đặt nhắc việc</h2></div>
      <form class="card settings" id="settings-form">
        <label>Nhắc trước deadline bao nhiêu ngày<input name="reminder_days" type="number" min="0" max="14" value="${esc(s.reminder_days ?? 1)}"></label>
        <label>Nhắc việc quá hạn trong tối đa bao nhiêu ngày<input name="overdue_max_days" type="number" min="0" max="60" value="${esc(s.overdue_max_days ?? 7)}"></label>
        <p class="muted small">Mỗi sáng (8–9h) hệ thống gửi <b>một email tổng hợp</b> cho từng người. Mỗi mốc chỉ nhắc 1 lần; đổi deadline thì nhắc lại theo deadline mới.
          Trưởng ban nhận thêm bản tổng hợp tuần vào thứ Hai.</p>
        <p class="small">Địa chỉ gửi mail: <b>${esc(s.sender_email || '(chưa cài Apps Script)')}</b></p>
        <fieldset class="pause-box"><legend>Tạm hoãn gửi mail tự động</legend>
          <p class="small">Trạng thái: ${mailPaused() ? '<span class="badge warn">⏸ Đang tạm hoãn</span>' : '<span class="badge ok">▶ Đang gửi bình thường</span>'}</p>
          <label class="check"><input type="checkbox" name="mail_paused" ${s.mail_paused === true ? 'checked' : ''}> Tạm hoãn nhắc việc, tổng hợp tuần và email xác nhận gửi lại</label>
          <label>Hoãn đến hết ngày <span class="muted small">(để trống = hoãn đến khi bật lại)</span><input name="mail_paused_until" type="date" value="${esc(s.mail_paused_until || '')}"></label>
          <p class="muted small">Email admin tự bấm gửi (cấp đăng nhập, đặt lại mật khẩu) vẫn gửi bình thường. Khi bật lại, các việc vẫn còn trong khoảng nhắc sẽ được nhắc vào sáng hôm sau.</p>
        </fieldset>
        <div><button class="btn primary" id="settings-btn">Lưu cài đặt</button></div>
      </form>`;
  }

  async function refreshQuiet() { state.data = await S.loadAll(); }

  /* ============================== Chống spam ============================== */
  function openAntispam() {
    const sender = D().settings.sender_email || '';
    const ok = confirmOf(me().id) === 'tin_cay';
    const canAuto = !!CFG.GOOGLE_CLIENT_ID || S.demo;
    openModal(`<div>${modalHead('🛡️ Chống email nhắc việc vào Spam')}<div class="m-body">
      ${ok ? '<p class="alert ok">✅ Bạn đã hoàn tất. Email nhắc việc sẽ vào hộp thư chính.</p>' : ''}
      <p>Email nhắc việc được gửi từ <b>${esc(sender || '(chưa cấu hình)')}</b>.</p>
      ${canAuto ? `<h4>Cách 1 – Tự động</h4>
        <p class="small">Website xin quyền tạm thời để tạo <b>một bộ lọc</b> trong Gmail của bạn: "Thư từ ${esc(sender)} → Không bao giờ chuyển vào Spam". Quyền được thu hồi ngay sau khi tạo xong; website không đọc thư của bạn.</p>
        <button class="btn primary" data-act="gmail-filter">Kết nối Gmail & tạo bộ lọc</button>` : ''}
      <h4>${canAuto ? 'Cách 2 – ' : ''}Thủ công</h4>
      <ol class="small"><li>Tìm email <b>"Tài khoản PCCV của bạn"</b> từ ${esc(sender)} (xem cả mục Spam) và <b>trả lời "OK"</b>.</li>
        <li>Hoặc mở <a href="https://mail.google.com/mail/u/0/#search/from%3A${encodeURIComponent(sender)}" target="_blank" rel="noopener">Gmail</a> → biểu tượng tùy chọn ở ô tìm kiếm → <b>Tạo bộ lọc</b> → tích <b>"Không bao giờ gửi vào Thư rác"</b>.</li></ol>
    </div></div>`);
  }

  function loadGis() {
    return new Promise((resolve, reject) => {
      if (window.google && google.accounts && google.accounts.oauth2) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Không tải được Google.'));
      document.head.appendChild(s);
    });
  }

  async function createGmailFilter(btn) {
    const sender = D().settings.sender_email;
    if (S.demo) return run(async () => { await S.markFilter(); await refreshQuiet(); closeModal(); toast('(Demo) Đã tạo bộ lọc Gmail.'); render(); }, btn);
    if (!sender) return toast('Admin chưa cài máy chủ gửi mail.', 'error');
    btn.disabled = true;
    try { await loadGis(); } catch (e) { btn.disabled = false; return toast(e.message, 'error'); }
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
          const exists = (list.filter || []).some((f) => String((f.criteria || {}).from || '').toLowerCase().includes(sender.toLowerCase()) && ((f.action || {}).removeLabelIds || []).includes('SPAM'));
          if (!exists) {
            const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
              body: JSON.stringify({ criteria: { from: sender }, action: { removeLabelIds: ['SPAM'] } }) });
            if (!r.ok) { const j = await r.json(); throw new Error((j.error && j.error.message) || 'Không tạo được bộ lọc'); }
          }
          google.accounts.oauth2.revoke(at, () => {});
          await S.markFilter();
          await refreshQuiet();
          closeModal(); toast('✅ Đã tạo bộ lọc! Email nhắc việc sẽ không vào Spam nữa.'); render();
        } catch (e) {
          google.accounts.oauth2.revoke(at, () => {});
          toast('Lỗi: ' + e.message, 'error'); btn.disabled = false;
        }
      },
      error_callback: () => { btn.disabled = false; toast('Đã hủy kết nối Gmail.', 'error'); },
    });
    client.requestAccessToken();
  }

  /* ============================== tooltip ============================== */
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  document.addEventListener('mousemove', (ev) => {
    const el = ev.target.closest && ev.target.closest('[data-tip]');
    if (!el) { tip.classList.remove('show'); return; }
    tip.textContent = el.getAttribute('data-tip');
    tip.classList.add('show');
    const r = tip.getBoundingClientRect();
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });

  /* ============================== sự kiện ============================== */
  async function saveMyCheck(cid, action, selfDone, proofUrl) {
    const x = await S.saveCheck({ campaignId: cid, memberId: me().id, action, selfDone, proofUrl });
    const i = D().checks.findIndex((y) => y.campaignId === cid && y.memberId === me().id && y.action === action);
    if (i >= 0) D().checks[i] = x; else D().checks.push(x);
    renderMain();
  }
  const findTask = (id) => D().tasks.find((t) => t.id === id);
  const actions = {
    view: (el) => { state.view = el.dataset.view; ss.set('view', state.view); render(); window.scrollTo(0, 0); },
    'admin-tab': (el) => { state.adminTab = el.dataset.tab; ss.set('adminTab', state.adminTab); renderMain(); },
    logout: async () => { await S.signOut(); state.data = null; renderLogin(); },
    reload: () => loadData(),
    edit: (el) => openTaskModal(findTask(el.dataset.id)),
    new: (el) => openTaskModal(null, el.dataset.ban),
    clone: (el) => openCloneModal(el.dataset.ban),
    close: () => closeModal(),
    'chip-x': (el) => el.closest('.chip').remove(),
    'link-add': () => $('#links').insertAdjacentHTML('beforeend', linkRow({ label: '', url: '' }, false)),
    'link-x': (el) => el.closest('.link-row').remove(),
    antispam: () => openAntispam(),
    'gmail-filter': (el) => createGmailFilter(el),
    'change-pw': () => {
      openModal(`<form id="pw-form">${modalHead('Đổi mật khẩu')}<div class="m-body">${pwFields()}</div>
        <footer class="m-foot"><span></span><div><button type="button" class="btn" data-act="close">Hủy</button><button class="btn primary">Lưu</button></div></footer></form>`);
      bindPwForm($('#pw-form'), async () => closeModal());
    },
    delete: async (el) => {
      const t = findTask(el.dataset.id);
      if (!confirm(`Xóa công việc "${t.name}"?`)) return;
      await run(async () => { await S.deleteTask(t.id); D().tasks = D().tasks.filter((x) => x.id !== t.id); closeModal(); toast('Đã xóa.'); renderMain(); }, el);
    },
    'new-account': () => openAccountModal(),
    'edit-member': (el) => openMemberModal(memberById(el.dataset.id)),
    'reset-pw': async (el) => {
      const m = memberById(el.dataset.id);
      if (!confirm(`Đặt lại mật khẩu cho ${m.name}? Mật khẩu mới sẽ được gửi tới ${m.email}.`)) return;
      await run(async () => { const r = await S.resetPassword(m.id); await refreshQuiet(); renderMain(); showPassword(m.name, m.email, r.password, r.emailed, 'Đã đặt lại mật khẩu'); }, el);
    },
    'toggle-active': async (el) => {
      const m = memberById(el.dataset.id);
      if (!confirm(m.active ? `Khóa tài khoản ${m.name}? Người này sẽ không đăng nhập được và không nhận email nữa.` : `Mở khóa tài khoản ${m.name}?`)) return;
      await run(async () => { await S.setActive(m.id, !m.active); await refreshQuiet(); renderMain(); toast(m.active ? 'Đã khóa.' : 'Đã mở khóa.'); }, el);
    },
    'grant-login': async (el) => {
      const m = memberById(el.dataset.id);
      if (!confirm(`Cấp đăng nhập cho ${m.name}? Mật khẩu sẽ được gửi tới ${m.email}.`)) return;
      await run(async () => { const r = await S.grantLogin(m.id); await refreshQuiet(); renderMain(); showPassword(m.name, m.email, r.password, r.emailed, 'Đã cấp đăng nhập'); }, el);
    },
    'grant-all': async (el) => {
      const list = activeMembers().filter((m) => !m.userId);
      if (!confirm(`Cấp đăng nhập và gửi email mật khẩu cho ${list.length} người?\n(Gmail gửi được khoảng 100 email/ngày.)`)) return;
      el.disabled = true;
      const results = [];
      for (const [i, m] of list.entries()) {
        el.textContent = `Đang cấp ${i + 1}/${list.length}…`;
        try { const r = await S.grantLogin(m.id); results.push({ m, pw: r.password, emailed: r.emailed }); }
        catch (e) { results.push({ m, error: e.message }); if (e.code === 'QUOTA') break; }
      }
      await refreshQuiet(); renderMain();
      const ok = results.filter((r) => r.pw);
      const all = ok.map((r) => `${r.m.name} | ${r.m.email} | ${r.pw}`).join('\n');
      openModal(`<div>${modalHead(`Đã cấp đăng nhập cho ${ok.length}/${list.length} người`)}<div class="m-body">
        <p class="small">Mỗi người đã nhận email chứa mật khẩu. Danh sách dưới đây chỉ hiện một lần – sao chép lại nếu cần gửi qua Zalo.</p>
        <div class="table-wrap"><table class="mini"><thead><tr><th>Thành viên</th><th>Mật khẩu</th><th>Email</th></tr></thead><tbody>
        ${results.map((r) => `<tr><td>${esc(r.m.name)}<div class="muted small">${esc(r.m.email)}</div></td><td>${r.pw ? `<code>${esc(r.pw)}</code>` : `<span class="badge danger">Lỗi</span> <span class="small">${esc(r.error)}</span>`}</td><td>${r.pw ? (r.emailed ? '✅ đã gửi' : '⚠ chưa gửi') : ''}</td></tr>`).join('')}
        </tbody></table></div>
        ${ok.length ? `<button class="btn small" data-act="copy-pw" data-text="${esc(all)}">📋 Sao chép toàn bộ danh sách</button>` : ''}</div>
        <footer class="m-foot"><span></span><button class="btn primary" data-act="close">Xong</button></footer></div>`);
    },
    'my-fb': () => openMyFb(),
    'fb-update': () => openFbUpdateList(),
    'seed-new': () => openSeedForm(null),
    'seed-detail': (el) => openSeedDetail(D().campaigns.find((c) => c.id === el.dataset.id)),
    'seed-edit': (el) => openSeedForm(D().campaigns.find((c) => c.id === el.dataset.id)),
    'seed-verify': (el) => openSeedVerify(D().campaigns.find((c) => c.id === el.dataset.id), el.dataset.action),
    'seed-all': () => $$('#seed-form input[name=mem]').forEach((x) => { x.checked = true; }),
    'seed-none': () => $$('#seed-form input[name=mem]').forEach((x) => { x.checked = false; }),
    'seed-ban': (el) => $$(`#seed-form [data-ban-group="${CSS.escape(el.dataset.ban)}"] input`).forEach((x) => { x.checked = true; }),
    'seed-delete': async (el) => {
      const c = D().campaigns.find((x) => x.id === el.dataset.id);
      if (!confirm(`Xóa đợt seeding "${c.title}"?`)) return;
      await run(async () => { await S.deleteCampaign(c.id); D().campaigns = D().campaigns.filter((x) => x.id !== c.id); closeModal(); toast('Đã xóa.'); renderMain(); }, el);
    },
    'seed-proof': async (el) => {
      const cid = el.dataset.cid;
      const input = $(`[data-proof="${CSS.escape(cid)}"]`);
      const url = input.value.trim();
      if (url && !/^https?:\/\//i.test(url)) return toast('Link phải bắt đầu bằng https://', 'error');
      const cur = checkOf(cid, me().id, 'share') || {};
      await run(async () => { await saveMyCheck(cid, 'share', url ? true : !!cur.selfDone, url); toast('Đã lưu link.'); }, el);
    },
    'resume-mail': async (el) => {
      await run(async () => { await S.saveSettings({ mail_paused: false, mail_paused_until: '' }); await refreshQuiet(); renderMain(); toast('▶ Đã bật lại gửi mail tự động.'); }, el);
    },
    'resend-all': async (el) => {
      if (!confirm('Gửi lại email xác nhận cho tất cả người chưa xác nhận?')) return;
      await run(async () => { const r = await S.resendConfirm(); await refreshQuiet(); renderMain(); toast(`Đã gửi ${r.sent} email.`); }, el);
    },
    'copy-pw': async (el) => {
      try { await navigator.clipboard.writeText(el.dataset.text); toast('Đã sao chép.'); } catch (e) { toast('Không sao chép được – hãy tự chọn và copy.', 'error'); }
    },
    'edit-ban': (el) => openBanModal(el.dataset.id ? banById(el.dataset.id) : null),
    'role-add': () => $('#roles').insertAdjacentHTML('beforeend', $('#ban-form').dataset.roleTpl),
    'role-x': (el) => el.closest('.role-row').remove(),
    'role-up': (el) => { const row = el.closest('.role-row'); if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling); },
    'delete-ban': async (el) => {
      const b = banById(el.dataset.id);
      if (!confirm(`Xóa "${b.name}"? Chỉ xóa được khi Ban không còn công việc nào.`)) return;
      await run(async () => { await S.deleteBan(b.id); closeModal(); toast('Đã xóa Ban.'); await refreshQuiet(); render(); }, el);
    },
    'edit-event': (el) => openEventModal(el.dataset.id ? eventById(el.dataset.id) : null),
    'delete-event': async (el) => {
      const e = eventById(el.dataset.id);
      if (!confirm(`Xóa sự kiện "${e.name}"? Các công việc của sự kiện vẫn giữ lại nhưng không thuộc sự kiện nào.`)) return;
      await run(async () => { await S.deleteEvent(e.id); closeModal(); toast('Đã xóa sự kiện.'); await refreshQuiet(); renderMain(); }, el);
    },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (el && actions[el.dataset.act]) { ev.preventDefault(); actions[el.dataset.act](el); }
  });

  document.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (el.dataset.change === 'status') {
      const t = findTask(el.dataset.id);
      const prev = t.status;
      el.disabled = true;
      await run(async () => {
        const saved = await S.saveTask(Object.assign({}, t, { status: el.value }), false);
        Object.assign(t, saved);
        toast(el.value === 'done' ? '🎉 Đã hoàn thành!' : 'Đã cập nhật trạng thái.');
        renderMain();
      });
      if (t.status === prev) { el.value = prev; el.disabled = false; }
    } else if (el.dataset.change === 'seed-self') {
      el.disabled = true;
      const cur = checkOf(el.dataset.cid, me().id, el.dataset.action) || {};
      await run(async () => { await saveMyCheck(el.dataset.cid, el.dataset.action, el.checked, cur.proofUrl || ''); });
      el.disabled = false;
    } else if (el.dataset.change === 'chip-add') {
      const id = el.value;
      if (!id) return;
      const box = el.closest('.people').querySelector('.chips');
      if (!$$('.chip', box).some((c) => c.dataset.id === id)) {
        box.insertAdjacentHTML('beforeend', `<span class="chip" data-id="${esc(id)}">${esc(mName(id))}<button type="button" data-act="chip-x" aria-label="Bỏ">×</button></span>`);
      }
      el.value = '';
    } else if (el.dataset.change === 'event-select') {
      el.parentNode.querySelector('.new-event').classList.toggle('hidden', el.value !== '__new');
    } else if (el.dataset.filter && el.tagName === 'SELECT') {
      state.filters[$('#ban-body').dataset.ban][el.dataset.filter] = el.value;
      renderBanBody();
    } else if (el.dataset.dash) {
      state.dash[el.dataset.dash] = el.value;
      renderMain();
    }
  });

  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.filter === 'q') { state.filters[$('#ban-body').dataset.ban].q = el.value; renderBanBody(); }
    else if (el.hasAttribute('data-acct-q')) {
      state.acctQ = el.value;
      const pos = el.selectionStart;
      renderMain();
      const n = $('[data-acct-q]'); n.focus(); n.setSelectionRange(pos, pos);
    }
  });

  document.addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'settings-form') return;
    ev.preventDefault();
    const f = ev.target;
    await run(async () => {
      const paused = f.mail_paused.checked;
      await S.saveSettings({ reminder_days: Number(f.reminder_days.value), overdue_max_days: Number(f.overdue_max_days.value),
        mail_paused: paused, mail_paused_until: paused ? f.mail_paused_until.value || '' : '' });
      await refreshQuiet(); renderMain(); toast(paused ? '⏸ Đã tạm hoãn gửi mail tự động.' : 'Đã lưu cài đặt.');
    }, $('#settings-btn'));
  });

  $('#modal').addEventListener('click', (ev) => { if (ev.target.id === 'modal') closeModal(); });

  /* ============================== khởi động ============================== */
  if (location.hash.startsWith('#seed-import=')) {
    ss.set('seedImport', location.hash.slice('#seed-import='.length));
    history.replaceState(null, '', location.pathname + location.search);
  }
  window.addEventListener('hashchange', () => {
    if (!location.hash.startsWith('#seed-import=')) return;
    const raw = location.hash.slice('#seed-import='.length);
    history.replaceState(null, '', location.pathname + location.search);
    if (!state.data) { ss.set('seedImport', raw); return; }
    try { const p = JSON.parse(decodeURIComponent(escape(atob(raw)))); if (p.kind !== 'profile') { state.view = 'seeding'; render(); } openSeedImport(p); }
    catch (e) { toast('Dữ liệu từ Facebook không đọc được.', 'error'); }
  });
  (async () => {
    try { if (await S.init()) await loadData(); else renderLogin(); } catch (e) { renderLogin(e.message); }
  })();
})();

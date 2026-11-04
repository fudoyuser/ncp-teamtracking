/**
 * NCP TeamTracking – Máy chủ gửi mail & cấp tài khoản (Google Apps Script, KHÔNG cần Google Sheet)
 * ------------------------------------------------------------------------------------------------
 * Script này chạy bằng tài khoản Gmail của CLB và làm 3 việc:
 *   1. Admin bấm "Cấp tài khoản" trên Dashboard → tạo tài khoản Supabase + gửi email mật khẩu.
 *   2. Mỗi sáng: gửi email nhắc việc tổng hợp cho từng người, tổng hợp tuần cho trưởng ban.
 *   3. Chống spam: theo dõi ai đã bấm link / trả lời "OK", tự gửi lại cho người chưa phản hồi.
 *
 * Cài đặt: xem README.md (Bước 3). Cần 2 Thuộc tính tập lệnh (Script properties):
 *   SUPABASE_URL          vd. https://abcdxyz.supabase.co
 *   SUPABASE_SERVICE_KEY  khóa "service_role" (Project Settings → API). TUYỆT ĐỐI không đưa vào website.
 */

/* ======================= CẤU HÌNH – SỬA Ở ĐÂY ======================= */
const CONFIG = {
  WEBSITE_URL: 'https://fudoyuser.github.io/ncp-teamtracking/',
  CLUB_NAME: 'NEU Career Path Club',
  SENDER_NAME: 'NCP TeamTracking',

  // Tài khoản admin đầu tiên – được tạo khi chạy hàm caiDatLanDau()
  FIRST_ADMIN_EMAIL: 'phandangduonga.ncp@gmail.com',
  FIRST_ADMIN_NAME: 'Phan Đăng Dương',

  ACCOUNT_SUBJECT: '[NCP] Tài khoản PCCV của bạn', // hệ thống nhận diện email trả lời "OK" theo tiêu đề này
  REMINDER_HOUR: 8,
  LEAD_SUMMARY_WEEKDAY: 1, // 1 = Thứ Hai
  CONFIRM_RESEND_AFTER_DAYS: 3,
  CONFIRM_MAX_SENDS: 3,
};

const STATUS_LABEL = { todo: 'Chưa bắt đầu', doing: 'Đang làm', done: 'Hoàn thành' };

/* ============================ CÀI ĐẶT LẦN ĐẦU ============================ */

/** Chạy hàm này 1 lần từ trình chỉnh sửa (chọn caiDatLanDau → Chạy). */
function caiDatLanDau() {
  checkProps_();
  setSetting_('sender_email', senderEmail_());
  // Admin đầu tiên
  const existing = db_.select('members', 'email=eq.' + enc_(CONFIG.FIRST_ADMIN_EMAIL.toLowerCase()) + '&select=id');
  if (existing.length) {
    console.log('Admin ' + CONFIG.FIRST_ADMIN_EMAIL + ' đã tồn tại – bỏ qua.');
  } else {
    const r = createAccount_({ email: CONFIG.FIRST_ADMIN_EMAIL, name: CONFIG.FIRST_ADMIN_NAME, isAdmin: true, bans: [] });
    console.log('ĐÃ TẠO ADMIN: ' + CONFIG.FIRST_ADMIN_EMAIL + '  –  Mật khẩu: ' + r.password +
      (r.emailed ? '  (đã gửi email)' : '  (CHƯA gửi được email)'));
  }
  // Lịch chạy hằng ngày
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'runDaily').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runDaily').timeBased().everyDays(1).atHour(CONFIG.REMINDER_HOUR).create();
  console.log('Đã bật nhắc việc tự động lúc ' + CONFIG.REMINDER_HOUR + 'h–' + (CONFIG.REMINDER_HOUR + 1) + 'h mỗi sáng.');
}

/* ============================ WEB API (cho Dashboard) ============================ */

function doPost(e) {
  let out;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const me = authenticate_(body.token);
    out = { ok: true, data: route_(me, body.action, body.payload || {}) };
  } catch (err) {
    if (!err.code) console.error(err && err.stack ? err.stack : err);
    out = { ok: false, error: err.code || 'ERROR', message: err.message || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'confirm') return confirmPage_(p.t);
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">NCP TeamTracking mail server đang chạy.</p>');
}

function route_(me, action, p) {
  const adminOnly = () => { if (!me.is_admin) throw fail_('FORBIDDEN', 'Chỉ admin mới làm được việc này.'); };
  switch (action) {
    case 'createAccount': adminOnly(); return withLock_(() => createAccount_(p));
    case 'grantLogin': adminOnly(); return withLock_(() => grantLogin_(p.memberId));
    case 'resetPassword': adminOnly(); return withLock_(() => resetPassword_(p.memberId));
    case 'setActive': adminOnly(); return withLock_(() => setActive_(p.memberId, !!p.active));
    case 'resendConfirm': adminOnly(); return withLock_(() => ({ sent: resendConfirmNow_(p.memberIds) }));
    case 'ping': return { ok: true, sender: senderEmail_() };
    case 'checkLink': return checkPartLink_(p.partId);
    default: throw fail_('BAD_ACTION', 'Hành động không hợp lệ: ' + action);
  }
}

/** Xác thực bằng access token Supabase của người đang đăng nhập trên website. */
function authenticate_(token) {
  if (!token) throw fail_('AUTH_REQUIRED', 'Bạn cần đăng nhập.');
  const pr = checkProps_();
  const res = UrlFetchApp.fetch(pr.url + '/auth/v1/user', {
    headers: { apikey: pr.key, Authorization: 'Bearer ' + token }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw fail_('AUTH_EXPIRED', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  const user = JSON.parse(res.getContentText());
  const m = db_.select('members', 'user_id=eq.' + user.id + '&active=is.true&select=*');
  if (!m.length) throw fail_('FORBIDDEN', 'Tài khoản không còn hoạt động.');
  return m[0];
}

/* ============================ TÀI KHOẢN ============================ */

function createAccount_(p) {
  const email = str_(p.email).toLowerCase();
  const name = str_(p.name);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail_('INVALID', 'Email không hợp lệ.');
  if (!name) throw fail_('INVALID', 'Hãy nhập họ tên.');
  const existing = db_.select('members', 'email=eq.' + enc_(email) + '&select=*')[0];
  if (existing && existing.user_id) {
    throw fail_('INVALID', 'Email ' + email + ' đã có tài khoản. Dùng "Đặt lại mật khẩu" nếu cần.');
  }
  if (existing) return grantLogin_(existing.id); // đã có trong danh sách (vd. nhập từ Sheet) nhưng chưa có đăng nhập
  const password = genPassword_();
  const user = authAdmin_('post', '/users', { email, password, email_confirm: true });
  let member;
  try {
    member = db_.insert('members', [{ user_id: user.id, email, name, is_admin: !!p.isAdmin, must_change_password: true }])[0];
    const bans = (p.bans || []).filter(b => b && b.banId);
    if (bans.length) db_.insert('member_bans', bans.map(b => ({ member_id: member.id, ban_id: b.banId, is_lead: !!b.isLead, is_vice: !b.isLead && !!b.isVice, is_ctv: !b.isLead && !b.isVice && !!b.isCtv })));
    db_.insert('email_confirm', [{ member_id: member.id }]);
  } catch (err) {
    authAdmin_('delete', '/users/' + user.id); // dọn dẹp nếu lỗi giữa chừng
    throw err;
  }
  const emailed = sendAccountEmail_(member, password, 'new');
  return { memberId: member.id, password, emailed };
}

/** Cấp đăng nhập cho thành viên đã có trong danh sách nhưng chưa có tài khoản (vd. nhập từ Google Sheet). */
function grantLogin_(memberId) {
  const m = getMember_(memberId);
  if (m.user_id) throw fail_('INVALID', m.name + ' đã có tài khoản đăng nhập.');
  if (MailApp.getRemainingDailyQuota() < 1) throw fail_('QUOTA', 'Đã hết hạn mức gửi mail hôm nay, thử lại vào ngày mai.');
  const password = genPassword_();
  const user = authAdmin_('post', '/users', { email: m.email, password, email_confirm: true });
  try {
    db_.update('members', 'id=eq.' + m.id, { user_id: user.id, must_change_password: true, active: true });
  } catch (err) { authAdmin_('delete', '/users/' + user.id); throw err; }
  m.user_id = user.id;
  const emailed = sendAccountEmail_(m, password, 'new');
  return { memberId: m.id, password, emailed };
}

function resetPassword_(memberId) {
  const m = getMember_(memberId);
  if (!m.user_id) throw fail_('INVALID', 'Thành viên này chưa có tài khoản đăng nhập.');
  const password = genPassword_();
  authAdmin_('put', '/users/' + m.user_id, { password });
  db_.update('members', 'id=eq.' + m.id, { must_change_password: true });
  const emailed = sendAccountEmail_(m, password, 'reset');
  return { password, emailed };
}

function setActive_(memberId, active) {
  const m = getMember_(memberId);
  if (m.user_id) authAdmin_('put', '/users/' + m.user_id, { ban_duration: active ? 'none' : '876000h' });
  db_.update('members', 'id=eq.' + m.id, { active });
  return { active };
}

function getMember_(id) {
  const r = db_.select('members', 'id=eq.' + enc_(id) + '&select=*');
  if (!r.length) throw fail_('NOT_FOUND', 'Không tìm thấy thành viên.');
  return r[0];
}

function genPassword_() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now() + Math.random());
  let s = '';
  for (let i = 0; i < 10; i++) s += chars.charAt((bytes[i] + 256) % chars.length);
  return s;
}

/* ============================ EMAIL TÀI KHOẢN / CHỐNG SPAM ============================ */

/** kind: 'new' (cấp tài khoản), 'reset' (mật khẩu mới), 'resend' (gửi lại, không kèm mật khẩu), 'nudge' (nhắc trả lời OK) */
function sendAccountEmail_(member, password, kind) {
  if (MailApp.getRemainingDailyQuota() < 1) return false;
  let conf = db_.select('email_confirm', 'member_id=eq.' + member.id + '&select=*')[0];
  if (!conf) conf = db_.insert('email_confirm', [{ member_id: member.id }])[0];
  const confirmLink = webAppUrl_() + '?action=confirm&t=' + encodeURIComponent(conf.token);
  const sender = senderEmail_();
  const loginBox = (pw) => '<table style="background:#f3f6fb;border-radius:8px;padding:14px 18px;margin:12px 0;font-size:15px">' +
    '<tr><td style="color:#666;padding:2px 12px 2px 0">Trang PCCV</td><td><a href="' + escHtml_(CONFIG.WEBSITE_URL) + '">' + escHtml_(CONFIG.WEBSITE_URL) + '</a></td></tr>' +
    '<tr><td style="color:#666;padding:2px 12px 2px 0">Email</td><td><b>' + escHtml_(member.email) + '</b></td></tr>' +
    (pw ? '<tr><td style="color:#666;padding:2px 12px 2px 0">Mật khẩu</td><td><b style="font-family:monospace;font-size:17px">' + escHtml_(pw) + '</b></td></tr>' : '') +
    '</table>';
  const antiSpam = '<p>Để email nhắc deadline <b>không bị vào Spam</b>, bạn giúp mình 2 bước:</p>' +
    '<p><b>Bước 1:</b> Bấm nút bên dưới</p>' + button_(confirmLink, '✅ Tôi đã nhận được email') +
    '<p><b>Bước 2 (quan trọng):</b> <b>Trả lời email này với chữ "OK"</b>.</p>' +
    '<p style="color:#666;font-size:13px">Nếu email này nằm trong mục Spam, hãy bấm <b>"Báo cáo không phải là thư rác"</b>.</p>';
  let subject = CONFIG.ACCOUNT_SUBJECT, inner, text;
  if (kind === 'new') {
    inner = '<p>Bạn đã được cấp tài khoản vào <b>bảng phân công công việc (PCCV)</b> của ' + escHtml_(CONFIG.CLUB_NAME) + '.</p>' +
      loginBox(password) + '<p>Lần đăng nhập đầu tiên, hệ thống sẽ yêu cầu bạn <b>đổi mật khẩu</b>.</p><hr style="border:0;border-top:1px solid #eee">' + antiSpam;
  } else if (kind === 'reset') {
    subject = '[NCP] Mật khẩu PCCV mới';
    inner = '<p>Admin vừa đặt lại mật khẩu PCCV cho bạn.</p>' + loginBox(password) +
      '<p>Lần đăng nhập tới, hệ thống sẽ yêu cầu bạn đổi mật khẩu.</p>';
  } else if (kind === 'nudge') {
    inner = '<p>Cảm ơn bạn đã xác nhận! Chỉ còn <b>một bước nhỏ</b>: hãy <b>trả lời email này với chữ "OK"</b>. ' +
      'Khi bạn trả lời, Gmail sẽ coi địa chỉ ' + escHtml_(sender) + ' là người quen và email nhắc việc sẽ không vào Spam.</p>';
  } else {
    inner = '<p><i>Có thể bạn chưa thấy email trước của mình nên mình gửi lại nhé.</i></p>' +
      '<p>Bạn đã có tài khoản PCCV của ' + escHtml_(CONFIG.CLUB_NAME) + ' (mật khẩu đã gửi ở email trước; quên thì nhờ admin đặt lại).</p>' +
      loginBox(null) + antiSpam;
  }
  text = 'Chào ' + member.name + ',\n\nTrang PCCV: ' + CONFIG.WEBSITE_URL + '\nEmail: ' + member.email +
    (password ? '\nMật khẩu: ' + password : '') + '\n\nXác nhận nhận email: ' + confirmLink +
    '\nVà trả lời email này với chữ "OK" để email nhắc việc không vào Spam.\n';
  MailApp.sendEmail({ to: member.email, subject, htmlBody: emailLayout_('Chào ' + escHtml_(member.name) + ',', inner), body: text, name: CONFIG.SENDER_NAME });
  if (kind !== 'reset') db_.update('email_confirm', 'member_id=eq.' + member.id, { sends: (conf.sends || 0) + 1, last_sent: new Date().toISOString() });
  return true;
}

function confirmStatus_(c) {
  if (!c) return 'chua_gui';
  if (c.filter_at || c.replied_at) return 'tin_cay';
  if (!c.sends) return 'chua_gui';
  if (c.clicked_at) return 'da_bam';
  return 'da_gui';
}

/** Admin bấm "Gửi lại" trên Dashboard */
function resendConfirmNow_(memberIds) {
  const members = db_.select('members', 'active=is.true&user_id=not.is.null&select=*');
  const confs = indexBy_(db_.select('email_confirm', 'select=*'), 'member_id');
  let n = 0;
  members.forEach(m => {
    if (memberIds && memberIds.length && memberIds.indexOf(m.id) < 0) return;
    const st = confirmStatus_(confs[m.id]);
    if (st === 'tin_cay') return;
    if (sendAccountEmail_(m, null, st === 'da_bam' ? 'nudge' : 'resend')) n++;
  });
  return n;
}

function confirmPage_(token) {
  let body;
  const rows = token ? db_.select('email_confirm', 'token=eq.' + enc_(token) + '&select=*,members(name)') : [];
  const sender = senderEmail_();
  if (!rows.length) {
    body = '<h2>Liên kết không hợp lệ</h2><p>Liên kết xác nhận đã hết hạn hoặc không đúng.</p>';
  } else {
    const c = rows[0];
    if (!c.clicked_at) db_.update('email_confirm', 'member_id=eq.' + c.member_id, { clicked_at: new Date().toISOString() });
    body = '<h2>✅ Cảm ơn ' + escHtml_(c.members ? c.members.name : '') + '!</h2>' +
      '<p>Bạn đã xác nhận nhận được email từ <b>' + escHtml_(sender) + '</b>.</p>' +
      '<h3>Còn 1 bước để email không vào Spam</h3>' +
      '<p><b>Cách nhanh nhất:</b> quay lại email vừa nhận và <b>trả lời với chữ "OK"</b>.</p>' +
      '<p><b>Hoặc tạo bộ lọc Gmail (30 giây):</b></p><ol>' +
      '<li>Mở <a target="_blank" href="https://mail.google.com/mail/u/0/#search/from%3A' + encodeURIComponent(sender) + '">Gmail – thư từ ' + escHtml_(sender) + '</a></li>' +
      '<li>Bấm biểu tượng <b>Hiện tùy chọn tìm kiếm</b> ở cuối ô tìm kiếm → <b>Tạo bộ lọc</b></li>' +
      '<li>Tích <b>"Không bao giờ gửi vào Thư rác"</b> → <b>Tạo bộ lọc</b></li></ol>' +
      '<p><a target="_blank" href="' + escHtml_(CONFIG.WEBSITE_URL) + '">👉 Mở trang PCCV</a></p>';
  }
  return HtmlService.createHtmlOutput('<div style="font-family:Arial,sans-serif;max-width:560px;margin:24px auto;padding:0 16px;line-height:1.6">' +
    body + '</div>').setTitle('Xác nhận email – NCP').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ============================ CHẠY MỖI SÁNG ============================ */

function runDaily() {
  checkProps_();
  safe_('Lưu địa chỉ gửi', () => setSetting_('sender_email', senderEmail_()));
  safe_('Kiểm tra email trả lời', checkReplies_);
  safe_('Kiểm tra quyền link sản phẩm', recheckLinks_);
  if (mailPaused_()) { console.log('Admin đang TẠM HOÃN gửi mail tự động – bỏ qua nhắc việc hôm nay.'); return; }
  safe_('Gửi lại email xác nhận', processConfirmations_);
  safe_('Gửi nhắc việc', sendReminders_);
  if (Number(Utilities.formatDate(new Date(), tz_(), 'u')) === CONFIG.LEAD_SUMMARY_WEEKDAY) safe_('Tổng hợp tuần', sendLeadSummaries_);
}

/** Admin bật "Tạm hoãn gửi mail tự động" trên Dashboard (Quản trị → Cài đặt). */
function mailPaused_() {
  const st = indexBy_(db_.select('settings', 'key=in.(mail_paused,mail_paused_until)&select=*'), 'key');
  if (!st.mail_paused || st.mail_paused.value !== true) return false;
  const until = st.mail_paused_until ? str_(st.mail_paused_until.value) : '';
  return !until || todayIso_() <= until;
}

function checkReplies_() {
  const members = db_.select('members', 'select=id,email');
  const byEmail = indexBy_(members, 'email');
  const confs = indexBy_(db_.select('email_confirm', 'select=*'), 'member_id');
  const me = senderEmail_().toLowerCase();
  const threads = GmailApp.search('subject:"' + CONFIG.ACCOUNT_SUBJECT + '" newer_than:180d', 0, 200);
  let n = 0;
  threads.forEach(th => th.getMessages().forEach(msg => {
    const from = extractEmail_(msg.getFrom());
    if (!from || from === me || !byEmail[from]) return;
    const id = byEmail[from].id;
    if (confs[id] && confs[id].replied_at) return;
    if (confs[id]) db_.update('email_confirm', 'member_id=eq.' + id, { replied_at: msg.getDate().toISOString() });
    else db_.insert('email_confirm', [{ member_id: id, replied_at: msg.getDate().toISOString() }]);
    confs[id] = { replied_at: true };
    n++;
  }));
  console.log('Phát hiện ' + n + ' người mới trả lời.');
}

function processConfirmations_() {
  const members = db_.select('members', 'active=is.true&user_id=not.is.null&select=*');
  const confs = indexBy_(db_.select('email_confirm', 'select=*'), 'member_id');
  members.forEach(m => {
    const c = confs[m.id];
    const st = confirmStatus_(c);
    if ((st === 'da_gui' || st === 'da_bam') && c.sends < CONFIG.CONFIRM_MAX_SENDS &&
      daysSince_(c.last_sent) >= CONFIG.CONFIRM_RESEND_AFTER_DAYS) {
      sendAccountEmail_(m, null, st === 'da_bam' ? 'nudge' : 'resend');
    }
  });
}

function loadAll_() {
  return {
    members: db_.select('members', 'active=is.true&user_id=not.is.null&select=*'),
    memberBans: db_.select('member_bans', 'select=*'),
    bans: db_.select('bans', 'select=*'),
    roles: db_.select('ban_roles', 'select=*'),
    events: db_.select('events', 'select=*'),
    tasks: db_.selectAll('tasks', 'status=neq.done&select=*'),
    parts: db_.selectAll('task_parts', 'select=*'),
    settings: indexBy_(db_.select('settings', 'select=*'), 'key'),
  };
}

function sendReminders_() {
  const d = loadAll_();
  const days = Number(d.settings.reminder_days ? d.settings.reminder_days.value : 1);
  const overdueMax = Number(d.settings.overdue_max_days ? d.settings.overdue_max_days.value : 7);
  const today = todayIso_();
  const members = indexBy_(d.members, 'id');
  const bans = indexBy_(d.bans, 'id');
  const roles = indexBy_(d.roles, 'id');
  const events = indexBy_(d.events, 'id');
  const tasks = indexBy_(d.tasks, 'id');
  const since = new Date(Date.now() - 120 * 86400000).toISOString();
  const sentKeys = {};
  db_.selectAll('reminder_log', 'sent_at=gte.' + enc_(since) + '&select=key').forEach(r => { sentKeys[r.key] = true; });

  const byMember = {};
  d.parts.forEach(p => {
    const t = tasks[p.task_id];
    if (!t || !p.deadline) return; // task đã hoàn thành sẽ không có trong danh sách
    if (p.status === 'done' && roles[p.role_id] && roles[p.role_id].has_status) return; // vai trò này đã xong phần mình
    const dl = diffDays_(today, p.deadline);
    let kind = null;
    if (dl >= 0 && dl <= days) kind = 'sap_den_han';
    else if (dl < 0 && -dl <= overdueMax) kind = 'qua_han';
    if (!kind) return;
    (p.assignee_ids || []).forEach(mid => {
      const m = members[mid];
      if (!m) return;
      const key = [p.id, p.deadline, kind, mid].join('|');
      if (sentKeys[key]) return;
      (byMember[mid] = byMember[mid] || []).push({
        key, kind, dl, deadline: p.deadline, task: t,
        ban: bans[t.ban_id] ? bans[t.ban_id].name : '', role: roles[p.role_id] ? roles[p.role_id].label : '',
        event: t.event_id && events[t.event_id] ? events[t.event_id].name : '',
      });
    });
  });

  let sent = 0;
  Object.keys(byMember).forEach(mid => {
    if (MailApp.getRemainingDailyQuota() < 1) return;
    const m = members[mid];
    const items = byMember[mid].sort((a, b) => a.dl - b.dl);
    const overdue = items.filter(x => x.kind === 'qua_han').length;
    const subject = '[NCP] Nhắc việc ' + Utilities.formatDate(new Date(), tz_(), 'dd/MM') + ': ' + items.length +
      ' việc cần chú ý' + (overdue ? ' (' + overdue + ' quá hạn)' : '');
    const rows = items.map(x => {
      const when = x.dl < 0 ? '<b style="color:#c0392b">Quá hạn ' + (-x.dl) + ' ngày</b>'
        : x.dl === 0 ? '<b style="color:#d35400">Hạn hôm nay</b>' : '<b style="color:#d35400">Còn ' + x.dl + ' ngày</b>';
      return '<tr><td style="padding:10px;border-bottom:1px solid #eee"><b>' + escHtml_(x.task.name) + '</b><br>' +
        '<span style="color:#666;font-size:13px">' + escHtml_([x.event, x.ban, x.role].filter(Boolean).join(' · ')) + '</span></td>' +
        '<td style="padding:10px;border-bottom:1px solid #eee;white-space:nowrap;text-align:right">' + isoToVn_(x.deadline) + '<br>' + when + '</td></tr>';
    }).join('');
    const html = emailLayout_('Chào ' + escHtml_(m.name) + ',',
      '<p>Bạn có <b>' + items.length + '</b> việc sắp đến hạn hoặc đã quá hạn:</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px">' + rows + '</table>' +
      button_(CONFIG.WEBSITE_URL, 'Mở trang PCCV') +
      '<p style="color:#666;font-size:13px">Làm xong rồi? Chuyển trạng thái sang "Hoàn thành" trên trang PCCV để không bị nhắc lại.</p>');
    const text = 'Chào ' + m.name + ',\n\nBạn có ' + items.length + ' việc cần chú ý:\n' +
      items.map(x => '- ' + x.task.name + ' (' + [x.event, x.ban, x.role].filter(Boolean).join(' · ') + ') – hạn ' + isoToVn_(x.deadline) +
        (x.dl < 0 ? ' – QUÁ HẠN ' + (-x.dl) + ' ngày' : '')).join('\n') + '\n\nTrang PCCV: ' + CONFIG.WEBSITE_URL + '\n';
    MailApp.sendEmail({ to: m.email, subject, htmlBody: html, body: text, name: CONFIG.SENDER_NAME });
    db_.insert('reminder_log', items.map(x => ({ key: x.key })), 'resolution=ignore-duplicates');
    sent++;
  });
  console.log('Đã gửi nhắc việc cho ' + sent + ' người.');
}

function sendLeadSummaries_() {
  const d = loadAll_();
  const today = todayIso_();
  const members = indexBy_(d.members, 'id');
  const events = indexBy_(d.events, 'id');
  d.bans.forEach(ban => {
    const leads = d.memberBans.filter(mb => mb.ban_id === ban.id && (mb.is_lead || mb.is_vice)).map(mb => members[mb.member_id]).filter(Boolean);
    if (!leads.length) return;
    const bt = d.tasks.filter(t => t.ban_id === ban.id);
    const partsOf = t => d.parts.filter(p => p.task_id === t.id);
    const overdue = bt.filter(t => partsOf(t).some(p => p.deadline && diffDays_(today, p.deadline) < 0));
    const unassigned = bt.filter(t => partsOf(t).some(p => p.deadline && !(p.assignee_ids || []).length && diffDays_(today, p.deadline) <= 14));
    if (!overdue.length && !unassigned.length) return;
    const list = arr => '<ul>' + arr.map(t => '<li><b>' + escHtml_(t.name) + '</b>' +
      (t.event_id && events[t.event_id] ? ' – ' + escHtml_(events[t.event_id].name) : '') + '</li>').join('') + '</ul>';
    let body = '<p>Tổng hợp tình hình <b>' + escHtml_(ban.name) + '</b> tuần này:</p>';
    if (overdue.length) body += '<h3 style="color:#c0392b">⏰ ' + overdue.length + ' việc quá hạn chưa hoàn thành</h3>' + list(overdue);
    if (unassigned.length) body += '<h3>👤 ' + unassigned.length + ' việc sắp đến hạn nhưng chưa có người phụ trách</h3>' + list(unassigned);
    leads.forEach(l => {
      if (MailApp.getRemainingDailyQuota() < 1) return;
      MailApp.sendEmail({
        to: l.email, name: CONFIG.SENDER_NAME, subject: '[NCP] Tổng hợp tuần – ' + ban.name,
        htmlBody: emailLayout_('Chào ' + escHtml_(l.name) + ',', body + button_(CONFIG.WEBSITE_URL, 'Mở trang PCCV')),
        body: ban.name + ': ' + overdue.length + ' việc quá hạn, ' + unassigned.length + ' việc chưa có người phụ trách. ' + CONFIG.WEBSITE_URL,
      });
    });
  });
}

/* ============================ SUPABASE ============================ */

function checkProps_() {
  const p = PropertiesService.getScriptProperties();
  const url = str_(p.getProperty('SUPABASE_URL')).replace(/\/+$/, '');
  const key = str_(p.getProperty('SUPABASE_SERVICE_KEY'));
  if (!url || !key) throw fail_('SETUP', 'Chưa đặt SUPABASE_URL và SUPABASE_SERVICE_KEY trong Cài đặt dự án → Thuộc tính tập lệnh.');
  return { url, key };
}

function sbFetch_(method, path, body, prefer) {
  const pr = checkProps_();
  const headers = { apikey: pr.key, Authorization: 'Bearer ' + pr.key };
  if (prefer) headers.Prefer = prefer;
  const opt = { method, headers, muteHttpExceptions: true };
  if (body !== undefined) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch(pr.url + path, opt);
  const code = res.getResponseCode();
  const txt = res.getContentText();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch (e) { /* không phải JSON */ }
  if (code >= 300) {
    const msg = (json && (json.msg || json.message || json.error_description || json.error)) || txt;
    if (/already.*registered|already exists|email_exists/i.test(msg)) throw fail_('INVALID', 'Email này đã có tài khoản đăng nhập trong Supabase.');
    throw fail_('DB', 'Lỗi Supabase (' + code + '): ' + msg);
  }
  return json;
}

const db_ = {
  select: (table, query) => sbFetch_('get', '/rest/v1/' + table + '?' + query) || [],
  selectAll: (table, query) => {
    let out = [], from = 0;
    while (true) {
      const pr = checkProps_();
      const res = UrlFetchApp.fetch(pr.url + '/rest/v1/' + table + '?' + query, {
        headers: { apikey: pr.key, Authorization: 'Bearer ' + pr.key, Range: from + '-' + (from + 999) }, muteHttpExceptions: true,
      });
      if (res.getResponseCode() >= 300) throw fail_('DB', 'Lỗi Supabase: ' + res.getContentText());
      const rows = JSON.parse(res.getContentText());
      out = out.concat(rows);
      if (rows.length < 1000) return out;
      from += 1000;
    }
  },
  insert: (table, rows, extraPrefer) => sbFetch_('post', '/rest/v1/' + table, rows,
    'return=representation' + (extraPrefer ? ',' + extraPrefer : '')) || [],
  update: (table, query, patch) => sbFetch_('patch', '/rest/v1/' + table + '?' + query, patch, 'return=representation'),
};

function authAdmin_(method, path, body) { return sbFetch_(method, '/auth/v1/admin' + path, body); }

function setSetting_(key, value) {
  sbFetch_('post', '/rest/v1/settings', [{ key, value }], 'resolution=merge-duplicates,return=minimal');
}

/* ============================ TIỆN ÍCH ============================ */

function emailLayout_(greeting, inner) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#222;line-height:1.55">' +
    '<div style="background:#1a56db;color:#fff;padding:14px 20px;border-radius:8px 8px 0 0;font-weight:bold">📋 ' +
    escHtml_(CONFIG.CLUB_NAME) + '</div><div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 8px 8px">' +
    '<p>' + greeting + '</p>' + inner + '</div>' +
    '<p style="color:#999;font-size:12px;text-align:center">Email tự động từ hệ thống phân công công việc ' +
    escHtml_(CONFIG.CLUB_NAME) + '. Muốn ngừng nhận, hãy liên hệ admin.</p></div>';
}
function button_(url, label) {
  return '<p style="margin:20px 0"><a href="' + escHtml_(url) + '" style="background:#1a56db;color:#fff;padding:10px 18px;' +
    'border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">' + escHtml_(label) + '</a></p>';
}
function senderEmail_() { return Session.getEffectiveUser().getEmail(); }
function webAppUrl_() { return ScriptApp.getService().getUrl(); }
function tz_() { return Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh'; }
function todayIso_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function isoToVn_(iso) { const p = String(iso).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
function diffDays_(a, b) {
  const x = a.split('-').map(Number), y = b.split('-').map(Number);
  return Math.round((Date.UTC(y[0], y[1] - 1, y[2]) - Date.UTC(x[0], x[1] - 1, x[2])) / 86400000);
}
function daysSince_(iso) { if (!iso) return 999; return (Date.now() - new Date(iso).getTime()) / 86400000; }
function indexBy_(arr, k) { const o = {}; (arr || []).forEach(x => { o[x[k]] = x; }); return o; }
function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function enc_(s) { return encodeURIComponent(s); }

/* ============================ KIỂM TRA QUYỀN LINK SẢN PHẨM ============================ */
// Kết quả: edit (ai có link đều sửa được) · club (chỉ tài khoản CLB sửa được) · view (chỉ xem)
//          private (tài khoản CLB không mở được) · edit_link (link chỉnh sửa Canva – Canva không cho kiểm tra quyền thật)
//          unknown (không nhận ra loại link)
function linkCheck_(url) {
  url = String(url || '').trim();
  if (!url) return { state: '', note: '' };
  const g = url.match(/docs\.google\.com\/(?:document|spreadsheets|presentation|forms|drawings)\/d\/([\w-]+)|drive\.google\.com\/(?:file\/d\/|drive\/folders\/|open\?id=)([\w-]+)/);
  if (g) return driveCheck_(g[1] || g[2], /\/folders\//.test(url));
  if (/(^https?:\/\/)?([\w-]+\.)?canva\.(com|link)\//i.test(url)) return canvaCheck_(url);
  return { state: 'unknown', note: 'Không phải link Google Docs/Drive hay Canva – không kiểm tra được' };
}

function driveCheck_(id, isFolder) {
  let f;
  try { f = isFolder ? DriveApp.getFolderById(id) : DriveApp.getFileById(id); f.getName(); }
  catch (e) { return { state: 'private', note: 'Tài khoản CLB không mở được file – chưa bật chia sẻ "Bất kỳ ai có đường liên kết"' }; }
  let access = null, perm = null;
  try { access = f.getSharingAccess(); perm = f.getSharingPermission(); } catch (e) { /* không đọc được cài đặt chia sẻ */ }
  const open = access === DriveApp.Access.ANYONE_WITH_LINK || access === DriveApp.Access.ANYONE;
  if (open && perm === DriveApp.Permission.EDIT) return { state: 'edit', note: 'Bất kỳ ai có link đều chỉnh sửa được' };
  const me = Session.getEffectiveUser().getEmail();
  let clubEdit = false;
  try { clubEdit = (f.getOwner() && f.getOwner().getEmail() === me) || f.getEditors().some((u) => u.getEmail() === me); } catch (e) { /* chỉ có quyền xem */ }
  if (clubEdit) return { state: 'club', note: 'Tài khoản CLB sửa được, nhưng người khác có link ' + (open ? 'chỉ xem/nhận xét được' : 'không mở được') };
  if (open) return { state: 'view', note: 'Người có link chỉ ' + (perm === DriveApp.Permission.COMMENT ? 'nhận xét' : 'xem') + ' được – chưa cấp quyền chỉnh sửa' };
  return { state: 'private', note: 'File chỉ chia sẻ riêng cho một số người – người khác có link không mở được' };
}

function canvaCheck_(url) {
  let u = url;
  for (let i = 0; i < 4 && /canva\.link\//i.test(u); i++) {
    try {
      const r = UrlFetchApp.fetch(u, { followRedirects: false, muteHttpExceptions: true });
      const h = r.getHeaders();
      const loc = h.Location || h.location;
      if (!loc) break;
      u = loc;
    } catch (e) { break; }
  }
  const path = u.split('?')[0];
  if (/\/design\/[\w-]+\/[\w-]+\/edit\/?$/i.test(path)) return { state: 'edit_link', note: 'Link chỉnh sửa Canva. Canva không cho kiểm tra quyền thật – hãy chắc chắn đã chọn "Bất kỳ ai có đường liên kết: Có thể chỉnh sửa".' };
  if (/\/design\/[\w-]+(\/[\w-]+)?\/(view|watch)\/?$/i.test(path)) return { state: 'view', note: 'Link Canva chỉ để xem – hãy gửi link "Chỉnh sửa" (Chia sẻ → Liên kết cộng tác).' };
  return { state: 'unknown', note: 'Không nhận ra dạng link Canva' };
}

function saveLinkCheck_(partId, res) {
  db_.update('task_parts', 'id=eq.' + enc_(partId), { link_check: res.state, link_check_note: res.note, link_checked_at: new Date().toISOString() });
}

function checkPartLink_(partId) {
  if (!partId) throw fail_('BAD_INPUT', 'Thiếu phần việc cần kiểm tra.');
  const part = db_.select('task_parts', 'id=eq.' + enc_(partId) + '&select=id,link')[0];
  if (!part) throw fail_('NOT_FOUND', 'Không tìm thấy phần việc này.');
  const res = linkCheck_(part.link);
  saveLinkCheck_(part.id, res);
  return res;
}

// Mỗi sáng: kiểm tra lại link của các việc chưa xong (người làm có thể đã đổi quyền chia sẻ)
function recheckLinks_() {
  const open = {};
  db_.selectAll('tasks', 'status=neq.done&select=id').forEach((t) => { open[t.id] = true; });
  const parts = db_.selectAll('task_parts', 'link=neq.&select=id,task_id,link').filter((p) => open[p.task_id]).slice(0, 150);
  parts.forEach((p) => { try { saveLinkCheck_(p.id, linkCheck_(p.link)); } catch (e) { console.error('Kiểm tra link lỗi: ' + p.link + ' – ' + e.message); } });
  console.log('Đã kiểm tra quyền ' + parts.length + ' link.');
}
function extractEmail_(from) { const m = String(from || '').match(/<([^>]+)>/); return (m ? m[1] : String(from || '')).trim().toLowerCase(); }
function escHtml_(s) { return str_(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fail_(code, message) { const e = new Error(message); e.code = code; return e; }
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw fail_('BUSY', 'Hệ thống đang bận, thử lại sau vài giây.');
  try { return fn(); } finally { lock.releaseLock(); }
}
function safe_(label, fn) { try { return fn(); } catch (err) { console.error(label + ': ' + (err && err.stack ? err.stack : err)); } }

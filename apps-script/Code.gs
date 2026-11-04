/**
 * NCP TeamTracking – Backend chạy trên Google Apps Script
 * ------------------------------------------------------------------
 * Dán toàn bộ file này vào Code.gs của Apps Script gắn với Google Sheet PCCV.
 * Sheet vẫn là nơi lưu dữ liệu; script này:
 *   1. Cung cấp API cho website (GitHub Pages) đọc/ghi công việc.
 *   2. Gửi email nhắc việc tổng hợp mỗi ngày.
 *   3. Gửi email xác nhận chống spam (bấm link + trả lời "OK") và theo dõi trạng thái.
 */

/* ======================= CẤU HÌNH – SỬA Ở ĐÂY ======================= */
const CONFIG = {
  // Client ID tạo trong Google Cloud Console (giống hệt giá trị trong docs/config.js)
  GOOGLE_CLIENT_ID: 'DAN_CLIENT_ID_VAO_DAY.apps.googleusercontent.com',
  // Địa chỉ website trên GitHub Pages (dùng cho link trong email)
  WEBSITE_URL: 'https://TEN-GITHUB.github.io/ncp-teamtracking/',
  // Để trống thì script tự lấy URL Web app đang deploy
  WEBAPP_URL: '',

  CLUB_NAME: 'NEU Career Path Club',
  SENDER_NAME: 'NCP TeamTracking',

  // Email có toàn quyền (quản trị). Ngoài ra ai có Chức vụ chứa ADMIN_TITLES cũng là quản trị.
  ADMIN_EMAILS: ['phandangduonga.ncp@gmail.com'],
  ADMIN_TITLES: ['Chủ nhiệm', 'Phó chủ nhiệm'],

  STATUSES: ['Chưa bắt đầu', 'Đang làm', 'Hoàn thành'],
  DONE_STATUS: 'Hoàn thành',

  REMINDER_HOUR: 8,              // giờ gửi nhắc việc hằng ngày
  OVERDUE_REMIND_MAX_DAYS: 7,    // chỉ nhắc việc quá hạn trong vòng 7 ngày (tránh nhắc mãi)
  LEAD_SUMMARY_WEEKDAY: 1,       // 1 = Thứ Hai: gửi tổng hợp cho trưởng ban

  AUTO_WELCOME_NEW_MEMBERS: true, // tự gửi email xác nhận cho thành viên mới được thêm vào sheet
  CONFIRM_RESEND_AFTER_DAYS: 3,
  CONFIRM_MAX_SENDS: 3,
  WELCOME_SUBJECT: '[NCP] Xác nhận nhận email nhắc việc',
};

const SHEETS = {
  MEMBERS: '👥 Danh sách thành viên',
  CONFIG: '⚙️ Cấu hình',
  CONFIRM: '📧 Xác nhận email',
  LOG: '_Nhật ký nhắc',
};
const NON_BAN_SHEETS = [SHEETS.MEMBERS, SHEETS.CONFIG, SHEETS.CONFIRM, SHEETS.LOG];

/**
 * Cấu trúc cột riêng cho từng Ban. Ban không khai báo ở đây sẽ được tự nhận diện:
 * mỗi cột "Người phụ trách <X>" ghép với cột "Deadline <X>" và cờ "Đã gửi NT <X>".
 */
const BAN_SCHEMAS = {
  'Ban Sự kiện': {
    roles: [
      { key: 'pt', label: 'Phụ trách', person: 'Người phụ trách', deadline: 'Ngày deadline', flag: 'Đã gửi nhắc nhở' },
    ],
  },
  'Ban Truyền thông': {
    roles: [
      { key: 'content', label: 'Content', person: 'Người phụ trách content', deadline: 'Deadline content', flag: 'Đã gửi NT content' },
      { key: 'design', label: 'Design', person: 'Người phụ trách design', deadline: 'Deadline kỹ thuật', flag: 'Đã gửi NT kỹ thuật' },
      { key: 'post', label: 'Đăng bài', person: 'Người phụ trách đăng bài', deadline: 'Deadline đăng bài', flag: 'Đã gửi NT đăng bài' },
    ],
  },
};

const CONFIRM_HEADERS = ['Email', 'Tên', 'Token', 'Số lần gửi', 'Gửi lần cuối', 'Bấm link lúc', 'Trả lời lúc', 'Tạo bộ lọc lúc'];

/* ============================ WEB API ============================ */

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
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">NCP TeamTracking API đang chạy. Mở website: <a href="' +
    escHtml_(CONFIG.WEBSITE_URL) + '">' + escHtml_(CONFIG.WEBSITE_URL) + '</a></p>');
}

function route_(me, action, p) {
  switch (action) {
    case 'bootstrap': return bootstrap_(me);
    case 'saveTask': return withLock_(() => saveTask_(me, p));
    case 'deleteTask': return withLock_(() => deleteTask_(me, p));
    case 'cloneEvent': return withLock_(() => cloneEvent_(me, p));
    case 'confirmations': return listConfirmations_(me);
    case 'sendWelcome': return withLock_(() => sendWelcomeApi_(me));
    case 'markFilter': return withLock_(() => markFilter_(me));
    default: throw fail_('BAD_ACTION', 'Hành động không hợp lệ: ' + action);
  }
}

/* ============================ XÁC THỰC ============================ */

function authenticate_(idToken) {
  if (!idToken) throw fail_('AUTH_REQUIRED', 'Bạn cần đăng nhập.');
  const cache = CacheService.getScriptCache();
  const ck = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken, Utilities.Charset.UTF_8));
  let email = cache.get(ck);
  if (!email) {
    const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw fail_('AUTH_EXPIRED', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
    const info = JSON.parse(res.getContentText());
    if (info.aud !== CONFIG.GOOGLE_CLIENT_ID) throw fail_('AUTH_INVALID', 'Token không dành cho ứng dụng này.');
    if (String(info.email_verified) !== 'true') throw fail_('AUTH_INVALID', 'Email chưa được Google xác minh.');
    email = String(info.email).toLowerCase();
    const ttl = Math.min(21600, Number(info.exp) - Math.floor(Date.now() / 1000) - 30);
    if (ttl > 60) cache.put(ck, email, ttl);
  }
  const ctx = loadContext_();
  const me = buildMe_(ctx, email);
  if (!me.member && !me.isAdmin) {
    throw fail_('NOT_MEMBER', 'Email ' + email + ' chưa có trong tab "' + SHEETS.MEMBERS +
      '". Hãy nhờ trưởng ban thêm bạn vào danh sách.');
  }
  return me;
}

function buildMe_(ctx, email) {
  const member = ctx.members.find(m => m.email === email) || null;
  const title = member ? member.title : '';
  const isAdmin = CONFIG.ADMIN_EMAILS.map(x => x.toLowerCase()).indexOf(email) >= 0 ||
    CONFIG.ADMIN_TITLES.some(t => title && nameKey_(title).indexOf(nameKey_(t)) >= 0);
  return {
    email,
    member,
    name: member ? member.name : email,
    nameKey: member ? nameKey_(member.name) : '',
    isAdmin,
    leadOf: member ? leadOfFor_(ctx, member) : [],
    ctx,
  };
}

/** "Trưởng Ban Truyền thông" -> ['Ban Truyền thông'] (hỗ trợ cả "Phó ban ...", nhiều chức vụ cách nhau dấu phẩy) */
function leadOfFor_(ctx, member) {
  const out = [];
  String(member.title || '').split(/[,;\n]/).forEach(part => {
    const m = nameKey_(part).match(/^(truong|pho)\s+(ban .+)$/);
    if (!m) return;
    const ban = ctx.banNames.find(b => nameKey_(b) === m[2]);
    if (ban && out.indexOf(ban) < 0) out.push(ban);
  });
  return out;
}

function canManage_(me, ban) { return me.isAdmin || me.leadOf.indexOf(ban) >= 0; }
function isLeadOfTask_(me, task) { return !!me.nameKey && splitPeople_(task.lead).some(n => nameKey_(n) === me.nameKey); }
function isAssignee_(me, task) {
  return !!me.nameKey && task.parts.some(p => p.people.some(n => nameKey_(n) === me.nameKey));
}

/* ============================ ĐỌC DỮ LIỆU ============================ */

function loadContext_() {
  const ss = SpreadsheetApp.getActive();
  const members = readMembers_(ss);
  const banNames = ss.getSheets().filter(isBanSheet_).map(s => s.getName());
  return { ss, members, banNames };
}

function readMembers_(ss) {
  const sh = ss.getSheetByName(SHEETS.MEMBERS);
  if (!sh) throw fail_('SETUP', 'Không tìm thấy tab "' + SHEETS.MEMBERS + '".');
  const v = sh.getDataRange().getValues();
  const h = v[0].map(x => String(x).trim());
  const ci = { name: h.indexOf('Tên thành viên'), ban: h.indexOf('Ban'), email: h.indexOf('Email'), title: h.indexOf('Chức vụ') };
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const name = str_(v[i][ci.name]);
    if (!name) continue;
    out.push({
      name,
      email: ci.email >= 0 ? str_(v[i][ci.email]).toLowerCase() : '',
      bans: ci.ban >= 0 ? splitPeople_(v[i][ci.ban]) : [],
      title: ci.title >= 0 ? str_(v[i][ci.title]) : '',
    });
  }
  return out;
}

function isBanSheet_(sh) {
  const name = sh.getName();
  if (NON_BAN_SHEETS.indexOf(name) >= 0 || name.charAt(0) === '_') return false;
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) return false;
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(x => String(x).trim());
  return headers.indexOf('Tên công việc') >= 0;
}

function getBanSheet_(ctx, ban) {
  const sh = ctx.ss.getSheetByName(ban);
  if (!sh || !isBanSheet_(sh)) throw fail_('NOT_FOUND', 'Không tìm thấy Ban "' + ban + '".');
  return sh;
}

function getSchema_(banName, headersRaw) {
  const h = headersRaw.map(x => String(x).trim());
  const col = name => (name ? h.indexOf(name) : -1);
  let roles = [];
  const ov = BAN_SCHEMAS[banName];
  if (ov) {
    roles = ov.roles.filter(r => col(r.person) >= 0).map(r => ({
      key: r.key, label: r.label, personCol: col(r.person), deadlineCol: col(r.deadline), flagCol: col(r.flag),
    }));
  } else {
    h.forEach((hd, i) => {
      const m = hd.match(/^Người phụ trách\s*(.*)$/i);
      if (!m) return;
      const suffix = m[1].trim();
      const sk = nameKey_(suffix);
      let dl = h.findIndex(x => /deadline/i.test(x) && nameKey_(x.replace(/^(ngày\s+)?deadline\s*/i, '')) === sk);
      if (dl < 0) dl = h.findIndex(x => /deadline/i.test(x));
      const flag = suffix ? col('Đã gửi NT ' + suffix) : col('Đã gửi nhắc nhở');
      roles.push({
        key: 'r' + i, label: suffix ? suffix.charAt(0).toUpperCase() + suffix.slice(1) : 'Phụ trách',
        personCol: i, deadlineCol: dl, flagCol: flag,
      });
    });
  }
  const core = {
    name: col('Tên công việc'), event: col('Tên sự kiện'), lead: col('Lead CV'),
    status: col('Trạng thái'), note: col('Ghi chú'),
  };
  const used = {};
  Object.keys(core).forEach(k => { if (core[k] >= 0) used[core[k]] = true; });
  roles.forEach(r => { [r.personCol, r.deadlineCol, r.flagCol].forEach(c => { if (c >= 0) used[c] = true; }); });
  const extras = [];
  h.forEach((hd, i) => {
    if (!hd || used[i] || /^Đã gửi/i.test(hd)) return;
    extras.push({ label: hd, col: i });
  });
  return { headers: h, roles, core, extras };
}

function publicBan_(me, name, schema) {
  return {
    name,
    roles: schema.roles.map(r => ({ key: r.key, label: r.label, hasDeadline: r.deadlineCol >= 0 })),
    extraFields: schema.extras.map(x => x.label),
    hasLead: schema.core.lead >= 0,
    hasNote: schema.core.note >= 0,
    canManage: canManage_(me, name),
  };
}

function readBan_(sh) {
  const range = sh.getDataRange();
  const values = range.getValues();
  const rich = range.getRichTextValues();
  const schema = getSchema_(sh.getName(), values[0]);
  const tasks = [];
  for (let r = 1; r < values.length; r++) {
    const t = rowToTask_(sh.getName(), schema, values[r], rich[r], r + 1);
    if (t) tasks.push(t);
  }
  return { schema, tasks };
}

function rowToTask_(ban, schema, row, richRow, rowNum) {
  const c = schema.core;
  const name = str_(row[c.name]);
  if (!name) return null;
  const get = i => (i >= 0 ? str_(row[i]) : '');
  const task = {
    id: ban + '#' + rowNum, ban, row: rowNum, name,
    event: get(c.event), lead: get(c.lead), status: get(c.status), note: get(c.note),
    parts: schema.roles.map(role => ({
      role: role.key,
      people: splitPeople_(row[role.personCol]),
      deadline: role.deadlineCol >= 0 ? toIso_(row[role.deadlineCol]) : '',
    })),
    extras: {},
  };
  schema.extras.forEach(ex => {
    const text = str_(row[ex.col]);
    let url = '';
    const rt = richRow && richRow[ex.col];
    if (rt) {
      url = rt.getLinkUrl() || '';
      if (!url) {
        const run = rt.getRuns().find(x => x.getLinkUrl());
        if (run) url = run.getLinkUrl();
      }
    }
    if (!url && /^https?:\/\//i.test(text)) url = text;
    task.extras[ex.label] = { text, url };
  });
  return task;
}

function readTaskAt_(sh, rowNum) {
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const schema = getSchema_(sh.getName(), headers);
  const rg = sh.getRange(rowNum, 1, 1, lastCol);
  return rowToTask_(sh.getName(), schema, rg.getValues()[0], rg.getRichTextValues()[0], rowNum);
}

function bootstrap_(me) {
  const ctx = me.ctx;
  const bans = [];
  let tasks = [];
  ctx.banNames.forEach(name => {
    const data = readBan_(ctx.ss.getSheetByName(name));
    bans.push(publicBan_(me, name, data.schema));
    tasks = tasks.concat(data.tasks);
  });
  const store = readConfirms_(ctx.ss);
  return {
    me: {
      name: me.name, email: me.email, bans: me.member ? me.member.bans : [],
      isAdmin: me.isAdmin, leadOf: me.leadOf,
      confirm: confirmStatus_(store.map[me.email]),
    },
    clubName: CONFIG.CLUB_NAME,
    senderEmail: Session.getEffectiveUser().getEmail(),
    statuses: CONFIG.STATUSES,
    doneStatus: CONFIG.DONE_STATUS,
    reminderDays: getReminderDays_(ctx.ss),
    members: ctx.members.map(m => ({ name: m.name, email: m.email, bans: m.bans, title: m.title })),
    bans,
    tasks,
  };
}

/* ============================ GHI DỮ LIỆU ============================ */

function saveTask_(me, p) {
  const sh = getBanSheet_(me.ctx, p.ban);
  const lastCol = sh.getLastColumn();
  const schema = getSchema_(p.ban, sh.getRange(1, 1, 1, lastCol).getValues()[0]);
  const c = schema.core;
  const t = p.task || {};
  const creating = !p.row;
  let rowNum = Number(p.row);
  let full;

  if (creating) {
    if (!canManage_(me, p.ban)) throw fail_('FORBIDDEN', 'Chỉ trưởng ban hoặc quản trị mới được thêm công việc.');
    rowNum = findAppendRow_(sh, c.name);
    full = true;
  } else {
    const current = readTaskAt_(sh, rowNum);
    if (!current || current.name !== str_(p.expectName)) {
      throw fail_('CONFLICT', 'Dòng này vừa bị người khác thay đổi trên Sheet. Hãy tải lại trang rồi thử lại.');
    }
    full = canManage_(me, p.ban) || isLeadOfTask_(me, current);
    if (!full && !isAssignee_(me, current)) throw fail_('FORBIDDEN', 'Bạn không có quyền sửa công việc này.');
  }

  const cell = i => sh.getRange(rowNum, i + 1);
  const set = (i, val) => { if (i >= 0) cell(i).setValue(val); };
  const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);

  if (full) {
    if (has(t, 'name')) {
      if (!str_(t.name)) throw fail_('INVALID', 'Tên công việc không được để trống.');
      set(c.name, str_(t.name));
    }
    if (has(t, 'event')) set(c.event, str_(t.event));
    if (has(t, 'lead')) set(c.lead, joinPeople_(t.lead));
    schema.roles.forEach(role => {
      const tp = t.parts && t.parts[role.key];
      if (!tp) return;
      if (has(tp, 'people')) set(role.personCol, joinPeople_(tp.people));
      if (has(tp, 'deadline') && role.deadlineCol >= 0) {
        const oldIso = creating ? '' : toIso_(cell(role.deadlineCol).getValue());
        const newIso = str_(tp.deadline);
        if (newIso && !/^\d{4}-\d{2}-\d{2}$/.test(newIso)) throw fail_('INVALID', 'Ngày deadline không hợp lệ.');
        if (oldIso !== newIso || creating) {
          const dc = cell(role.deadlineCol);
          if (newIso) { dc.setValue(isoToDate_(newIso)).setNumberFormat('dd/MM/yyyy'); } else { dc.clearContent(); }
          if (role.flagCol >= 0) cell(role.flagCol).setValue(false);
        }
      }
    });
  }
  if (has(t, 'status')) {
    const st = str_(t.status);
    if (st && CONFIG.STATUSES.indexOf(st) < 0) throw fail_('INVALID', 'Trạng thái không hợp lệ.');
    set(c.status, st);
  }
  if (has(t, 'note')) set(c.note, str_(t.note));
  if (t.extras) {
    const before = creating ? null : readTaskAt_(sh, rowNum);
    Object.keys(t.extras).forEach(label => {
      const ex = schema.extras.find(x => x.label === label);
      if (!ex) return;
      const val = str_(t.extras[label]);
      const cur = before && before.extras[label];
      // Không ghi đè ô có hyperlink (vd. chữ "Link") nếu người dùng không đổi gì
      if (cur && (val === cur.url || val === cur.text)) return;
      set(ex.col, val);
    });
  }
  if (creating) schema.roles.forEach(role => { if (role.flagCol >= 0) cell(role.flagCol).setValue(false); });
  SpreadsheetApp.flush();
  return readTaskAt_(sh, rowNum);
}

function deleteTask_(me, p) {
  const sh = getBanSheet_(me.ctx, p.ban);
  if (!canManage_(me, p.ban)) throw fail_('FORBIDDEN', 'Chỉ trưởng ban hoặc quản trị mới được xóa công việc.');
  const current = readTaskAt_(sh, Number(p.row));
  if (!current || current.name !== str_(p.expectName)) {
    throw fail_('CONFLICT', 'Dòng này vừa bị thay đổi trên Sheet. Hãy tải lại trang rồi thử lại.');
  }
  sh.deleteRow(Number(p.row));
  return { deleted: true };
}

/** Tạo sự kiện mới bằng cách sao chép danh sách công việc của một sự kiện cũ */
function cloneEvent_(me, p) {
  const sh = getBanSheet_(me.ctx, p.ban);
  if (!canManage_(me, p.ban)) throw fail_('FORBIDDEN', 'Chỉ trưởng ban hoặc quản trị mới được tạo sự kiện.');
  const toEvent = str_(p.toEvent);
  if (!toEvent) throw fail_('INVALID', 'Hãy nhập tên sự kiện mới.');
  const data = readBan_(sh);
  const schema = data.schema;
  if (data.tasks.some(t => nameKey_(t.event) === nameKey_(toEvent))) {
    throw fail_('INVALID', 'Sự kiện "' + toEvent + '" đã có trong ' + p.ban + '.');
  }
  const src = data.tasks.filter(t => t.event === str_(p.fromEvent));
  if (!src.length) throw fail_('INVALID', 'Sự kiện mẫu không có công việc nào.');
  const width = schema.headers.length;
  const rows = src.map(t => {
    const r = new Array(width).fill('');
    r[schema.core.name] = t.name;
    if (schema.core.event >= 0) r[schema.core.event] = toEvent;
    if (p.keepPeople && schema.core.lead >= 0) r[schema.core.lead] = t.lead;
    if (p.keepNotes && schema.core.note >= 0) r[schema.core.note] = t.note;
    schema.roles.forEach((role, i) => {
      if (p.keepPeople) r[role.personCol] = t.parts[i].people.join(', ');
      if (role.flagCol >= 0) r[role.flagCol] = false;
    });
    return r;
  });
  const start = findAppendRow_(sh, schema.core.name);
  if (start + rows.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), start + rows.length - 1 - sh.getMaxRows());
  sh.getRange(start, 1, rows.length, width).setValues(rows);
  return { created: rows.length };
}

function findAppendRow_(sh, nameCol) {
  const last = sh.getLastRow();
  if (last < 2) return 2;
  const v = sh.getRange(2, nameCol + 1, last - 1, 1).getValues();
  let lastFilled = 1;
  for (let i = v.length - 1; i >= 0; i--) { if (str_(v[i][0])) { lastFilled = i + 2; break; } }
  const row = lastFilled + 1;
  if (row > sh.getMaxRows()) sh.insertRowAfter(sh.getMaxRows());
  return row;
}

/* ============================ NHẮC VIỆC HẰNG NGÀY ============================ */

/** Hàm chạy theo lịch mỗi sáng (bật bằng menu ⏰). */
function runDaily() {
  const ctx = loadContext_();
  safe_('Kiểm tra email trả lời', () => checkReplies_(ctx));
  safe_('Gửi email xác nhận', () => processConfirmations_(ctx));
  safe_('Gửi nhắc việc', () => sendReminders_(ctx));
  if (Number(Utilities.formatDate(new Date(), tz_(), 'u')) === CONFIG.LEAD_SUMMARY_WEEKDAY) {
    safe_('Tổng hợp cho trưởng ban', () => sendLeadSummaries_(ctx));
  }
}

function sendReminders_(ctx) {
  const days = getReminderDays_(ctx.ss);
  const today = todayIso_();
  const log = logStore_(ctx.ss);
  const byEmail = {};
  const flagsToSet = [];

  ctx.banNames.forEach(ban => {
    const sh = ctx.ss.getSheetByName(ban);
    const data = readBan_(sh);
    data.tasks.forEach(t => {
      if (t.status === CONFIG.DONE_STATUS) return;
      t.parts.forEach((part, i) => {
        if (!part.deadline) return;
        const role = data.schema.roles[i];
        const dl = diffDays_(today, part.deadline);
        let kind = null;
        if (dl >= 0 && dl <= days) kind = 'sap_den_han';
        else if (dl < 0 && -dl <= CONFIG.OVERDUE_REMIND_MAX_DAYS) kind = 'qua_han';
        if (!kind) return;
        part.people.forEach(person => {
          const m = findMemberByName_(ctx.members, person);
          if (!m || !m.email) return;
          const key = [ban, t.name, t.event, role.key, part.deadline, kind, m.email].join('|');
          if (log.has(key)) return;
          (byEmail[m.email] = byEmail[m.email] || { member: m, items: [] }).items.push({
            key, kind, dl, ban, task: t, roleLabel: role.label, deadline: part.deadline,
          });
          if (kind === 'sap_den_han' && role.flagCol >= 0) flagsToSet.push({ sh, row: t.row, col: role.flagCol + 1 });
        });
      });
    });
  });

  let sent = 0;
  Object.keys(byEmail).forEach(email => {
    if (MailApp.getRemainingDailyQuota() < 1) { console.warn('Hết hạn mức gửi mail hôm nay'); return; }
    const { member, items } = byEmail[email];
    items.sort((a, b) => a.dl - b.dl);
    const mail = reminderEmail_(member, items);
    MailApp.sendEmail({ to: email, subject: mail.subject, htmlBody: mail.html, body: mail.text, name: CONFIG.SENDER_NAME });
    log.add(items.map(x => x.key));
    sent++;
  });
  flagsToSet.forEach(f => f.sh.getRange(f.row, f.col).setValue(true));
  console.log('Đã gửi nhắc việc cho ' + sent + ' người.');
  return sent;
}

function reminderEmail_(member, items) {
  const overdue = items.filter(x => x.kind === 'qua_han').length;
  const subject = '[NCP] Nhắc việc ' + Utilities.formatDate(new Date(), tz_(), 'dd/MM') + ': ' +
    items.length + ' việc cần chú ý' + (overdue ? ' (' + overdue + ' quá hạn)' : '');
  const rows = items.map(x => {
    const when = x.dl < 0 ? '<b style="color:#c0392b">Quá hạn ' + (-x.dl) + ' ngày</b>'
      : x.dl === 0 ? '<b style="color:#d35400">Hạn hôm nay</b>'
      : '<b style="color:#d35400">Còn ' + x.dl + ' ngày</b>';
    return '<tr><td style="padding:10px;border-bottom:1px solid #eee"><b>' + escHtml_(x.task.name) + '</b><br>' +
      '<span style="color:#666;font-size:13px">' + escHtml_([x.task.event, x.ban, x.roleLabel].filter(Boolean).join(' · ')) + '</span></td>' +
      '<td style="padding:10px;border-bottom:1px solid #eee;white-space:nowrap;text-align:right">' +
      escHtml_(isoToVn_(x.deadline)) + '<br>' + when + '</td></tr>';
  }).join('');
  const html = emailLayout_('Chào ' + escHtml_(member.name) + ',',
    '<p>Bạn có <b>' + items.length + '</b> việc sắp đến hạn hoặc đã quá hạn:</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px">' + rows + '</table>' +
    button_(CONFIG.WEBSITE_URL, 'Mở bảng công việc') +
    '<p style="color:#666;font-size:13px">Đã xong rồi? Hãy cập nhật trạng thái "' + CONFIG.DONE_STATUS +
    '" trên website để không nhận nhắc lại.</p>');
  const text = 'Chào ' + member.name + ',\n\nBạn có ' + items.length + ' việc cần chú ý:\n' +
    items.map(x => '- ' + x.task.name + ' (' + [x.task.event, x.ban, x.roleLabel].filter(Boolean).join(' · ') + ') – hạn ' +
      isoToVn_(x.deadline) + (x.dl < 0 ? ' – QUÁ HẠN ' + (-x.dl) + ' ngày' : '')).join('\n') +
    '\n\nMở bảng công việc: ' + CONFIG.WEBSITE_URL + '\n';
  return { subject, html, text };
}

/** Thứ Hai hằng tuần: gửi trưởng ban danh sách việc quá hạn, việc chưa có người, tên không khớp. */
function sendLeadSummaries_(ctx) {
  const today = todayIso_();
  ctx.banNames.forEach(ban => {
    const leads = ctx.members.filter(m => m.email && leadOfFor_(ctx, m).indexOf(ban) >= 0);
    if (!leads.length) return;
    const data = readBan_(ctx.ss.getSheetByName(ban));
    const overdue = [], unassigned = [], unknown = {};
    data.tasks.forEach(t => {
      t.parts.forEach(p => p.people.forEach(n => { if (!findMemberByName_(ctx.members, n)) unknown[n] = true; }));
      if (t.status === CONFIG.DONE_STATUS) return;
      const late = t.parts.filter(p => p.deadline && diffDays_(today, p.deadline) < 0);
      if (late.length) overdue.push(t);
      const soonEmpty = t.parts.some(p => p.deadline && !p.people.length && diffDays_(today, p.deadline) <= 14);
      if (soonEmpty) unassigned.push(t);
    });
    const unknownNames = Object.keys(unknown);
    if (!overdue.length && !unassigned.length && !unknownNames.length) return;
    const list = arr => '<ul>' + arr.map(t => '<li><b>' + escHtml_(t.name) + '</b> – ' + escHtml_(t.event) + '</li>').join('') + '</ul>';
    let body = '';
    if (overdue.length) body += '<h3 style="color:#c0392b">⏰ ' + overdue.length + ' việc quá hạn chưa hoàn thành</h3>' + list(overdue);
    if (unassigned.length) body += '<h3>👤 ' + unassigned.length + ' việc sắp đến hạn nhưng chưa có người phụ trách</h3>' + list(unassigned);
    if (unknownNames.length) body += '<h3>❓ Tên chưa khớp với danh sách thành viên (sẽ không được nhắc)</h3><p>' +
      unknownNames.map(escHtml_).join(', ') + '</p>';
    leads.forEach(l => {
      if (MailApp.getRemainingDailyQuota() < 1) return;
      MailApp.sendEmail({
        to: l.email, name: CONFIG.SENDER_NAME,
        subject: '[NCP] Tổng hợp tuần – ' + ban,
        htmlBody: emailLayout_('Chào ' + escHtml_(l.name) + ',', '<p>Tổng hợp tình hình <b>' + escHtml_(ban) + '</b> tuần này:</p>' +
          body + button_(CONFIG.WEBSITE_URL, 'Mở bảng công việc')),
        body: 'Tổng hợp tình hình ' + ban + ': ' + overdue.length + ' việc quá hạn, ' + unassigned.length +
          ' việc chưa có người phụ trách. Xem tại ' + CONFIG.WEBSITE_URL,
      });
    });
  });
}

/* ============================ XÁC NHẬN CHỐNG SPAM ============================ */

function confirmSheet_(ss) {
  let sh = ss.getSheetByName(SHEETS.CONFIRM);
  if (!sh) {
    sh = ss.insertSheet(SHEETS.CONFIRM);
    sh.getRange(1, 1, 1, CONFIRM_HEADERS.length).setValues([CONFIRM_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readConfirms_(ss) {
  const sh = confirmSheet_(ss);
  const v = sh.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < v.length; i++) {
    const email = str_(v[i][0]).toLowerCase();
    if (!email) continue;
    map[email] = {
      row: i + 1, email, name: v[i][1], token: str_(v[i][2]), sends: Number(v[i][3]) || 0,
      lastSent: v[i][4] || null, clicked: v[i][5] || null, replied: v[i][6] || null, filter: v[i][7] || null,
    };
  }
  return { sh, map };
}

function ensureConfirmRow_(store, member) {
  let c = store.map[member.email];
  if (!c) {
    const row = store.sh.getLastRow() + 1;
    c = { row, email: member.email, name: member.name, token: Utilities.getUuid(), sends: 0, lastSent: null, clicked: null, replied: null, filter: null };
    store.sh.getRange(row, 1, 1, CONFIRM_HEADERS.length).setValues([[c.email, c.name, c.token, 0, '', '', '', '']]);
    store.map[c.email] = c;
  }
  if (!c.token) { c.token = Utilities.getUuid(); store.sh.getRange(c.row, 3).setValue(c.token); }
  return c;
}

function setConfirm_(store, c, field, value) {
  const col = { sends: 4, lastSent: 5, clicked: 6, replied: 7, filter: 8 }[field];
  c[field] = value;
  store.sh.getRange(c.row, col).setValue(value);
}

/** tin_cay = đã trả lời hoặc đã tạo bộ lọc; da_bam = chỉ bấm link; da_gui = chưa phản hồi; chua_gui */
function confirmStatus_(c) {
  if (!c) return 'chua_gui';
  if (c.filter || c.replied) return 'tin_cay';
  if (!c.sends) return 'chua_gui';
  if (c.clicked) return 'da_bam';
  return 'da_gui';
}

function sendConfirmEmail_(store, member, kind) {
  const c = ensureConfirmRow_(store, member);
  const link = webAppUrl_() + '?action=confirm&t=' + encodeURIComponent(c.token);
  const sender = Session.getEffectiveUser().getEmail();
  let intro;
  if (kind === 'nudge') {
    intro = '<p>Cảm ơn bạn đã xác nhận! Chỉ còn <b>một bước nhỏ</b>: hãy <b>trả lời email này với chữ "OK"</b>. ' +
      'Khi bạn trả lời, Gmail sẽ coi địa chỉ này là người quen và email nhắc việc sau sẽ không bị vào Spam.</p>';
  } else {
    intro = (kind === 'resend' ? '<p><i>Có thể bạn chưa thấy email trước của mình, nên mình gửi lại nhé.</i></p>' : '') +
      '<p>Bạn đã được thêm vào hệ thống phân công công việc của <b>' + escHtml_(CONFIG.CLUB_NAME) + '</b>. ' +
      'Từ nay, email nhắc deadline sẽ được gửi từ địa chỉ <b>' + escHtml_(sender) + '</b>.</p>' +
      '<p>Để email nhắc việc <b>không bị vào Spam</b>, bạn giúp mình 2 bước:</p>' +
      '<p><b>Bước 1:</b> Bấm nút bên dưới</p>' + button_(link, '✅ Tôi đã nhận được email') +
      '<p><b>Bước 2 (quan trọng):</b> <b>Trả lời email này với chữ "OK"</b>.</p>' +
      '<p style="color:#666;font-size:13px">Nếu email này nằm trong mục Spam, hãy bấm <b>"Báo cáo không phải là thư rác"</b>. ' +
      'Bạn cũng có thể mở website và bấm <b>"Chống spam"</b> để tự động tạo bộ lọc Gmail.</p>';
  }
  const html = emailLayout_('Chào ' + escHtml_(member.name) + ',', intro);
  const text = 'Chào ' + member.name + ',\n\nBạn đã được thêm vào hệ thống nhắc việc của ' + CONFIG.CLUB_NAME + '.\n' +
    'Bước 1: Mở link để xác nhận: ' + link + '\nBước 2: Trả lời email này với chữ "OK" để email nhắc việc không bị vào Spam.\n';
  MailApp.sendEmail({ to: member.email, subject: CONFIG.WELCOME_SUBJECT, htmlBody: html, body: text, name: CONFIG.SENDER_NAME });
  setConfirm_(store, c, 'sends', c.sends + 1);
  setConfirm_(store, c, 'lastSent', new Date());
}

/** Đọc hộp thư của tài khoản gửi: ai đã trả lời email xác nhận thì đánh dấu "Đã trả lời". */
function checkReplies_(ctx) {
  const store = readConfirms_(ctx.ss);
  const myEmail = Session.getEffectiveUser().getEmail().toLowerCase();
  const threads = GmailApp.search('subject:"' + CONFIG.WELCOME_SUBJECT + '" newer_than:180d', 0, 200);
  let n = 0;
  threads.forEach(th => th.getMessages().forEach(msg => {
    const from = extractEmail_(msg.getFrom());
    if (!from || from === myEmail) return;
    const member = ctx.members.find(m => m.email === from);
    if (!member) return;
    const c = ensureConfirmRow_(store, member);
    if (!c.replied) { setConfirm_(store, c, 'replied', msg.getDate()); n++; }
  }));
  return n;
}

function processConfirmations_(ctx) {
  const store = readConfirms_(ctx.ss);
  ctx.members.forEach(m => {
    if (!m.email || MailApp.getRemainingDailyQuota() < 1) return;
    const c = store.map[m.email];
    const st = confirmStatus_(c);
    if (st === 'chua_gui') {
      if (CONFIG.AUTO_WELCOME_NEW_MEMBERS) sendConfirmEmail_(store, m, 'welcome');
    } else if ((st === 'da_gui' || st === 'da_bam') && c.sends < CONFIG.CONFIRM_MAX_SENDS &&
      daysSince_(c.lastSent) >= CONFIG.CONFIRM_RESEND_AFTER_DAYS) {
      sendConfirmEmail_(store, m, st === 'da_bam' ? 'nudge' : 'resend');
    }
  });
}

function sendWelcomeToNew_(ctx) {
  const store = readConfirms_(ctx.ss);
  let n = 0;
  ctx.members.forEach(m => {
    if (!m.email || MailApp.getRemainingDailyQuota() < 1) return;
    if (confirmStatus_(store.map[m.email]) === 'chua_gui') { sendConfirmEmail_(store, m, 'welcome'); n++; }
  });
  return n;
}

function sendWelcomeApi_(me) {
  if (!me.isAdmin && !me.leadOf.length) throw fail_('FORBIDDEN', 'Chỉ trưởng ban hoặc quản trị mới gửi được.');
  return { sent: sendWelcomeToNew_(me.ctx) };
}

function listConfirmations_(me) {
  if (!me.isAdmin && !me.leadOf.length) throw fail_('FORBIDDEN', 'Chỉ trưởng ban hoặc quản trị mới xem được.');
  const store = readConfirms_(me.ctx.ss);
  return me.ctx.members.map(m => {
    const c = store.map[m.email];
    return {
      name: m.name, email: m.email, bans: m.bans, status: confirmStatus_(c),
      sends: c ? c.sends : 0, lastSent: c && c.lastSent ? toIsoDateTime_(c.lastSent) : '',
      clicked: !!(c && c.clicked), replied: !!(c && c.replied), filter: !!(c && c.filter),
    };
  });
}

function markFilter_(me) {
  if (!me.member || !me.member.email) throw fail_('NOT_MEMBER', 'Bạn chưa có trong danh sách thành viên.');
  const store = readConfirms_(me.ctx.ss);
  const c = ensureConfirmRow_(store, me.member);
  if (!c.filter) setConfirm_(store, c, 'filter', new Date());
  return { status: confirmStatus_(c) };
}

function confirmPage_(token) {
  const ss = SpreadsheetApp.getActive();
  const store = readConfirms_(ss);
  const c = Object.keys(store.map).map(k => store.map[k]).find(x => token && x.token === token);
  const sender = Session.getEffectiveUser().getEmail();
  let body;
  if (!c) {
    body = '<h2>Liên kết không hợp lệ</h2><p>Liên kết xác nhận đã hết hạn hoặc không đúng.</p>';
  } else {
    if (!c.clicked) setConfirm_(store, c, 'clicked', new Date());
    body = '<h2>✅ Cảm ơn ' + escHtml_(c.name) + '!</h2>' +
      '<p>Bạn đã xác nhận nhận được email từ <b>' + escHtml_(sender) + '</b>.</p>' +
      '<h3>Còn 1 bước để email không vào Spam</h3>' +
      '<p><b>Cách nhanh nhất:</b> quay lại email vừa nhận và <b>trả lời với chữ "OK"</b>.</p>' +
      '<p><b>Hoặc tự tạo bộ lọc Gmail (30 giây):</b></p><ol>' +
      '<li>Mở <a target="_blank" href="https://mail.google.com/mail/u/0/#search/from%3A' + encodeURIComponent(sender) + '">Gmail – tìm thư từ ' + escHtml_(sender) + '</a></li>' +
      '<li>Bấm biểu tượng <b>Hiện tùy chọn tìm kiếm</b> (☰ ở cuối ô tìm kiếm) → <b>Tạo bộ lọc</b></li>' +
      '<li>Tích <b>"Không bao giờ gửi vào Thư rác"</b> → <b>Tạo bộ lọc</b></li></ol>' +
      '<p><a target="_blank" href="' + escHtml_(CONFIG.WEBSITE_URL) + '">👉 Mở website quản lý công việc</a></p>';
  }
  return HtmlService.createHtmlOutput('<div style="font-family:Arial,sans-serif;max-width:560px;margin:24px auto;padding:0 16px;line-height:1.6">' +
    body + '</div>').setTitle('Xác nhận email – NCP').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ============================ MENU TRONG SHEET ============================ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('📋 TeamTracking')
    .addItem('⏰ Bật nhắc việc tự động hằng ngày', 'setupDailyTrigger')
    .addItem('▶️ Chạy nhắc việc ngay (thử)', 'runDaily')
    .addItem('📧 Gửi email xác nhận cho người chưa nhận', 'menuSendWelcome')
    .addSeparator()
    .addItem('➕ Tạo Ban mới', 'createBan')
    .addToUi();
}

function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'runDaily').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runDaily').timeBased().everyDays(1).atHour(CONFIG.REMINDER_HOUR).create();
  SpreadsheetApp.getUi().alert('Đã bật! Hệ thống sẽ gửi nhắc việc mỗi ngày khoảng ' + CONFIG.REMINDER_HOUR + 'h–' + (CONFIG.REMINDER_HOUR + 1) + 'h sáng.');
}

function menuSendWelcome() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Gửi email xác nhận cho tất cả thành viên chưa nhận?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const n = sendWelcomeToNew_(loadContext_());
  ui.alert('Đã gửi ' + n + ' email xác nhận.');
}

function createBan() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Tạo Ban mới', 'Nhập tên Ban (vd: Ban Nhân sự):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const name = str_(res.getResponseText());
  if (!name) return;
  const ss = SpreadsheetApp.getActive();
  if (ss.getSheetByName(name)) { ui.alert('Đã có tab "' + name + '".'); return; }
  const sh = ss.insertSheet(name);
  const headers = ['Tên công việc', 'Tên sự kiện', 'Người phụ trách', 'Lead CV', 'Ngày deadline', 'Trạng thái', 'Ghi chú', 'Link sản phẩm', 'Đã gửi nhắc nhở'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e8f0fe');
  sh.setFrozenRows(1);
  sh.getRange(2, 6, sh.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(CONFIG.STATUSES, true).setAllowInvalid(true).build());
  sh.getRange(2, 5, sh.getMaxRows() - 1, 1).setNumberFormat('dd/MM/yyyy');
  sh.hideColumns(headers.length);
  ui.alert('Đã tạo "' + name + '". Website sẽ tự hiện Ban này. Nhớ ghi "Trưởng ' + name + '" vào cột Chức vụ của trưởng ban.');
}

/** Sửa deadline trực tiếp trên Sheet → tự reset cờ "Đã gửi nhắc nhở" của dòng đó. */
function onEdit(e) {
  try {
    const sh = e.range.getSheet();
    if (!isBanSheet_(sh) || e.range.getLastRow() < 2) return;
    const schema = getSchema_(sh.getName(), sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
    const start = Math.max(2, e.range.getRow());
    const count = e.range.getLastRow() - start + 1;
    for (let col = e.range.getColumn(); col <= e.range.getLastColumn(); col++) {
      const role = schema.roles.find(r => r.deadlineCol === col - 1);
      if (role && role.flagCol >= 0) sh.getRange(start, role.flagCol + 1, count, 1).setValue(false);
    }
  } catch (err) { /* bỏ qua */ }
}

/* ============================ NHẬT KÝ NHẮC (chống gửi trùng) ============================ */

function logStore_(ss) {
  let sh = ss.getSheetByName(SHEETS.LOG);
  if (!sh) {
    sh = ss.insertSheet(SHEETS.LOG);
    sh.getRange(1, 1, 1, 2).setValues([['Khóa', 'Thời gian']]);
    sh.hideSheet();
  }
  const last = sh.getLastRow();
  const keys = {};
  if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach(r => { keys[r[0]] = true; });
  return {
    has: k => !!keys[k],
    add: arr => {
      if (!arr.length) return;
      const now = new Date();
      sh.getRange(sh.getLastRow() + 1, 1, arr.length, 2).setValues(arr.map(k => [k, now]));
      arr.forEach(k => { keys[k] = true; });
    },
  };
}

/* ============================ TIỆN ÍCH ============================ */

function getReminderDays_(ss) {
  const sh = ss.getSheetByName(SHEETS.CONFIG);
  if (!sh) return 1;
  const v = sh.getDataRange().getValues();
  for (let i = 0; i < v.length; i++) {
    if (/số ngày nhắc/i.test(String(v[i][0]))) {
      const n = Number(v[i][1]);
      return isNaN(n) ? 1 : n;
    }
  }
  return 1;
}

function emailLayout_(greeting, inner) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#222;line-height:1.55">' +
    '<div style="background:#1a56db;color:#fff;padding:14px 20px;border-radius:8px 8px 0 0;font-weight:bold">📋 ' +
    escHtml_(CONFIG.CLUB_NAME) + '</div><div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 8px 8px">' +
    '<p>' + greeting + '</p>' + inner + '</div>' +
    '<p style="color:#999;font-size:12px;text-align:center">Email tự động từ hệ thống phân công công việc ' +
    escHtml_(CONFIG.CLUB_NAME) + '. Muốn ngừng nhận, hãy liên hệ trưởng ban.</p></div>';
}

function button_(url, label) {
  return '<p style="margin:20px 0"><a href="' + escHtml_(url) + '" style="background:#1a56db;color:#fff;padding:10px 18px;' +
    'border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">' + escHtml_(label) + '</a></p>';
}

function webAppUrl_() { return CONFIG.WEBAPP_URL || ScriptApp.getService().getUrl(); }
function tz_() { return Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh'; }
function todayIso_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }

function toIso_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  const s = str_(v);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return '';
}
function toIsoDateTime_(v) { return v instanceof Date ? Utilities.formatDate(v, tz_(), "yyyy-MM-dd'T'HH:mm") : str_(v); }
function isoToDate_(iso) { const p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function isoToVn_(iso) { const p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
function diffDays_(fromIso, toIso) {
  const a = fromIso.split('-').map(Number), b = toIso.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}
function daysSince_(d) { if (!(d instanceof Date)) return 999; return (Date.now() - d.getTime()) / 86400000; }
function pad2_(n) { return ('0' + n).slice(-2); }
function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function splitPeople_(v) { return str_(v).split(/[,;\n]/).map(s => s.trim()).filter(Boolean); }
function joinPeople_(v) { return Array.isArray(v) ? v.map(str_).filter(Boolean).join(', ') : str_(v); }

/** Chuẩn hóa tên để so khớp: bỏ dấu, chữ thường ("Thuỳ" và "Thùy" được coi là một). */
function nameKey_(s) {
  return str_(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ');
}
function findMemberByName_(members, name) {
  const exact = members.find(m => m.name === name);
  if (exact) return exact;
  const k = nameKey_(name);
  return members.find(m => nameKey_(m.name) === k) || null;
}
function extractEmail_(from) {
  const m = String(from || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(from || '')).trim().toLowerCase();
}
function escHtml_(s) {
  return str_(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fail_(code, message) { const e = new Error(message); e.code = code; return e; }
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw fail_('BUSY', 'Hệ thống đang bận, thử lại sau vài giây.');
  try { return fn(); } finally { lock.releaseLock(); }
}
function safe_(label, fn) {
  try { return fn(); } catch (err) { console.error(label + ': ' + (err && err.stack ? err.stack : err)); }
}

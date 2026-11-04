// Dữ liệu mẫu cho CHẾ ĐỘ DEMO (chỉ dùng khi config.js chưa có API_URL).
// Tên người là tên giả, không phải thành viên thật.
(function () {
  const iso = (offset) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const SK = 'Ban Sự kiện', TT = 'Ban Truyền thông';
  const members = [
    { name: 'Nguyễn Minh An', email: 'an@example.com', bans: [SK, TT], title: 'Chủ nhiệm' },
    { name: 'Trần Thu Hà', email: 'ha@example.com', bans: [SK], title: 'Trưởng Ban Sự kiện' },
    { name: 'Lê Hoàng Nam', email: 'nam@example.com', bans: [TT], title: 'Trưởng Ban Truyền thông' },
    { name: 'Phạm Bảo Ngọc', email: 'ngoc@example.com', bans: [SK], title: '' },
    { name: 'Vũ Đức Huy', email: 'huy@example.com', bans: [SK], title: '' },
    { name: 'Đỗ Khánh Linh', email: 'linh@example.com', bans: [TT], title: '' },
    { name: 'Hoàng Gia Bảo', email: 'bao@example.com', bans: [TT], title: '' },
    { name: 'Bùi Mai Anh', email: 'maianh@example.com', bans: [TT], title: '' },
    { name: 'Ngô Thảo Vy', email: 'vy@example.com', bans: [SK], title: '' },
  ];
  const bansSchema = [
    { name: SK, roles: [{ key: 'pt', label: 'Phụ trách', hasDeadline: true }], extraFields: ['Tham khảo', 'Link Sản phẩm'], hasLead: true, hasNote: true },
    {
      name: TT, roles: [
        { key: 'content', label: 'Content', hasDeadline: true },
        { key: 'design', label: 'Design', hasDeadline: true },
        { key: 'post', label: 'Đăng bài', hasDeadline: true },
      ], extraFields: ['Link content', 'Link design'], hasLead: true, hasNote: true,
    },
  ];
  let rowSeq = { [SK]: 1, [TT]: 1 };
  const tasks = [];
  const sk = (name, event, people, lead, dl, status, note, extras) => {
    const row = ++rowSeq[SK];
    tasks.push({ id: SK + '#' + row, ban: SK, row, name, event, lead: lead || '', status: status || '', note: note || '',
      parts: [{ role: 'pt', people, deadline: dl === null ? '' : iso(dl) }],
      extras: Object.assign({ 'Tham khảo': { text: '', url: '' }, 'Link Sản phẩm': { text: '', url: '' } }, extras || {}) });
  };
  const tt = (name, event, c, d, p, lead, dls, status, note) => {
    const row = ++rowSeq[TT];
    const mk = (role, people, off) => ({ role, people, deadline: off === null || off === undefined ? '' : iso(off) });
    tasks.push({ id: TT + '#' + row, ban: TT, row, name, event, lead: lead || '', status: status || '', note: note || '',
      parts: [mk('content', c, dls[0]), mk('design', d, dls[1]), mk('post', p, dls[2])],
      extras: { 'Link content': { text: '', url: '' }, 'Link design': { text: '', url: '' } } });
  };
  const E1 = 'CHUYỆN NGHỀ MARKETING', E2 = 'CHUYỆN NGHỀ KIỂM TOÁN';
  sk('Hồ sơ hợp tác diễn giả', E1, ['Nguyễn Minh An'], '', -10, 'Hoàn thành');
  sk('MC', E1, ['Phạm Bảo Ngọc'], '', -6, 'Hoàn thành');
  sk('Lập form đăng ký', E1, ['Vũ Đức Huy'], 'Trần Thu Hà', -9, 'Hoàn thành', 'Lấy form tháng trước, sửa lại', { 'Link Sản phẩm': { text: 'Form', url: 'https://example.com/form' } });
  sk('Làm slide', E1, ['Ngô Thảo Vy', 'Phạm Bảo Ngọc'], 'Ngô Thảo Vy', -2, 'Đang làm', 'SLIDE');
  sk('Script MC', E1, ['Vũ Đức Huy'], 'Ngô Thảo Vy', 1, 'Đang làm', 'SCRIPT');
  sk('In ấn, mua đồ', E1, ['Trần Thu Hà'], 'Trần Thu Hà', 2, 'Chưa bắt đầu', '- Certification / - Standee');
  sk('Chuẩn bị câu hỏi Q&A dự phòng', E1, ['Ngô Thảo Vy'], '', 3, '');
  sk('Hồ sơ hợp tác diễn giả', E2, ['Nguyễn Minh An'], '', 9, 'Đang làm');
  sk('MC', E2, [], '', 15, '');
  sk('Lập form đăng ký', E2, ['Vũ Đức Huy'], 'Trần Thu Hà', 11, 'Chưa bắt đầu');
  sk('Làm slide', E2, ['Ngô Thảo Vy'], 'Ngô Thảo Vy', null, '');
  tt('Design BND', E1, [], ['Bùi Mai Anh'], [], '', [null, -12, null], 'Hoàn thành', 'Chọn bộ nhận diện mới');
  tt('Bài mở đơn', E1, ['Đỗ Khánh Linh'], ['Hoàng Gia Bảo'], ['Nguyễn Minh An'], 'Đỗ Khánh Linh', [-11, -10, -10], 'Hoàn thành');
  tt('Bài giới thiệu diễn giả', E1, ['Bùi Mai Anh'], ['Hoàng Gia Bảo'], ['Lê Hoàng Nam'], 'Lê Hoàng Nam', [-1, 0, 1], 'Đang làm', 'Background, thành tích diễn giả');
  tt('Bài chuyên môn 1', E1, ['Lê Hoàng Nam'], ['Đỗ Khánh Linh'], ['Bùi Mai Anh'], 'Lê Hoàng Nam', [1, 2, 3], 'Đang làm');
  tt('Bài đóng đơn', E1, ['Hoàng Gia Bảo'], ['Bùi Mai Anh'], ['Lê Hoàng Nam'], 'Đỗ Khánh Linh', [4, 5, 6], '');
  tt('Design BND', E2, [], ['Bùi Mai Anh'], [], '', [null, 8, null], '');
  tt('Bài mở đơn', E2, ['Đỗ Khánh Linh'], ['Hoàng Gia Bảo'], [], '', [9, 10, 12], '');

  const confirms = {};
  members.forEach((m, i) => { confirms[m.email] = ['tin_cay', 'tin_cay', 'da_bam', 'da_gui', 'tin_cay', 'chua_gui', 'da_bam', 'tin_cay', 'da_gui'][i]; });

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const key = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
  const fail = (msg) => { const e = new Error(msg); e.code = 'INVALID'; throw e; };

  function meFor(email) {
    const m = members.find((x) => x.email === email) || members[0];
    const leadOf = [];
    (m.title || '').split(',').forEach((t) => {
      const mm = key(t).match(/^(truong|pho)\s+(ban .+)$/);
      if (mm) { const b = bansSchema.find((x) => key(x.name) === mm[2]); if (b) leadOf.push(b.name); }
    });
    return { name: m.name, email: m.email, bans: m.bans, isAdmin: key(m.title).includes('chu nhiem'), leadOf, confirm: confirms[m.email] };
  }

  window.DemoApi = {
    members,
    async call(action, p, email) {
      await new Promise((r) => setTimeout(r, 150));
      const me = meFor(email);
      switch (action) {
        case 'bootstrap':
          return clone({
            me, clubName: 'NEU Career Path Club (demo)', senderEmail: 'nhacviec.demo@gmail.com',
            statuses: ['Chưa bắt đầu', 'Đang làm', 'Hoàn thành'], doneStatus: 'Hoàn thành', reminderDays: 1,
            members, tasks,
            bans: bansSchema.map((b) => Object.assign({}, b, { canManage: me.isAdmin || me.leadOf.includes(b.name) })),
          });
        case 'saveTask': {
          const b = bansSchema.find((x) => x.name === p.ban);
          let t;
          if (!p.row) {
            const row = ++rowSeq[p.ban];
            t = { id: p.ban + '#' + row, ban: p.ban, row, name: '', event: '', lead: '', status: '', note: '',
              parts: b.roles.map((r) => ({ role: r.key, people: [], deadline: '' })), extras: {} };
            b.extraFields.forEach((f) => { t.extras[f] = { text: '', url: '' }; });
            tasks.push(t);
          } else {
            t = tasks.find((x) => x.ban === p.ban && x.row === p.row);
          }
          const d = p.task;
          if ('name' in d) { if (!String(d.name).trim()) fail('Tên công việc không được để trống.'); t.name = d.name.trim(); }
          if ('event' in d) t.event = d.event;
          if ('lead' in d) t.lead = Array.isArray(d.lead) ? d.lead.join(', ') : d.lead;
          if ('status' in d) t.status = d.status;
          if ('note' in d) t.note = d.note;
          if (d.parts) t.parts.forEach((pt) => { const n = d.parts[pt.role]; if (n) { if (n.people) pt.people = n.people; if ('deadline' in n) pt.deadline = n.deadline; } });
          if (d.extras) Object.keys(d.extras).forEach((k) => { const v = d.extras[k]; t.extras[k] = { text: v, url: /^https?:/.test(v) ? v : '' }; });
          return clone(t);
        }
        case 'deleteTask': {
          const i = tasks.findIndex((x) => x.ban === p.ban && x.row === p.row);
          if (i >= 0) tasks.splice(i, 1);
          return { deleted: true };
        }
        case 'cloneEvent': {
          if (!p.toEvent) fail('Hãy nhập tên sự kiện mới.');
          if (tasks.some((t) => t.ban === p.ban && key(t.event) === key(p.toEvent))) fail('Sự kiện này đã có.');
          const src = tasks.filter((t) => t.ban === p.ban && t.event === p.fromEvent);
          src.forEach((s) => {
            const row = ++rowSeq[p.ban];
            const t = clone(s);
            Object.assign(t, { id: p.ban + '#' + row, row, event: p.toEvent, status: '', lead: p.keepPeople ? s.lead : '', note: p.keepNotes ? s.note : '' });
            t.parts.forEach((pt) => { pt.deadline = ''; if (!p.keepPeople) pt.people = []; });
            Object.keys(t.extras).forEach((k) => { t.extras[k] = { text: '', url: '' }; });
            tasks.push(t);
          });
          return { created: src.length };
        }
        case 'confirmations':
          return members.map((m) => ({ name: m.name, email: m.email, bans: m.bans, status: confirms[m.email],
            sends: confirms[m.email] === 'chua_gui' ? 0 : 1, lastSent: '', clicked: false, replied: confirms[m.email] === 'tin_cay', filter: false }));
        case 'sendWelcome': {
          let n = 0;
          members.forEach((m) => { if (confirms[m.email] === 'chua_gui') { confirms[m.email] = 'da_gui'; n++; } });
          return { sent: n };
        }
        case 'markFilter':
          confirms[me.email] = 'tin_cay';
          return { status: 'tin_cay' };
        default:
          fail('Hành động không hợp lệ');
      }
    },
  };
})();

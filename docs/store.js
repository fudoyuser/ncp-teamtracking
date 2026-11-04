// Lớp dữ liệu: SupabaseStore (thật) và DemoStore (dữ liệu mẫu trong trình duyệt).
// Cả hai có cùng các hàm nên app.js không cần biết đang chạy chế độ nào.
(function () {
  const CFG = window.APP_CONFIG || {};
  const err = (msg, code) => { const e = new Error(msg); e.code = code || 'ERROR'; return e; };

  /* ======================= chuyển đổi dòng DB ↔ đối tượng ======================= */
  const mapMember = (m, mbs) => ({
    id: m.id, userId: m.user_id, email: m.email, name: m.name, isAdmin: m.is_admin, active: m.active,
    mustChange: m.must_change_password, createdAt: m.created_at, fbName: m.fb_name || '', fbUrl: m.fb_url || '',
    bans: mbs.filter((x) => x.member_id === m.id).map((x) => ({ banId: x.ban_id, isLead: x.is_lead })),
  });
  const mapTask = (t, parts) => ({
    id: t.id, banId: t.ban_id, eventId: t.event_id, name: t.name, status: t.status, note: t.note || '',
    leadIds: t.lead_ids || [], links: Array.isArray(t.links) ? t.links : [], doneAt: t.done_at, createdAt: t.created_at,
    parts: parts.filter((p) => p.task_id === t.id).map((p) => ({ id: p.id, roleId: p.role_id, deadline: p.deadline || '', assigneeIds: p.assignee_ids || [] })),
  });
  const mapCampaign = (c) => ({ id: c.id, title: c.title, postUrl: c.post_url || '', actions: c.actions || [], deadline: c.deadline || '',
    memberIds: c.member_ids || [], banId: c.ban_id, createdBy: c.created_by, createdAt: c.created_at });
  const mapCheck = (x) => ({ campaignId: x.campaign_id, memberId: x.member_id, action: x.action, selfDone: x.self_done, proofUrl: x.proof_url || '', verified: x.verified || '' });
  const mapConfirm = (c) => ({ sends: c.sends, lastSent: c.last_sent, clicked: !!c.clicked_at, replied: !!c.replied_at, filter: !!c.filter_at });

  /* ======================= SUPABASE ======================= */
  function SupabaseStore() {
    const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    const q = async (p) => {
      const { data, error } = await p;
      if (error) throw err(translate(error.message), error.code);
      return data;
    };
    const translate = (m) => {
      if (/Invalid login credentials/i.test(m)) return 'Sai email hoặc mật khẩu.';
      if (/row-level security/i.test(m)) return 'Bạn không có quyền thực hiện thao tác này.';
      if (/violates foreign key.*tasks/i.test(m)) return 'Không xóa được vì vẫn còn công việc thuộc mục này.';
      if (/duplicate key.*events_name/i.test(m)) return 'Tên sự kiện đã tồn tại.';
      if (/duplicate key.*bans_name/i.test(m)) return 'Tên Ban đã tồn tại.';
      if (/JWT expired|invalid JWT/i.test(m)) return 'Phiên đăng nhập đã hết hạn.';
      if (/Password should be at least/i.test(m)) return 'Mật khẩu phải có ít nhất 6 ký tự.';
      if (/different from the old/i.test(m)) return 'Mật khẩu mới phải khác mật khẩu cũ.';
      return m;
    };
    const all = async (table, order) => {
      let out = [], from = 0;
      for (;;) {
        let query = sb.from(table).select('*').range(from, from + 999);
        if (order) query = query.order(order);
        const rows = await q(query);
        out = out.concat(rows);
        if (rows.length < 1000) return out;
        from += 1000;
      }
    };
    const script = async (action, payload) => {
      if (!CFG.APPS_SCRIPT_URL) throw err('Chưa cấu hình APPS_SCRIPT_URL trong config.js.');
      const { data: { session } } = await sb.auth.getSession();
      let res;
      try {
        res = await fetch(CFG.APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action, token: session && session.access_token, payload }) });
      } catch (e) { throw err('Không kết nối được máy chủ gửi mail (Apps Script).'); }
      const j = await res.json();
      if (!j.ok) throw err(j.message, j.error);
      return j.data;
    };
    let userId = null;

    return {
      demo: false,
      async init() {
        const { data: { session } } = await sb.auth.getSession();
        userId = session ? session.user.id : null;
        return !!session;
      },
      async signIn(email, password) {
        const data = await q(sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password }));
        userId = data.user.id;
      },
      async signOut() { await sb.auth.signOut(); userId = null; },
      async changePassword(pw) {
        await q(sb.auth.updateUser({ password: pw }));
        await q(sb.rpc('mark_password_changed'));
      },
      async loadAll() {
        const [bans, roles, members, mbs, events, tasks, parts, settings, confirms, campaigns, checks, scans] = await Promise.all([
          all('bans', 'sort'), all('ban_roles', 'sort'), all('members', 'name'), all('member_bans'),
          all('events'), all('tasks', 'created_at'), all('task_parts'), all('settings'), all('email_confirm'),
          all('seeding_campaigns', 'created_at'), all('seeding_checks'), all('seeding_scans', 'created_at'),
        ]);
        const meRow = members.find((m) => m.user_id === userId);
        if (!meRow || !meRow.active) throw err('Tài khoản của bạn chưa được cấp quyền hoặc đã bị khóa. Liên hệ admin.', 'NOT_MEMBER');
        const s = {};
        settings.forEach((x) => { s[x.key] = x.value; });
        const c = {};
        confirms.forEach((x) => { c[x.member_id] = mapConfirm(x); });
        return {
          bans: bans.map((b) => ({ id: b.id, name: b.name, sort: b.sort, roles: roles.filter((r) => r.ban_id === b.id).map((r) => ({ id: r.id, label: r.label, hasDeadline: r.has_deadline, sort: r.sort })) })),
          members: members.map((m) => mapMember(m, mbs)),
          events: events.map((e) => ({ id: e.id, name: e.name, date: e.event_date || '' })),
          tasks: tasks.map((t) => mapTask(t, parts)),
          settings: s, confirms: c, meId: meRow.id,
          campaigns: campaigns.map(mapCampaign).reverse(), checks: checks.map(mapCheck),
          scans: scans.map((x) => ({ campaignId: x.campaign_id, action: x.action, names: x.names || [], createdAt: x.created_at })),
        };
      },
      async saveTask(t, full) {
        let id = t.id;
        const row = { status: t.status, note: t.note, links: t.links };
        if (full) Object.assign(row, { ban_id: t.banId, event_id: t.eventId || null, name: t.name, lead_ids: t.leadIds });
        if (id) await q(sb.from('tasks').update(row).eq('id', id));
        else id = (await q(sb.from('tasks').insert(row).select('id').single())).id;
        if (full && t.parts) {
          await q(sb.from('task_parts').upsert(t.parts.map((p) => ({ task_id: id, role_id: p.roleId, deadline: p.deadline || null, assignee_ids: p.assigneeIds })), { onConflict: 'task_id,role_id' }));
        }
        const [tr, pr] = await Promise.all([q(sb.from('tasks').select('*').eq('id', id).single()), q(sb.from('task_parts').select('*').eq('task_id', id))]);
        return mapTask(tr, pr);
      },
      async deleteTask(id) { await q(sb.from('tasks').delete().eq('id', id)); },
      async cloneEvent(banId, fromEventId, toName, toDate, keepPeople, keepNotes) {
        return q(sb.rpc('clone_event', { p_ban: banId, p_from: fromEventId, p_to_name: toName, p_to_date: toDate || null, p_keep_people: keepPeople, p_keep_notes: keepNotes }));
      },
      async saveEvent(e) {
        const row = { name: e.name.trim(), event_date: e.date || null };
        const r = e.id ? await q(sb.from('events').update(row).eq('id', e.id).select().single()) : await q(sb.from('events').insert(row).select().single());
        return { id: r.id, name: r.name, date: r.event_date || '' };
      },
      async deleteEvent(id) { await q(sb.from('events').delete().eq('id', id)); },
      async saveBan(b, removedRoleIds) {
        let id = b.id;
        if (id) await q(sb.from('bans').update({ name: b.name, sort: b.sort }).eq('id', id));
        else id = (await q(sb.from('bans').insert({ name: b.name, sort: b.sort }).select('id').single())).id;
        if (removedRoleIds.length) await q(sb.from('ban_roles').delete().in('id', removedRoleIds));
        for (const [i, r] of b.roles.entries()) {
          const row = { ban_id: id, label: r.label, has_deadline: r.hasDeadline, sort: i + 1 };
          if (r.id) await q(sb.from('ban_roles').update(row).eq('id', r.id));
          else await q(sb.from('ban_roles').insert(row));
        }
      },
      async deleteBan(id) { await q(sb.from('bans').delete().eq('id', id)); },
      async updateMember(m) {
        await q(sb.from('members').update({ name: m.name, is_admin: m.isAdmin, fb_name: m.fbName || '', fb_url: m.fbUrl || '' }).eq('id', m.id));
        await q(sb.from('member_bans').delete().eq('member_id', m.id));
        if (m.bans.length) await q(sb.from('member_bans').insert(m.bans.map((b) => ({ member_id: m.id, ban_id: b.banId, is_lead: b.isLead }))));
      },
      createAccount: (m) => script('createAccount', m),
      grantLogin: (id) => script('grantLogin', { memberId: id }),
      resetPassword: (id) => script('resetPassword', { memberId: id }),
      setActive: (id, active) => script('setActive', { memberId: id, active }),
      resendConfirm: (ids) => script('resendConfirm', { memberIds: ids || [] }),
      async markFilter() { await q(sb.rpc('mark_gmail_filter')); },
      async setMyFacebook(name, url) { await q(sb.rpc('set_my_facebook', { p_name: name, p_url: url })); },
      async setMemberFacebook(id, name, url) { await q(sb.from('members').update({ fb_name: name, fb_url: url }).eq('id', id)); },
      async saveCampaign(c) {
        const row = { title: c.title, post_url: c.postUrl, actions: c.actions, deadline: c.deadline || null, member_ids: c.memberIds, ban_id: c.banId || null };
        const r = c.id ? await q(sb.from('seeding_campaigns').update(row).eq('id', c.id).select().single())
          : await q(sb.from('seeding_campaigns').insert(Object.assign(row, { created_by: c.createdBy })).select().single());
        return mapCampaign(r);
      },
      async deleteCampaign(id) { await q(sb.from('seeding_campaigns').delete().eq('id', id)); },
      async saveScan(campaignId, action, names, postUrl, by) {
        const r = await q(sb.from('seeding_scans').insert({ campaign_id: campaignId, action, names, post_url: postUrl || '', created_by: by }).select().single());
        return { campaignId: r.campaign_id, action: r.action, names: r.names || [], createdAt: r.created_at };
      },
      async saveCheck(x) {
        const r = await q(sb.from('seeding_checks').upsert({ campaign_id: x.campaignId, member_id: x.memberId, action: x.action, self_done: x.selfDone, proof_url: x.proofUrl || '' },
          { onConflict: 'campaign_id,member_id,action' }).select().single());
        return mapCheck(r);
      },
      async verifyChecks(campaignId, action, results) {
        if (!results.length) return [];
        const now = new Date().toISOString();
        const rows = await q(sb.from('seeding_checks').upsert(results.map((r) => ({ campaign_id: campaignId, member_id: r.memberId, action, verified: r.verified, verified_at: now })),
          { onConflict: 'campaign_id,member_id,action' }).select());
        return rows.map(mapCheck);
      },
      async saveSettings(s) {
        await q(sb.from('settings').upsert(Object.keys(s).map((k) => ({ key: k, value: s[k] }))));
      },
    };
  }

  /* ======================= DEMO ======================= */
  function DemoStore() {
    const uid = () => 'id-' + Math.random().toString(36).slice(2, 10);
    const iso = (off) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const clone = (o) => JSON.parse(JSON.stringify(o));

    const SK = { id: 'ban-sk', name: 'Ban Sự kiện', sort: 1, roles: [{ id: 'r-pt', label: 'Phụ trách', hasDeadline: true, sort: 1 }] };
    const TT = { id: 'ban-tt', name: 'Ban Truyền thông', sort: 2, roles: [
      { id: 'r-ct', label: 'Content', hasDeadline: true, sort: 1 }, { id: 'r-ds', label: 'Design', hasDeadline: true, sort: 2 }, { id: 'r-db', label: 'Đăng bài', hasDeadline: true, sort: 3 }] };
    const db = {
      bans: [SK, TT],
      members: [
        ['m-an', 'Nguyễn Minh An', 'an@example.com', true, [['ban-sk', false], ['ban-tt', false]]],
        ['m-ha', 'Trần Thu Hà', 'ha@example.com', false, [['ban-sk', true]]],
        ['m-nam', 'Lê Hoàng Nam', 'nam@example.com', false, [['ban-tt', true]]],
        ['m-ngoc', 'Phạm Bảo Ngọc', 'ngoc@example.com', false, [['ban-sk', false]]],
        ['m-huy', 'Vũ Đức Huy', 'huy@example.com', false, [['ban-sk', false]]],
        ['m-linh', 'Đỗ Khánh Linh', 'linh@example.com', false, [['ban-tt', false]]],
        ['m-bao', 'Hoàng Gia Bảo', 'bao@example.com', false, [['ban-tt', false]]],
        ['m-mai', 'Bùi Mai Anh', 'maianh@example.com', false, [['ban-tt', false]]],
        ['m-vy', 'Ngô Thảo Vy', 'vy@example.com', false, [['ban-sk', false]]],
      ].map(([id, name, email, isAdmin, bans]) => ({ id, userId: 'u-' + id, email, name, isAdmin, active: true, mustChange: false, bans: bans.map(([banId, isLead]) => ({ banId, isLead })) })),
      events: [{ id: 'ev-1', name: 'CHUYỆN NGHỀ MARKETING', date: iso(4) }, { id: 'ev-0', name: 'CHUYỆN NGHỀ NGÂN HÀNG', date: iso(-24) }, { id: 'ev-2', name: 'CHUYỆN NGHỀ KIỂM TOÁN', date: iso(25) }],
      tasks: [],
      settings: { reminder_days: 1, overdue_max_days: 7, sender_email: 'nhacviec.demo@gmail.com' },
      confirms: {},
      campaigns: [], checks: [], scans: [],
    };
    const add = (banId, eventId, name, status, parts, opts = {}) => {
      const t = { id: uid(), banId, eventId, name, status, note: opts.note || '', leadIds: opts.lead || [], links: opts.links || [],
        doneAt: status === 'done' ? daysAgo(opts.doneAgo ?? 3) : null, createdAt: daysAgo(40),
        parts: parts.map(([roleId, people, off]) => ({ id: uid(), roleId, assigneeIds: people, deadline: off === null ? '' : iso(off) })) };
      db.tasks.push(t);
    };
    // Sự kiện đã qua – để Dashboard có số liệu lịch sử
    const pastSK = ['Hồ sơ hợp tác diễn giả', 'MC', 'Lập form đăng ký', 'Làm slide', 'Script MC', 'In ấn, mua đồ', 'QR checkout', 'Timeline chạy sự kiện'];
    const skPeople = ['m-an', 'm-ngoc', 'm-huy', 'm-vy', 'm-huy', 'm-ha', 'm-ngoc', 'm-ha'];
    pastSK.forEach((n, i) => add('ban-sk', 'ev-0', n, 'done', [['r-pt', [skPeople[i]], -40 + i * 2]], { doneAgo: 40 - i * 2 - (i % 3 === 0 ? -2 : 1) }));
    ['Bài mở đơn', 'Bài quyền lợi', 'Bài giới thiệu diễn giả', 'Bài chuyên môn', 'Bài đóng đơn', 'Bài recap'].forEach((n, i) =>
      add('ban-tt', 'ev-0', n, 'done', [['r-ct', ['m-linh'], -45 + i * 3], ['r-ds', ['m-bao'], -44 + i * 3], ['r-db', ['m-nam'], -43 + i * 3]], { doneAgo: 43 - i * 3 - (i === 2 ? -3 : 0) }));
    // Sự kiện đang chạy
    add('ban-sk', 'ev-1', 'Hồ sơ hợp tác diễn giả', 'done', [['r-pt', ['m-an'], -10]], { doneAgo: 11 });
    add('ban-sk', 'ev-1', 'MC', 'done', [['r-pt', ['m-ngoc'], -6]], { doneAgo: 5 });
    add('ban-sk', 'ev-1', 'Lập form đăng ký', 'done', [['r-pt', ['m-huy'], -9]], { lead: ['m-ha'], note: 'Lấy form tháng trước, sửa lại', links: [{ label: 'Form', url: 'https://example.com/form' }], doneAgo: 9 });
    add('ban-sk', 'ev-1', 'Làm slide', 'doing', [['r-pt', ['m-vy', 'm-ngoc'], -2]], { lead: ['m-vy'], note: 'SLIDE' });
    add('ban-sk', 'ev-1', 'Script MC', 'doing', [['r-pt', ['m-huy'], 1]], { lead: ['m-vy'] });
    add('ban-sk', 'ev-1', 'In ấn, mua đồ', 'todo', [['r-pt', ['m-ha'], 2]], { lead: ['m-ha'], note: '- Certification / - Standee' });
    add('ban-sk', 'ev-1', 'Chuẩn bị câu hỏi Q&A dự phòng', 'todo', [['r-pt', ['m-vy'], 3]]);
    add('ban-tt', 'ev-1', 'Design BND', 'done', [['r-ct', [], null], ['r-ds', ['m-mai'], -12], ['r-db', [], null]], { doneAgo: 13 });
    add('ban-tt', 'ev-1', 'Bài mở đơn', 'done', [['r-ct', ['m-linh'], -11], ['r-ds', ['m-bao'], -10], ['r-db', ['m-an'], -10]], { lead: ['m-linh'], doneAgo: 9 });
    add('ban-tt', 'ev-1', 'Bài giới thiệu diễn giả', 'doing', [['r-ct', ['m-mai'], -1], ['r-ds', ['m-bao'], 0], ['r-db', ['m-nam'], 1]], { lead: ['m-nam'], note: 'Background, thành tích diễn giả' });
    add('ban-tt', 'ev-1', 'Bài chuyên môn 1', 'doing', [['r-ct', ['m-nam'], 1], ['r-ds', ['m-linh'], 2], ['r-db', ['m-mai'], 3]], { lead: ['m-nam'] });
    add('ban-tt', 'ev-1', 'Bài đóng đơn', 'todo', [['r-ct', ['m-bao'], 4], ['r-ds', ['m-mai'], 5], ['r-db', ['m-nam'], 6]], { lead: ['m-linh'] });
    // Sự kiện sắp tới
    add('ban-sk', 'ev-2', 'Hồ sơ hợp tác diễn giả', 'doing', [['r-pt', ['m-an'], 9]]);
    add('ban-sk', 'ev-2', 'MC', 'todo', [['r-pt', [], 15]]);
    add('ban-sk', 'ev-2', 'Lập form đăng ký', 'todo', [['r-pt', ['m-huy'], 11]], { lead: ['m-ha'] });
    add('ban-tt', 'ev-2', 'Design BND', 'todo', [['r-ct', [], null], ['r-ds', ['m-mai'], 8], ['r-db', [], null]]);
    add('ban-tt', 'ev-2', 'Bài mở đơn', 'todo', [['r-ct', ['m-linh'], 9], ['r-ds', ['m-bao'], 10], ['r-db', [], 12]]);
    ['tin_cay', 'tin_cay', 'da_bam', 'da_gui', 'tin_cay', 'tin_cay', 'da_bam', 'tin_cay', 'da_gui'].forEach((st, i) => {
      db.confirms[db.members[i].id] = { sends: 1, lastSent: daysAgo(4), clicked: st !== 'da_gui', replied: st === 'tin_cay', filter: false };
    });

    db.members[2].fbName = 'Nam Lê'; db.members[5].fbUrl = 'https://facebook.com/';
    db.campaigns.push({ id: 'sd-1', title: 'Seeding bài giới thiệu diễn giả – Chuyện nghề Marketing', postUrl: 'https://facebook.com/', actions: ['like', 'comment', 'share'],
      deadline: iso(1), memberIds: db.members.map((m) => m.id), banId: 'ban-tt', createdBy: 'm-nam', createdAt: daysAgo(1) });
    [['m-linh', 'like', true, '', 'found'], ['m-linh', 'share', true, 'https://facebook.com/share/abc', ''], ['m-bao', 'like', true, '', 'not_found'], ['m-mai', 'comment', true, '', 'found'],
      ['m-huy', 'like', false, '', 'found'], ['m-an', 'like', true, '', ''], ['m-an', 'comment', true, '', ''], ['m-an', 'share', true, 'https://facebook.com/share/x', '']].forEach(([memberId, action, selfDone, proofUrl, verified]) =>
      db.checks.push({ campaignId: 'sd-1', memberId, action, selfDone, proofUrl, verified }));
    let meId = null;
    const me = () => db.members.find((m) => m.id === meId);
    const wait = () => new Promise((r) => setTimeout(r, 120));
    const needAdmin = () => { if (!me().isAdmin) throw err('Chỉ admin mới làm được việc này.'); };
    const genPw = () => Math.random().toString(36).slice(2, 7) + Math.random().toString(36).slice(2, 7).toUpperCase();

    return {
      demo: true,
      demoUsers: db.members,
      async init() { meId = sessionStorage.getItem('demoMe'); return !!meId; },
      async signIn(memberId) { meId = memberId; try { sessionStorage.setItem('demoMe', memberId); } catch (e) { /* bỏ qua */ } },
      async signOut() { meId = null; try { sessionStorage.removeItem('demoMe'); } catch (e) { /* bỏ qua */ } },
      async changePassword() { await wait(); me().mustChange = false; },
      async loadAll() {
        await wait();
        if (!me()) throw err('Hãy chọn người dùng demo.', 'NOT_MEMBER');
        return clone({ bans: db.bans, members: db.members, events: db.events, tasks: db.tasks, settings: db.settings, confirms: db.confirms, campaigns: db.campaigns, checks: db.checks, scans: db.scans, meId });
      },
      async saveTask(t, full) {
        await wait();
        let row = db.tasks.find((x) => x.id === t.id);
        if (!row) { row = { id: uid(), createdAt: new Date().toISOString(), parts: [], doneAt: null }; db.tasks.push(row); }
        if (t.status === 'done' && row.status !== 'done') row.doneAt = new Date().toISOString();
        if (t.status !== 'done') row.doneAt = null;
        Object.assign(row, { status: t.status, note: t.note, links: t.links });
        if (full) {
          Object.assign(row, { banId: t.banId, eventId: t.eventId || null, name: t.name, leadIds: t.leadIds });
          t.parts.forEach((p) => {
            const ex = row.parts.find((x) => x.roleId === p.roleId);
            if (ex) Object.assign(ex, { deadline: p.deadline, assigneeIds: p.assigneeIds });
            else row.parts.push({ id: uid(), roleId: p.roleId, deadline: p.deadline, assigneeIds: p.assigneeIds });
          });
        }
        return clone(row);
      },
      async deleteTask(id) { await wait(); db.tasks = db.tasks.filter((t) => t.id !== id); },
      async cloneEvent(banId, fromEventId, toName, toDate, keepPeople, keepNotes) {
        await wait();
        if (!toName.trim()) throw err('Hãy nhập tên sự kiện mới.');
        let ev = db.events.find((e) => e.name.toLowerCase() === toName.trim().toLowerCase());
        if (ev && db.tasks.some((t) => t.banId === banId && t.eventId === ev.id)) throw err('Sự kiện này đã có công việc trong Ban.');
        if (!ev) { ev = { id: uid(), name: toName.trim(), date: toDate || '' }; db.events.push(ev); }
        const src = db.tasks.filter((t) => t.banId === banId && t.eventId === fromEventId);
        src.forEach((s) => db.tasks.push({ id: uid(), banId, eventId: ev.id, name: s.name, status: 'todo', note: keepNotes ? s.note : '',
          leadIds: keepPeople ? s.leadIds.slice() : [], links: [], doneAt: null, createdAt: new Date().toISOString(),
          parts: s.parts.map((p) => ({ id: uid(), roleId: p.roleId, deadline: '', assigneeIds: keepPeople ? p.assigneeIds.slice() : [] })) }));
        return src.length;
      },
      async saveEvent(e) {
        await wait();
        if (db.events.some((x) => x.id !== e.id && x.name.toLowerCase() === e.name.trim().toLowerCase())) throw err('Tên sự kiện đã tồn tại.');
        let ev = db.events.find((x) => x.id === e.id);
        if (!ev) { ev = { id: uid() }; db.events.push(ev); }
        Object.assign(ev, { name: e.name.trim(), date: e.date || '' });
        return clone(ev);
      },
      async deleteEvent(id) { await wait(); db.events = db.events.filter((e) => e.id !== id); db.tasks.forEach((t) => { if (t.eventId === id) t.eventId = null; }); },
      async saveBan(b, removedRoleIds) {
        await wait(); needAdmin();
        let ban = db.bans.find((x) => x.id === b.id);
        if (!ban) { ban = { id: uid(), roles: [] }; db.bans.push(ban); }
        ban.name = b.name; ban.sort = b.sort;
        ban.roles = b.roles.map((r, i) => ({ id: r.id || uid(), label: r.label, hasDeadline: r.hasDeadline, sort: i + 1 }));
        db.tasks.forEach((t) => { t.parts = t.parts.filter((p) => !removedRoleIds.includes(p.roleId)); });
      },
      async deleteBan(id) {
        await wait(); needAdmin();
        if (db.tasks.some((t) => t.banId === id)) throw err('Không xóa được vì vẫn còn công việc thuộc mục này.');
        db.bans = db.bans.filter((b) => b.id !== id);
        db.members.forEach((m) => { m.bans = m.bans.filter((x) => x.banId !== id); });
      },
      async updateMember(m) { await wait(); needAdmin(); Object.assign(db.members.find((x) => x.id === m.id), { name: m.name, isAdmin: m.isAdmin, bans: m.bans, fbName: m.fbName || '', fbUrl: m.fbUrl || '' }); },
      async setMyFacebook(name, url) { await wait(); Object.assign(me(), { fbName: name.trim(), fbUrl: url.trim() }); },
      async setMemberFacebook(id, name, url) { await wait(); needAdmin(); Object.assign(db.members.find((x) => x.id === id), { fbName: name, fbUrl: url }); },
      async saveCampaign(c) {
        await wait();
        let row = db.campaigns.find((x) => x.id === c.id);
        if (!row) { row = { id: uid(), createdAt: new Date().toISOString(), createdBy: c.createdBy }; db.campaigns.unshift(row); }
        Object.assign(row, { title: c.title, postUrl: c.postUrl, actions: c.actions, deadline: c.deadline || '', memberIds: c.memberIds, banId: c.banId || null });
        return clone(row);
      },
      async saveScan(campaignId, action, names) { await wait(); const x = { campaignId, action, names, createdAt: new Date().toISOString() }; db.scans.push(x); return clone(x); },
      async deleteCampaign(id) { await wait(); db.campaigns = db.campaigns.filter((x) => x.id !== id); db.checks = db.checks.filter((x) => x.campaignId !== id); },
      async saveCheck(x) {
        await wait();
        let row = db.checks.find((c) => c.campaignId === x.campaignId && c.memberId === x.memberId && c.action === x.action);
        if (!row) { row = { campaignId: x.campaignId, memberId: x.memberId, action: x.action, verified: '' }; db.checks.push(row); }
        Object.assign(row, { selfDone: x.selfDone, proofUrl: x.proofUrl || '' });
        return clone(row);
      },
      async verifyChecks(campaignId, action, results) {
        await wait();
        return results.map((r) => {
          let row = db.checks.find((c) => c.campaignId === campaignId && c.memberId === r.memberId && c.action === action);
          if (!row) { row = { campaignId, memberId: r.memberId, action, selfDone: false, proofUrl: '' }; db.checks.push(row); }
          row.verified = r.verified;
          return clone(row);
        });
      },
      async createAccount(m) {
        await wait(); needAdmin();
        if (db.members.some((x) => x.email === m.email.toLowerCase())) throw err('Email này đã có tài khoản.');
        const id = uid();
        db.members.push({ id, userId: 'u-' + id, email: m.email.toLowerCase(), name: m.name, isAdmin: !!m.isAdmin, active: true, mustChange: true, bans: m.bans });
        db.confirms[id] = { sends: 1, lastSent: new Date().toISOString(), clicked: false, replied: false, filter: false };
        return { memberId: id, password: genPw(), emailed: true };
      },
      async grantLogin(id) { await wait(); needAdmin(); const m = db.members.find((x) => x.id === id); m.userId = 'u-' + id; m.mustChange = true; db.confirms[id] = { sends: 1, lastSent: new Date().toISOString() }; return { password: genPw(), emailed: true }; },
      async resetPassword(id) { await wait(); needAdmin(); db.members.find((x) => x.id === id).mustChange = true; return { password: genPw(), emailed: true }; },
      async setActive(id, active) { await wait(); needAdmin(); db.members.find((x) => x.id === id).active = active; },
      async resendConfirm() {
        await wait(); needAdmin();
        let n = 0;
        Object.values(db.confirms).forEach((c) => { if (!c.replied && !c.filter) { c.sends++; n++; } });
        return { sent: n };
      },
      async markFilter() { await wait(); db.confirms[meId] = Object.assign(db.confirms[meId] || { sends: 0 }, { filter: true }); },
      async saveSettings(s) { await wait(); needAdmin(); Object.assign(db.settings, s); },
    };
  }

  window.Store = CFG.SUPABASE_URL ? SupabaseStore() : DemoStore();
})();

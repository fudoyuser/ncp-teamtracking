-- =====================================================================
-- NCP TeamTracking – Cơ sở dữ liệu Supabase
-- Cách dùng: Supabase Dashboard → SQL Editor → New query → dán toàn bộ file → Run.
-- Chạy lại nhiều lần cũng không sao (không xóa dữ liệu đã có).
-- =====================================================================

-- ---------------------------------------------------------------- BẢNG
create table if not exists public.bans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- Vai trò trong một Ban, vd. Ban Truyền thông: Content / Design / Đăng bài
create table if not exists public.ban_roles (
  id uuid primary key default gen_random_uuid(),
  ban_id uuid not null references public.bans(id) on delete cascade,
  label text not null,
  has_deadline boolean not null default true,
  sort int not null default 0
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email text not null unique,
  name text not null,
  is_admin boolean not null default false,
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.member_bans (
  member_id uuid not null references public.members(id) on delete cascade,
  ban_id uuid not null references public.bans(id) on delete cascade,
  is_lead boolean not null default false,   -- true = Trưởng ban
  primary key (member_id, ban_id)
);
-- Phó ban: cùng quyền quản lý Ban như Trưởng ban (giao việc, tạo/xóa việc, seeding)
alter table public.member_bans add column if not exists is_vice boolean not null default false;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  event_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  ban_id uuid not null references public.bans(id) on delete restrict,
  event_id uuid references public.events(id) on delete set null,
  name text not null,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  note text not null default '',
  lead_ids uuid[] not null default '{}',     -- Lead CV
  links jsonb not null default '[]',         -- [{ "label": "Link design", "url": "https://..." }]
  done_at timestamptz,                       -- tự ghi khi chuyển sang "Hoàn thành"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_ban_idx on public.tasks(ban_id);
create index if not exists tasks_event_idx on public.tasks(event_id);

-- Mỗi công việc có 1 phần cho mỗi vai trò của Ban: người phụ trách + deadline
create table if not exists public.task_parts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  role_id uuid not null references public.ban_roles(id) on delete cascade,
  deadline date,
  assignee_ids uuid[] not null default '{}',
  unique (task_id, role_id)
);
create index if not exists task_parts_task_idx on public.task_parts(task_id);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null
);

-- Trạng thái xác nhận chống spam của từng thành viên
create table if not exists public.email_confirm (
  member_id uuid primary key references public.members(id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  sends int not null default 0,
  last_sent timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz,
  filter_at timestamptz
);

-- Nhật ký nhắc việc (chống gửi trùng) – chỉ máy chủ gửi mail đọc/ghi
create table if not exists public.reminder_log (
  key text primary key,
  sent_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- HÀM PHÂN QUYỀN
create or replace function public.my_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from members where user_id = auth.uid() and active
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where user_id = auth.uid() and active)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from members where user_id = auth.uid() and active), false)
$$;

create or replace function public.is_lead_of(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from member_bans mb join members m on m.id = mb.member_id
    where m.user_id = auth.uid() and m.active and mb.ban_id = b and (mb.is_lead or mb.is_vice))
$$;

create or replace function public.is_any_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from member_bans mb join members m on m.id = mb.member_id
    where m.user_id = auth.uid() and m.active and (mb.is_lead or mb.is_vice))
$$;

-- Admin, trưởng ban của Ban đó, hoặc Lead CV của công việc
create or replace function public.can_manage_task(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select is_admin() or is_lead_of(ban_id) or my_member_id() = any(lead_ids)
    from tasks where id = t), false)
$$;

create or replace function public.is_assignee_of(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from task_parts where task_id = t and my_member_id() = any(assignee_ids))
$$;

-- ---------------------------------------------------------------- TRIGGER
create or replace function public.tasks_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.done_at := now();
  elsif new.status <> 'done' then
    new.done_at := null;
  end if;
  -- Người chỉ được giao việc: chỉ được đổi trạng thái, ghi chú, liên kết
  if tg_op = 'UPDATE' and coalesce(auth.role(), '') <> 'service_role'
     and not (is_admin() or is_lead_of(old.ban_id) or my_member_id() = any(old.lead_ids)) then
    if new.name is distinct from old.name or new.ban_id is distinct from old.ban_id
       or new.event_id is distinct from old.event_id or new.lead_ids is distinct from old.lead_ids then
      raise exception 'Bạn chỉ được cập nhật trạng thái, ghi chú và liên kết của công việc này';
    end if;
    -- Ban có link theo vai trò: thành viên chỉ nộp link vào đúng ô vai trò của mình (qua update_task_part)
    if new.links is distinct from old.links and exists (select 1 from ban_roles where ban_id = old.ban_id and has_link) then
      raise exception 'Hãy nộp link sản phẩm vào đúng ô vai trò được giao cho bạn';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tasks_before_write on public.tasks;
create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

-- ---------------------------------------------------------------- TRẠNG THÁI & LINK RIÊNG TỪNG VAI TRÒ
-- Vai trò có has_status: mỗi phần việc có trạng thái riêng, trạng thái chung của công việc được tính tự động.
-- Vai trò có has_link: mỗi phần việc có 1 link sản phẩm riêng (vd. link Content, link Design).
alter table public.ban_roles add column if not exists has_status boolean not null default false;
alter table public.ban_roles add column if not exists has_link boolean not null default false;
do $$
declare tt uuid; r_ct uuid; r_ds uuid;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'task_parts' and column_name = 'status') then
    alter table public.task_parts add column status text not null default 'todo' check (status in ('todo', 'doing', 'done'));
    alter table public.task_parts add column link text not null default '';
    -- Chuyển dữ liệu cũ (chỉ chạy 1 lần): trạng thái chung → trạng thái từng vai trò
    update public.task_parts p set status = t.status from public.tasks t where t.id = p.task_id;
    select id into tt from public.bans where name = 'Ban Truyền thông';
    if tt is not null then
      update public.ban_roles set has_status = true, has_link = (label in ('Content', 'Design')) where ban_id = tt;
      select id into r_ct from public.ban_roles where ban_id = tt and label = 'Content';
      select id into r_ds from public.ban_roles where ban_id = tt and label = 'Design';
      -- Link Google Docs → Content, link Canva → Design
      update public.task_parts p set link = coalesce((select l->>'url' from public.tasks t, jsonb_array_elements(t.links) l
        where t.id = p.task_id and l->>'url' ~* 'docs\.google\.com' limit 1), '') where p.role_id = r_ct;
      update public.task_parts p set link = coalesce((select l->>'url' from public.tasks t, jsonb_array_elements(t.links) l
        where t.id = p.task_id and l->>'url' ~* 'canva\.(com|link)' limit 1), '') where p.role_id = r_ds;
      update public.tasks t set links = coalesce((select jsonb_agg(l) from jsonb_array_elements(t.links) l
        where not ((r_ct is not null and l->>'url' ~* 'docs\.google\.com') or (r_ds is not null and l->>'url' ~* 'canva\.(com|link)'))), '[]'::jsonb)
        where t.ban_id = tt;
    end if;
    alter table public.task_parts add constraint task_parts_link_http check (link = '' or link ~* '^https?://');
  end if;
end $$;

-- Kết quả kiểm tra quyền chia sẻ của link (Apps Script ghi): edit / club / view / private / edit_link / unknown
alter table public.task_parts add column if not exists link_check text not null default '';
alter table public.task_parts add column if not exists link_check_note text not null default '';
alter table public.task_parts add column if not exists link_checked_at timestamptz;
-- Vai trò có link sản phẩm (Content, Design): Hoàn thành chỉ khi link đã được xác nhận có quyền chỉnh sửa
create or replace function public.part_done_blocked(p_role uuid, p_check text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select has_link from ban_roles where id = p_role), false) and coalesce(p_check, '') not in ('edit', 'edit_link')
$$;
create or replace function public.task_parts_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare link_changed boolean;
begin
  if tg_op = 'INSERT' then
    -- Lưu ý: "upsert" cũng chạy nhánh này cho dòng đã có → không chặn ở đây (chặn ở AFTER INSERT)
    if coalesce(auth.role(), '') <> 'service_role' then new.link_check := ''; new.link_check_note := ''; new.link_checked_at := null; end if;
    return new;
  end if;
  link_changed := new.link is distinct from old.link;
  if link_changed then
    new.link_check := ''; new.link_check_note := ''; new.link_checked_at := null;  -- link đổi → kết quả cũ không còn đúng
  elsif coalesce(auth.role(), '') <> 'service_role' then
    -- Chỉ Apps Script (service_role) được ghi kết quả kiểm tra quyền link
    new.link_check := old.link_check; new.link_check_note := old.link_check_note; new.link_checked_at := old.link_checked_at;
  end if;
  if new.status = 'done' and (old.status is distinct from 'done' or link_changed) and part_done_blocked(new.role_id, new.link_check) then
    raise exception 'Cần gắn link sản phẩm có quyền chỉnh sửa (đã kiểm tra) trước khi xác nhận Hoàn thành';
  end if;
  return new;
end $$;
drop trigger if exists task_parts_before_write on public.task_parts;
create trigger task_parts_before_write before insert or update on public.task_parts
  for each row execute function public.task_parts_before_write();

-- Trạng thái chung = tính từ các vai trò có trạng thái riêng (chỉ xét vai trò đã có người được giao, nếu có)
create or replace function public.sync_task_status(t uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n int; nd int; nact int; st text; any_assigned boolean;
begin
  select bool_or(cardinality(p.assignee_ids) > 0) into any_assigned
    from task_parts p join ban_roles r on r.id = p.role_id where p.task_id = t and r.has_status;
  select count(*), count(*) filter (where p.status = 'done'), count(*) filter (where p.status <> 'todo')
    into n, nd, nact
    from task_parts p join ban_roles r on r.id = p.role_id
    where p.task_id = t and r.has_status and (not coalesce(any_assigned, false) or cardinality(p.assignee_ids) > 0);
  if n = 0 then return; end if;
  st := case when nd = n then 'done' when nact > 0 then 'doing' else 'todo' end;
  update tasks set status = st where id = t and status is distinct from st;
end $$;

create or replace function public.task_parts_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'done' and part_done_blocked(new.role_id, new.link_check) then
    raise exception 'Cần gắn link sản phẩm có quyền chỉnh sửa (đã kiểm tra) trước khi xác nhận Hoàn thành';
  end if;
  perform sync_task_status(new.task_id);
  return null;
end $$;
drop trigger if exists task_parts_after_write on public.task_parts;
create trigger task_parts_after_write after insert or update on public.task_parts
  for each row execute function public.task_parts_after_write();

-- Người được giao 1 vai trò tự cập nhật trạng thái + link của phần mình (không sửa được phần khác)
create or replace function public.update_task_part(p_part uuid, p_status text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
declare tid uuid; ids uuid[];
begin
  select task_id, assignee_ids into tid, ids from task_parts where id = p_part;
  if tid is null then raise exception 'Không tìm thấy phần việc này'; end if;
  if not (can_manage_task(tid) or my_member_id() = any(ids)) then
    raise exception 'Bạn chỉ được cập nhật phần việc được giao cho mình';
  end if;
  if p_status not in ('todo', 'doing', 'done') then raise exception 'Trạng thái không hợp lệ'; end if;
  if coalesce(p_link, '') <> '' and p_link !~* '^https?://' then
    raise exception 'Liên kết phải bắt đầu bằng http:// hoặc https://';
  end if;
  update task_parts set status = p_status, link = coalesce(trim(p_link), '') where id = p_part;
end $$;

-- ---------------------------------------------------------------- RPC
-- Thành viên đánh dấu đã đổi mật khẩu lần đầu
create or replace function public.mark_password_changed() returns void
language sql security definer set search_path = public as $$
  update members set must_change_password = false where user_id = auth.uid()
$$;

-- Thành viên đánh dấu đã tạo bộ lọc Gmail chống spam
create or replace function public.mark_gmail_filter() returns void
language plpgsql security definer set search_path = public as $$
declare mid uuid := my_member_id();
begin
  if mid is null then raise exception 'Không phải thành viên'; end if;
  insert into email_confirm (member_id, filter_at) values (mid, now())
  on conflict (member_id) do update set filter_at = coalesce(email_confirm.filter_at, now());
end $$;

-- Tạo sự kiện mới bằng cách sao chép danh sách công việc của một sự kiện cũ (trong 1 Ban)
create or replace function public.clone_event(p_ban uuid, p_from uuid, p_to_name text, p_to_date date,
                                              p_keep_people boolean, p_keep_notes boolean)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_event uuid; v_task uuid; r record; n int := 0;
begin
  if not (is_admin() or is_lead_of(p_ban)) then
    raise exception 'Chỉ admin hoặc trưởng ban mới được tạo sự kiện';
  end if;
  if coalesce(trim(p_to_name), '') = '' then raise exception 'Hãy nhập tên sự kiện mới'; end if;
  select id into v_event from events where lower(name) = lower(trim(p_to_name));
  if v_event is null then
    insert into events (name, event_date) values (trim(p_to_name), p_to_date) returning id into v_event;
  elsif exists (select 1 from tasks where ban_id = p_ban and event_id = v_event) then
    raise exception 'Sự kiện này đã có công việc trong Ban';
  end if;
  for r in select * from tasks where ban_id = p_ban and event_id = p_from order by created_at loop
    insert into tasks (ban_id, event_id, name, note, lead_ids, created_at)
    values (p_ban, v_event, r.name, case when p_keep_notes then r.note else '' end,
            case when p_keep_people then r.lead_ids else '{}' end, clock_timestamp())
    returning id into v_task;
    insert into task_parts (task_id, role_id, assignee_ids)
      select v_task, role_id, case when p_keep_people then assignee_ids else '{}' end
      from task_parts where task_id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- BẢO MẬT (RLS)
alter table public.bans enable row level security;
alter table public.ban_roles enable row level security;
alter table public.members enable row level security;
alter table public.member_bans enable row level security;
alter table public.events enable row level security;
alter table public.tasks enable row level security;
alter table public.task_parts enable row level security;
alter table public.settings enable row level security;
alter table public.email_confirm enable row level security;
alter table public.reminder_log enable row level security;

do $$
declare t text;
begin
  -- xóa policy cũ để chạy lại file không bị lỗi
  for t in select policyname || ' on ' || schemaname || '.' || tablename from pg_policies where schemaname = 'public' loop
    execute 'drop policy if exists ' || split_part(t, ' on ', 1) || ' on ' || split_part(t, ' on ', 2);
  end loop;
end $$;

-- Đọc: mọi thành viên đang hoạt động
create policy read_all on public.bans for select using (is_member());
create policy read_all on public.ban_roles for select using (is_member());
create policy read_all on public.members for select using (is_member());
create policy read_all on public.member_bans for select using (is_member());
create policy read_all on public.events for select using (is_member());
create policy read_all on public.tasks for select using (is_member());
create policy read_all on public.task_parts for select using (is_member());
create policy read_all on public.settings for select using (is_member());
create policy read_own on public.email_confirm for select using (is_admin() or member_id = my_member_id());

-- Ghi: Ban, vai trò, thành viên, cài đặt → chỉ admin
create policy admin_write on public.bans for all using (is_admin()) with check (is_admin());
create policy admin_write on public.ban_roles for all using (is_admin()) with check (is_admin());
create policy admin_write on public.members for all using (is_admin()) with check (is_admin());
create policy admin_write on public.member_bans for all using (is_admin()) with check (is_admin());
create policy admin_write on public.settings for all using (is_admin()) with check (is_admin());

-- Sự kiện: admin và trưởng ban
create policy lead_write on public.events for all using (is_admin() or is_any_lead()) with check (is_admin() or is_any_lead());

-- Công việc
create policy task_insert on public.tasks for insert with check (is_admin() or is_lead_of(ban_id));
create policy task_update on public.tasks for update
  using (is_admin() or is_lead_of(ban_id) or my_member_id() = any(lead_ids) or is_assignee_of(id))
  with check (is_admin() or is_lead_of(ban_id) or my_member_id() = any(lead_ids) or is_assignee_of(id));
create policy task_delete on public.tasks for delete using (is_admin() or is_lead_of(ban_id));

create policy part_write on public.task_parts for all using (can_manage_task(task_id)) with check (can_manage_task(task_id));

-- ---------------------------------------------------------------- DỮ LIỆU BAN ĐẦU
insert into public.settings (key, value) values
  ('reminder_days', '1'), ('overdue_max_days', '7'), ('sender_email', '""')
on conflict (key) do nothing;

do $$
declare b uuid;
begin
  if not exists (select 1 from public.bans) then
    insert into public.bans (name, sort) values ('Ban Sự kiện', 1) returning id into b;
    insert into public.ban_roles (ban_id, label, sort) values (b, 'Phụ trách', 1);
    insert into public.bans (name, sort) values ('Ban Truyền thông', 2) returning id into b;
    insert into public.ban_roles (ban_id, label, sort) values (b, 'Content', 1), (b, 'Design', 2), (b, 'Đăng bài', 3);
  end if;
end $$;

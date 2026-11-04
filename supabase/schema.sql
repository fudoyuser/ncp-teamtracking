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
    where m.user_id = auth.uid() and m.active and mb.ban_id = b and mb.is_lead)
$$;

create or replace function public.is_any_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from member_bans mb join members m on m.id = mb.member_id
    where m.user_id = auth.uid() and m.active and mb.is_lead)
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
  end if;
  return new;
end $$;

drop trigger if exists tasks_before_write on public.tasks;
create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

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

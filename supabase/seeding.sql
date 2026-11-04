-- =====================================================================
-- NCP TeamTracking – Phần SEEDING (chạy sau schema.sql; chạy lại nhiều lần không sao)
-- =====================================================================

alter table public.members add column if not exists fb_name text not null default '';
alter table public.members add column if not exists fb_url text not null default '';

create table if not exists public.seeding_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  post_url text not null default '',
  actions text[] not null default '{like,comment}',  -- like / comment / share
  deadline date,
  member_ids uuid[] not null default '{}',                 -- người cần tham gia
  ban_id uuid references public.bans(id) on delete set null,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.seeding_checks (
  campaign_id uuid not null references public.seeding_campaigns(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  action text not null check (action in ('like', 'comment', 'share')),
  self_done boolean not null default false,   -- thành viên tự xác nhận
  proof_url text not null default '',         -- link bằng chứng (vd. link bài share)
  verified text check (verified in ('found', 'not_found')),  -- kết quả đối chiếu danh sách
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, member_id, action)
);

-- Thành viên chỉ được sửa phần tự xác nhận của chính mình; cột "verified" chỉ admin/trưởng ban sửa
create or replace function public.seeding_checks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if coalesce(auth.role(), '') <> 'service_role' and not (is_admin() or is_any_lead()) then
    if new.member_id is distinct from my_member_id() then
      raise exception 'Bạn chỉ được cập nhật seeding của chính mình';
    end if;
    if tg_op = 'INSERT' then
      new.verified := null; new.verified_at := null;
    elsif new.verified is distinct from old.verified or new.verified_at is distinct from old.verified_at then
      raise exception 'Chỉ admin hoặc trưởng ban mới được đối chiếu';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists seeding_checks_guard on public.seeding_checks;
create trigger seeding_checks_guard before insert or update on public.seeding_checks
  for each row execute function public.seeding_checks_guard();

-- Thành viên tự cập nhật tên / link Facebook của mình
create or replace function public.set_my_facebook(p_name text, p_url text) returns void
language sql security definer set search_path = public as $$
  update members set fb_name = coalesce(trim(p_name), ''), fb_url = coalesce(trim(p_url), '') where user_id = auth.uid()
$$;

alter table public.seeding_campaigns enable row level security;
alter table public.seeding_checks enable row level security;

drop policy if exists read_all on public.seeding_campaigns;
drop policy if exists lead_write on public.seeding_campaigns;
drop policy if exists read_all on public.seeding_checks;
drop policy if exists own_or_lead_write on public.seeding_checks;
drop policy if exists own_or_lead_update on public.seeding_checks;
drop policy if exists lead_delete on public.seeding_checks;

create policy read_all on public.seeding_campaigns for select using (is_member());
create policy lead_write on public.seeding_campaigns for all using (is_admin() or is_any_lead()) with check (is_admin() or is_any_lead());
create policy read_all on public.seeding_checks for select using (is_member());
create policy own_or_lead_write on public.seeding_checks for insert
  with check (is_admin() or is_any_lead() or member_id = my_member_id());
create policy own_or_lead_update on public.seeding_checks for update
  using (is_admin() or is_any_lead() or member_id = my_member_id())
  with check (is_admin() or is_any_lead() or member_id = my_member_id());
create policy lead_delete on public.seeding_checks for delete using (is_admin() or is_any_lead());

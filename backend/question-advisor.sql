-- Execute once in Supabase SQL Editor. No draft text is stored here.
begin;
create table if not exists public.rise_advisor_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_day date not null,
  requests integer not null default 0 check (requests >= 0),
  last_request timestamptz not null default now(),
  primary key (user_id, usage_day)
);
alter table public.rise_advisor_usage enable row level security;
revoke all on public.rise_advisor_usage from public, anon, authenticated;

create or replace function public.rise_claim_advisor_request(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'UTC')::date;
  previous public.rise_advisor_usage%rowtype;
  total bigint;
begin
  -- One shared lock makes both per-user and global caps atomic.
  perform pg_catalog.pg_advisory_xact_lock(718492613::bigint);
  if not exists (select 1 from auth.users u join public.rise_profiles p on p.id=u.id
    where u.id=p_user_id and u.email_confirmed_at is not null
    and p.role in ('student','ta','teacher','admin')) then return false; end if;
  select * into previous from public.rise_advisor_usage where user_id=p_user_id and usage_day=today;
  if previous.requests >= 10 or previous.last_request > now()-interval '30 seconds' then return false; end if;
  select coalesce(sum(requests),0) into total from public.rise_advisor_usage where usage_day=today;
  if total >= 200 then return false; end if;
  insert into public.rise_advisor_usage(user_id,usage_day,requests,last_request)
  values(p_user_id,today,1,now()) on conflict(user_id,usage_day)
  do update set requests=rise_advisor_usage.requests+1,last_request=now();
  delete from public.rise_advisor_usage where usage_day < today-30;
  return true;
end;
$$;
revoke all on function public.rise_claim_advisor_request(uuid) from public,anon,authenticated;
grant execute on function public.rise_claim_advisor_request(uuid) to service_role;
commit;

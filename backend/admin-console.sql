-- 已安裝帳號系統 rise_profiles 後執行；可重複執行，不刪除會員。
begin;
create schema if not exists rise_private;
create table if not exists rise_private.admin_console_settings(
 id boolean primary key default true check(id), started_at timestamptz not null default now()
);
insert into rise_private.admin_console_settings(id) values(true) on conflict do nothing;
create table if not exists rise_private.member_activity(
 user_id uuid not null references auth.users(id) on delete cascade,
 activity_date date not null,
 last_seen_at timestamptz not null default now(),
 primary key(user_id,activity_date)
);
create index if not exists rise_activity_date on rise_private.member_activity(activity_date,user_id);
create table if not exists rise_private.member_role_events(
 id bigint generated always as identity primary key,
 actor_id uuid references auth.users(id) on delete set null,
 target_id uuid references auth.users(id) on delete set null,
 old_role text not null,new_role text not null,created_at timestamptz not null default now()
);
alter table rise_private.member_activity enable row level security;
alter table rise_private.member_role_events enable row level security;
alter table rise_private.admin_console_settings enable row level security;
revoke all on rise_private.member_activity,rise_private.member_role_events,rise_private.admin_console_settings from public,anon,authenticated;
create or replace function rise_private.console_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rise_profiles p join auth.users u on u.id=p.id
 where p.id=auth.uid() and p.role='admin' and u.email_confirmed_at is not null);
$$;
revoke all on function rise_private.console_admin() from public,anon,authenticated;

-- 不接受 user_id 或客戶端時間；一天一位會員只算一次活躍。
create or replace function public.rise_record_activity() returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then return;end if;
 insert into rise_private.member_activity(user_id,activity_date,last_seen_at)
 values(auth.uid(),(now() at time zone 'Asia/Taipei')::date,now())
 on conflict(user_id,activity_date) do update set last_seen_at=excluded.last_seen_at
 where rise_private.member_activity.last_seen_at < now()-interval '5 minutes';
end;$$;

create or replace function public.rise_admin_members(p_search text default '',p_role text default 'all',p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not rise_private.console_admin() then raise exception 'rise:僅限已驗證的管理員使用。' using errcode='42501';end if;
 if p_role is null or p_role not in ('all','student','ta','teacher','admin','missing') or char_length(coalesce(p_search,''))>200 then raise exception 'rise:搜尋條件不正確。';end if;
 with matched as (
 select u.id,u.email,coalesce(p.display_name,'尚未建立會員資料') display_name,p.role,
 u.created_at,u.email_confirmed_at,u.last_sign_in_at,
 (select max(a.last_seen_at) from rise_private.member_activity a where a.user_id=u.id) last_active_at
 from auth.users u left join public.rise_profiles p on p.id=u.id
 where (p_role='all' or p.role=p_role or (p_role='missing' and p.id is null))
 and (coalesce(p_search,'')='' or strpos(lower(coalesce(u.email,'')),lower(p_search))>0 or strpos(lower(coalesce(p.display_name,'')),lower(p_search))>0)
 ), paged as (select * from matched order by created_at desc,id limit 25 offset greatest(0,least(coalesce(p_offset,0),1000000)))
 select jsonb_build_object('total',(select count(*) from matched),'items',coalesce((select jsonb_agg(to_jsonb(paged) order by created_at desc,id) from paged),'[]'::jsonb)) into result;
 return result;
end;$$;

create or replace function public.rise_admin_statistics() returns jsonb
language plpgsql security definer set search_path='' as $$
declare today date:=(now() at time zone 'Asia/Taipei')::date; result jsonb;
begin
 if not rise_private.console_admin() then raise exception 'rise:僅限已驗證的管理員使用。' using errcode='42501';end if;
 select jsonb_build_object(
 'total',(select count(*) from auth.users),
 'verified',(select count(*) from auth.users where email_confirmed_at is not null),
 'new_7',(select count(*) from auth.users where (created_at at time zone 'Asia/Taipei')::date>=today-6),
 'active_today',(select count(distinct user_id) from rise_private.member_activity where activity_date=today),
 'active_7',(select count(distinct user_id) from rise_private.member_activity where activity_date>=today-6),
 'active_30',(select count(distinct user_id) from rise_private.member_activity where activity_date>=today-29),
 'started_at',(select started_at from rise_private.admin_console_settings where id),
 'roles',(select coalesce(jsonb_object_agg(role,n),'{}'::jsonb) from (select coalesce(p.role,'missing') role,count(*) n from auth.users u left join public.rise_profiles p on p.id=u.id group by p.role) r),
 'daily',(select jsonb_agg(jsonb_build_object('date',d,'active',(select count(*) from rise_private.member_activity where activity_date=d),'registrations',(select count(*) from auth.users where (created_at at time zone 'Asia/Taipei')::date=d)) order by d) from (select today-i d from generate_series(0,29) i) days)
 ) into result;
 return result;
end;$$;

create or replace function public.rise_admin_set_role(p_user_id uuid,p_role text,p_expected_role text) returns void
language plpgsql security definer set search_path='' as $$
declare previous text;
begin
 -- 管理員角色修改序列化，避免同時移除所有管理員。
 perform pg_advisory_xact_lock(723461092);
 if not rise_private.console_admin() then raise exception 'rise:僅限已驗證的管理員使用。' using errcode='42501';end if;
 if p_user_id=auth.uid() then raise exception 'rise:不能在此修改自己的角色。';end if;
 if p_role is null or p_role not in ('student','ta','teacher','admin') then raise exception 'rise:角色不正確。';end if;
 select role into previous from public.rise_profiles where id=p_user_id for update;
 if not found then raise exception 'rise:找不到會員資料，請先在後端補齊。';end if;
 if previous is distinct from p_expected_role then raise exception 'rise:角色已變更，請重新整理。';end if;
 if previous=p_role then return;end if;
 if p_role<>'student' and not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then raise exception 'rise:會員須先完成信箱驗證。';end if;
 if previous='admin' and p_role<>'admin' and (select count(*) from public.rise_profiles where role='admin')<=1 then raise exception 'rise:必須保留至少一位管理員。';end if;
 update public.rise_profiles set role=p_role where id=p_user_id;
 insert into rise_private.member_role_events(actor_id,target_id,old_role,new_role) values(auth.uid(),p_user_id,previous,p_role);
end;$$;

create or replace function public.rise_admin_update_member(p_user_id uuid,p_display_name text,p_expected_name text) returns void
language plpgsql security definer set search_path='' as $
declare previous_name text;
begin
 if not rise_private.console_admin() then raise exception 'rise:僅限已驗證的管理員使用。' using errcode='42501';end if;
 if p_user_id is null or char_length(trim(coalesce(p_display_name,''))) not between 1 and 80 then raise exception 'rise:姓名需為1至80字。';end if;
 select display_name into previous_name from public.rise_profiles where id=p_user_id for update;
 if not found then raise exception 'rise:找不到會員資料，請先在後端補齊。';end if;
 if previous_name is distinct from p_expected_name then raise exception 'rise:姓名已被其他人更新，請重新整理。';end if;
 update public.rise_profiles set display_name=trim(p_display_name) where id=p_user_id;
end;$;

create or replace function public.rise_admin_delete_member(p_user_id uuid,p_expected_role text) returns void
language plpgsql security definer set search_path='' as $
declare previous_role text;
begin
 perform pg_advisory_xact_lock(723461093);
 if not rise_private.console_admin() then raise exception 'rise:僅限已驗證的管理員使用。' using errcode='42501';end if;
 if p_user_id is null or p_user_id=auth.uid() then raise exception 'rise:不能刪除目前登入的管理員帳號。';end if;
 select role into previous_role from public.rise_profiles where id=p_user_id for update;
 if not found then raise exception 'rise:找不到會員資料，請先在後端補齊。';end if;
 if previous_role is distinct from p_expected_role then raise exception 'rise:會員資料已變更，請重新整理。';end if;
 if previous_role='admin' and (select count(*) from public.rise_profiles where role='admin')<=1 then raise exception 'rise:必須保留至少一位管理員。';end if;
 delete from storage.objects where bucket_id in ('rise-credentials','rise-teaching-files') and (name=p_user_id::text or name like p_user_id::text||'/%');
 delete from auth.users where id=p_user_id;
end;$;

revoke all on function public.rise_record_activity() from public,anon;
revoke all on function public.rise_admin_members(text,text,integer) from public,anon;
revoke all on function public.rise_admin_statistics() from public,anon;
revoke all on function public.rise_admin_set_role(uuid,text,text) from public,anon;
revoke all on function public.rise_admin_update_member(uuid,text,text) from public,anon;
revoke all on function public.rise_admin_delete_member(uuid,text) from public,anon;
grant execute on function public.rise_record_activity() to authenticated;
grant execute on function public.rise_admin_members(text,text,integer) to authenticated;
grant execute on function public.rise_admin_statistics() to authenticated;
grant execute on function public.rise_admin_set_role(uuid,text,text) to authenticated;
grant execute on function public.rise_admin_update_member(uuid,text,text) to authenticated;
grant execute on function public.rise_admin_delete_member(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;

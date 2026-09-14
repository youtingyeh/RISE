-- RISE 帳號與教師申請：於新的 Supabase 專案 SQL Editor 執行一次。
-- 若已存在同名資料表，請停止並先做 migration；不要刪除資料重跑。
begin;
create schema if not exists rise_private;
revoke all on schema rise_private from public;
grant usage on schema rise_private to authenticated;
create table public.rise_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check(char_length(display_name) between 1 and 80),
 role text not null default 'student' check(role in ('student','teacher','ta','admin')),
 requested_kind text not null default 'student' check(requested_kind in ('student','teacher')),
 created_at timestamptz not null default now()
);
create table public.rise_teacher_applications (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references public.rise_profiles(id) on delete cascade,
 applicant_name text not null,
 email text not null,
 school text not null check(char_length(school) between 1 and 160),
 subject text not null check(subject in ('math','physics','chemistry','multiple')),
 reason text not null check(char_length(reason) between 1 and 2000),
 status text not null default 'pending' check(status in ('pending','returned','approved','rejected')),
 version integer not null default 1,
 review_note text not null default '' check(char_length(review_note)<=2000),
 reviewer_id uuid references auth.users(id) on delete set null,
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index rise_application_queue on public.rise_teacher_applications(status,created_at desc,id);
create table public.rise_application_events (
 id uuid primary key default gen_random_uuid(),
 application_id uuid not null references public.rise_teacher_applications(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 action text not null,
 note text not null default '',
 snapshot jsonb not null,
 created_at timestamptz not null default now()
);
create index rise_event_application on public.rise_application_events(application_id,created_at desc);
-- 用不可由一般使用者編輯的資料表判斷角色；不信任註冊 metadata 的 role。
create function rise_private.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rise_profiles where id=auth.uid() and role='admin');
$$;
revoke all on function rise_private.is_admin() from public;
grant execute on function rise_private.is_admin() to authenticated;
create function rise_private.handle_new_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.rise_profiles(id,display_name,role,requested_kind)
 values(new.id,coalesce(nullif(left(trim(new.raw_user_meta_data->>'display_name'),80),''),'RISE 使用者'),
 'student',case when new.raw_user_meta_data->>'requested_kind'='teacher' then 'teacher' else 'student' end);
 return new;
end;
$$;
revoke all on function rise_private.handle_new_user() from public;
create trigger rise_on_auth_user_created after insert on auth.users
for each row execute function rise_private.handle_new_user();
-- 若專案中已先建立測試使用者，補齊一般學習帳號；不會升級任何人為管理員。
insert into public.rise_profiles(id,display_name,requested_kind)
select id,coalesce(nullif(left(trim(raw_user_meta_data->>'display_name'),80),''),'RISE 使用者'),
case when raw_user_meta_data->>'requested_kind'='teacher' then 'teacher' else 'student' end
from auth.users on conflict(id) do nothing;

alter table public.rise_profiles enable row level security;
alter table public.rise_teacher_applications enable row level security;
alter table public.rise_application_events enable row level security;
revoke all on public.rise_profiles,public.rise_teacher_applications,public.rise_application_events from anon,authenticated;
grant select on public.rise_profiles,public.rise_teacher_applications,public.rise_application_events to authenticated;
create policy rise_profile_read on public.rise_profiles for select to authenticated
 using(id=auth.uid() or rise_private.is_admin());
create policy rise_application_read on public.rise_teacher_applications for select to authenticated
 using(user_id=auth.uid() or rise_private.is_admin());
create policy rise_event_read on public.rise_application_events for select to authenticated
 using(exists(select 1 from public.rise_teacher_applications a where a.id=application_id and (a.user_id=auth.uid() or rise_private.is_admin())));

create function public.rise_submit_teacher_application(p_school text,p_subject text,p_reason text,p_expected_version integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); p public.rise_profiles%rowtype; a public.rise_teacher_applications%rowtype; verified_email text;
begin
 if u is null then raise exception 'rise:請先登入。';end if;
 select email into verified_email from auth.users where id=u and email_confirmed_at is not null;
 if verified_email is null then raise exception 'rise:請先驗證信箱。';end if;
 -- 鎖定帳號，讓同一帳號的首次送件與重送串行執行。
 select * into p from public.rise_profiles where id=u for update;
 if not found or p.role<>'student' then raise exception 'rise:目前帳號不適用教師申請。';end if;
 if p_school is null or char_length(trim(p_school)) not between 1 and 160
 or p_reason is null or char_length(trim(p_reason)) not between 1 and 2000
 or p_subject is null or p_subject not in ('math','physics','chemistry','multiple')
 then raise exception 'rise:請完整填寫學校、學科與申請說明。';end if;
 select * into a from public.rise_teacher_applications where user_id=u for update;
 if found then
   if a.status<>'returned' then raise exception 'rise:申請已在審核或已結案，不能重複提交。';end if;
   if p_expected_version is distinct from a.version then raise exception 'rise:申請已更新，請重新載入後再送出。';end if;
   update public.rise_teacher_applications set school=trim(p_school),subject=p_subject,reason=trim(p_reason),
   applicant_name=p.display_name,email=verified_email,status='pending',review_note='',reviewer_id=null,reviewed_at=null,
   version=version+1,updated_at=now() where id=a.id returning * into a;
 else
   if p_expected_version is distinct from 0 then raise exception 'rise:申請版本不一致，請重新載入。';end if;
   insert into public.rise_teacher_applications(user_id,applicant_name,email,school,subject,reason)
   values(u,p.display_name,verified_email,trim(p_school),p_subject,trim(p_reason)) returning * into a;
 end if;
 insert into public.rise_application_events(application_id,actor_id,action,note,snapshot)
 values(a.id,u,case when a.version=1 then '提交申請' else '補件重新送審' end,'已提交供管理員審核。',to_jsonb(a));
 return a.id;
end;
$$;
revoke all on function public.rise_submit_teacher_application(text,text,text,integer) from public;
grant execute on function public.rise_submit_teacher_application(text,text,text,integer) to authenticated;

create function public.rise_review_teacher_application(p_application_id uuid,p_decision text,p_note text,p_expected_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare a public.rise_teacher_applications%rowtype; target uuid; target_role text;
begin
 if not rise_private.is_admin() then raise exception 'rise:只有管理員可以審核。';end if;
 if p_decision is null or p_decision not in ('approved','returned','rejected') then raise exception 'rise:審核決定不正確。';end if;
 if char_length(coalesce(p_note,''))>2000 then raise exception 'rise:審核意見過長。';end if;
 if p_decision<>'approved' and char_length(trim(coalesce(p_note,'')))=0 then raise exception 'rise:請填寫補件要求或未核准原因。';end if;
 select user_id into target from public.rise_teacher_applications where id=p_application_id;
 if target is null then raise exception 'rise:找不到申請。';end if;
 if target=auth.uid() then raise exception 'rise:不能審核自己的申請。';end if;
 -- 與提交函式採相同鎖定順序，避免同時操作衝突。
 select role into target_role from public.rise_profiles where id=target for update;
 select * into a from public.rise_teacher_applications where id=p_application_id for update;
 if not found or a.status<>'pending' or a.version is distinct from p_expected_version
 then raise exception 'rise:此案件已被處理或更新，請重新整理。';end if;
 if target_role<>'student' then raise exception 'rise:帳號身分已變更，請先確認權限。';end if;
 if not exists(select 1 from auth.users where id=target and email_confirmed_at is not null)
 then raise exception 'rise:申請人尚未完成信箱驗證。';end if;
 if p_decision='approved' then update public.rise_profiles set role='teacher' where id=target;end if;
 update public.rise_teacher_applications set status=p_decision,review_note=trim(coalesce(p_note,'')),
 reviewer_id=auth.uid(),reviewed_at=now(),updated_at=now(),version=version+1
 where id=a.id returning * into a;
 insert into public.rise_application_events(application_id,actor_id,action,note,snapshot)
 values(a.id,auth.uid(),case p_decision when 'approved' then '核准教師資格' when 'returned' then '退回補件' else '不予核准' end,a.review_note,to_jsonb(a));
end;
$$;
revoke all on function public.rise_review_teacher_application(uuid,text,text,integer) from public;
grant execute on function public.rise_review_teacher_application(uuid,text,text,integer) to authenticated;
commit;
-- 第一位管理員：帳號完成信箱驗證後，在 Dashboard SQL Editor 以其 UUID 明確指派。
-- 下列為範例，請勿使用預設 UUID；替換後才執行。
-- update public.rise_profiles set role='admin'
-- where id='替換成你自己的使用者UUID'::uuid
-- and exists(select 1 from auth.users u where u.id=rise_profiles.id and u.email_confirmed_at is not null);
-- 助教同理由團隊手動指派 role='ta'，不提供自行註冊升權。


-- RISE 意見與修正回報。可重複執行；在 setup.sql（rise_profiles）之後執行。
-- 資料表不對 anon/authenticated 開放；所有存取都經過下列 RPC，權限在資料庫內驗證。
begin;
do $$begin
 if to_regclass('public.rise_profiles') is null then raise exception 'Install the account system first.';end if;
end $$;
create schema if not exists rise_private;
revoke all on schema rise_private from public;

create table if not exists public.rise_feedback(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('bug','content','suggestion','other')),
 page text not null default '' check(char_length(page)<=200),
 title text not null check(char_length(title) between 3 and 120),
 body text not null check(char_length(body) between 10 and 3000),
 client_info text not null default '' check(char_length(client_info)<=200),
 status text not null default 'new' check(status in ('new','triaged','in_progress','resolved','wontfix','duplicate')),
 priority text not null default 'normal' check(priority in ('low','normal','high')),
 admin_note text not null default '' check(char_length(admin_note)<=2000),
 public_reply text not null default '' check(char_length(public_reply)<=1000),
 duplicate_of uuid references public.rise_feedback(id) on delete set null,
 triaged_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists rise_feedback_status_idx on public.rise_feedback(status,created_at desc);
create index if not exists rise_feedback_user_idx on public.rise_feedback(user_id,created_at desc);

create table if not exists public.rise_feedback_events(
 id bigint generated always as identity primary key,
 feedback_id uuid not null references public.rise_feedback(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 changes jsonb not null,
 created_at timestamptz not null default now()
);

-- 每日彙整紀錄：同一天只會有一列，重送不會重複計算。
create table if not exists public.rise_feedback_digest(
 day date primary key,
 window_start timestamptz not null,
 window_end timestamptz not null,
 state text not null default 'pending' check(state in ('pending','sending','sent')),
 attempts integer not null default 0,
 site_check jsonb,
 available_at timestamptz not null default now(),
 sent_at timestamptz,
 created_at timestamptz not null default now()
);

alter table public.rise_feedback enable row level security;
alter table public.rise_feedback_events enable row level security;
alter table public.rise_feedback_digest enable row level security;
revoke all on public.rise_feedback,public.rise_feedback_events,public.rise_feedback_digest from public,anon,authenticated;
grant all on public.rise_feedback,public.rise_feedback_events,public.rise_feedback_digest to service_role;
grant usage,select on sequence public.rise_feedback_events_id_seq to service_role;

create or replace function rise_private.feedback_is_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rise_profiles p join auth.users u on u.id=p.id
 where p.id=auth.uid() and p.role='admin' and u.email_confirmed_at is not null);
$$;
revoke all on function rise_private.feedback_is_admin() from public,anon,authenticated;

-- 送出：限已驗證信箱的會員；24 小時最多 10 則；相同內容 24 小時內不重複建立。
create or replace function public.rise_submit_feedback(p_kind text,p_page text,p_title text,p_body text,p_client_info text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();new_id uuid;clean_page text;clean_title text:=btrim(coalesce(p_title,''));clean_body text:=btrim(coalesce(p_body,''));
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null)
  then raise exception 'rise:請先登入並驗證信箱再送出回報。' using errcode='42501';end if;
 if not exists(select 1 from public.rise_profiles where id=uid) then raise exception 'rise:找不到會員資料。' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('bug','content','suggestion','other') then raise exception 'rise:請選擇回報類型。';end if;
 if char_length(clean_title) not between 3 and 120 then raise exception 'rise:標題需為 3 到 120 字。';end if;
 if char_length(clean_body) not between 10 and 3000 then raise exception 'rise:說明需為 10 到 3000 字。';end if;
 -- 只接受本站相對頁面（如 math.html、questions.html?id=…），避免被當成外部連結蒐集。
 clean_page:=left(regexp_replace(btrim(coalesce(p_page,'')),'^.*/RISE/',''),200);
 if clean_page<>'' and clean_page !~ '^[A-Za-z0-9_./?=&%#-]+$' then clean_page:='';end if;
 if (select count(*) from public.rise_feedback where user_id=uid and created_at>now()-interval '24 hours')>=10
  then raise exception 'rise:24 小時內最多送出 10 則回報，請明天再試或直接寄信給管理員。' using errcode='54000';end if;
 select id into new_id from public.rise_feedback where user_id=uid and kind=p_kind and page=clean_page and body=clean_body and created_at>now()-interval '24 hours' limit 1;
 if new_id is not null then return new_id;end if;
 insert into public.rise_feedback(user_id,kind,page,title,body,client_info)
 values(uid,p_kind,clean_page,clean_title,clean_body,left(coalesce(p_client_info,''),200)) returning id into new_id;
 return new_id;
end $$;
revoke all on function public.rise_submit_feedback(text,text,text,text,text) from public,anon;
grant execute on function public.rise_submit_feedback(text,text,text,text,text) to authenticated;

-- 我的回報：只看自己的，且只含公開回覆，不含管理員內部備註。
create or replace function public.rise_my_feedback() returns table(id uuid,kind text,page text,title text,body text,status text,public_reply text,created_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
 select f.id,f.kind,f.page,f.title,f.body,f.status,f.public_reply,f.created_at,f.updated_at
 from public.rise_feedback f where f.user_id=auth.uid() order by f.created_at desc limit 100;
$$;
revoke all on function public.rise_my_feedback() from public,anon;
grant execute on function public.rise_my_feedback() to authenticated;

create or replace function public.rise_admin_feedback(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not rise_private.feedback_is_admin() then raise exception 'rise:僅已驗證的管理員可以查看回報。' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
  select f.id,f.kind,f.page,f.title,f.body,f.client_info,f.status,f.priority,f.admin_note,f.public_reply,f.duplicate_of,f.created_at,f.updated_at,
   coalesce(nullif(p.display_name,''),'（未填姓名）') as submitter,
   (select count(*) from public.rise_feedback g where g.id<>f.id and g.kind=f.kind and g.page=f.page and g.page<>'' and g.status in ('new','triaged','in_progress')) as similar_open
  from public.rise_feedback f left join public.rise_profiles p on p.id=f.user_id
  where p_status is null or p_status='' or (p_status='open' and f.status in ('new','triaged','in_progress')) or f.status=p_status
  order by f.created_at desc limit 500) r),'[]'::jsonb);
end $$;
revoke all on function public.rise_admin_feedback(text) from public,anon;
grant execute on function public.rise_admin_feedback(text) to authenticated;

create or replace function public.rise_admin_triage_feedback(p_id uuid,p_status text,p_priority text,p_admin_note text,p_public_reply text,p_duplicate_of uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare old public.rise_feedback;
begin
 if not rise_private.feedback_is_admin() then raise exception 'rise:僅已驗證的管理員可以處理回報。' using errcode='42501';end if;
 if p_status not in ('new','triaged','in_progress','resolved','wontfix','duplicate') then raise exception 'rise:狀態不正確。';end if;
 if p_priority not in ('low','normal','high') then raise exception 'rise:優先順序不正確。';end if;
 if char_length(coalesce(p_admin_note,''))>2000 or char_length(coalesce(p_public_reply,''))>1000 then raise exception 'rise:備註或回覆過長。';end if;
 if p_status='duplicate' and (p_duplicate_of is null or p_duplicate_of=p_id or not exists(select 1 from public.rise_feedback where id=p_duplicate_of))
  then raise exception 'rise:標記重複時請指定另一則存在的回報。';end if;
 select * into old from public.rise_feedback where id=p_id for update;
 if not found then raise exception 'rise:找不到這則回報。';end if;
 update public.rise_feedback set status=p_status,priority=p_priority,admin_note=coalesce(p_admin_note,''),public_reply=coalesce(p_public_reply,''),
  duplicate_of=case when p_status='duplicate' then p_duplicate_of else null end,triaged_by=auth.uid(),updated_at=now() where id=p_id;
 insert into public.rise_feedback_events(feedback_id,actor_id,changes) values(p_id,auth.uid(),jsonb_build_object(
  'from',jsonb_build_object('status',old.status,'priority',old.priority),'to',jsonb_build_object('status',p_status,'priority',p_priority)));
end $$;
revoke all on function public.rise_admin_triage_feedback(uuid,text,text,text,text,uuid) from public,anon;
grant execute on function public.rise_admin_triage_feedback(uuid,text,text,text,text,uuid) to authenticated;

-- 統整：給管理頁與每日信共用。p_since 之後視為「新收集」。
create or replace function rise_private.feedback_summary(p_since timestamptz,p_until timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'generated_at',now(),
  'window',jsonb_build_object('since',p_since,'until',p_until),
  'open_total',(select count(*) from public.rise_feedback where status in ('new','triaged','in_progress')),
  'untriaged',(select count(*) from public.rise_feedback where status='new'),
  'high_open',(select count(*) from public.rise_feedback where priority='high' and status in ('new','triaged','in_progress')),
  'stale_untriaged',(select count(*) from public.rise_feedback where status='new' and created_at<now()-interval '3 days'),
  'resolved_in_window',(select count(*) from public.rise_feedback where status='resolved' and updated_at>=p_since and updated_at<p_until),
  'by_kind_open',coalesce((select jsonb_object_agg(kind,n) from (select kind,count(*) n from public.rise_feedback where status in ('new','triaged','in_progress') group by kind) s),'{}'::jsonb),
  'new_items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'page',page,'title',title,'body',left(body,400),'priority',priority,'created_at',created_at) order by created_at) from (
    select * from public.rise_feedback where created_at>=p_since and created_at<p_until order by created_at limit 50) n),'[]'::jsonb),
  'new_count',(select count(*) from public.rise_feedback where created_at>=p_since and created_at<p_until),
  'repeat_pages',coalesce((select jsonb_agg(jsonb_build_object('page',page,'kind',kind,'count',n,'titles',titles) order by n desc) from (
    select page,kind,count(*) n,(array_agg(left(title,60) order by created_at desc))[1:3] titles from public.rise_feedback
    where page<>'' and status in ('new','triaged','in_progress') group by page,kind having count(*)>=2 order by count(*) desc limit 10) g),'[]'::jsonb),
  'oldest_open',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',left(title,80),'page',page,'status',status,'priority',priority,'created_at',created_at) order by created_at) from (
    select * from public.rise_feedback where status in ('new','triaged','in_progress') order by created_at limit 5) o),'[]'::jsonb)
 );
$$;
revoke all on function rise_private.feedback_summary(timestamptz,timestamptz) from public,anon,authenticated;

create or replace function public.rise_admin_feedback_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not rise_private.feedback_is_admin() then raise exception 'rise:僅已驗證的管理員可以查看彙整。' using errcode='42501';end if;
 return rise_private.feedback_summary(coalesce((select max(window_end) from public.rise_feedback_digest where state='sent'),now()-interval '1 day'),now());
end $$;
revoke all on function public.rise_admin_feedback_summary() from public,anon;
grant execute on function public.rise_admin_feedback_summary() to authenticated;

-- 每日彙整：建立／領取當日工作。已寄出回傳 null；寄送中的失敗 10 分鐘後可重試。
create or replace function public.rise_claim_feedback_digest(p_day date,p_site_check jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.rise_feedback_digest;prev timestamptz;
begin
 select max(window_end) into prev from public.rise_feedback_digest where state='sent' and day<p_day;
 insert into public.rise_feedback_digest(day,window_start,window_end,site_check)
 values(p_day,coalesce(prev,now()-interval '1 day'),now(),p_site_check) on conflict(day) do nothing;
 update public.rise_feedback_digest set state='sending',attempts=attempts+1,available_at=now()+interval '10 minutes',
  site_check=coalesce(p_site_check,site_check)
 where day=p_day and state<>'sent' and available_at<=now() returning * into d;
 if not found then return null;end if;
 return jsonb_build_object('day',d.day,'attempts',d.attempts,'site_check',d.site_check,
  'summary',rise_private.feedback_summary(d.window_start,d.window_end));
end $$;
revoke all on function public.rise_claim_feedback_digest(date,jsonb) from public,anon,authenticated;
grant execute on function public.rise_claim_feedback_digest(date,jsonb) to service_role;

create or replace function public.rise_finish_feedback_digest(p_day date,p_sent boolean) returns void
language sql security definer set search_path='' as $$
 update public.rise_feedback_digest set state=case when p_sent then 'sent' else 'pending' end,
  sent_at=case when p_sent then now() else sent_at end,
  available_at=case when p_sent then available_at else now()+interval '10 minutes' end
 where day=p_day and state='sending';
$$;
revoke all on function public.rise_finish_feedback_digest(date,boolean) from public,anon,authenticated;
grant execute on function public.rise_finish_feedback_digest(date,boolean) to service_role;

-- 當天沒有新回報、不寄信時釋放領取：刪除寄送中的當日列，下次統計區間仍從上一封已寄出的彙整起算，不會漏算。
create or replace function public.rise_release_feedback_digest(p_day date) returns void
language sql security definer set search_path='' as $$
 delete from public.rise_feedback_digest where day=p_day and state='sending';
$$;
revoke all on function public.rise_release_feedback_digest(date) from public,anon,authenticated;
grant execute on function public.rise_release_feedback_digest(date) to service_role;

notify pgrst,'reload schema';
commit;

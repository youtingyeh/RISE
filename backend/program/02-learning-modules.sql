-- Requires 01-question-history.sql and existing question-advisor.sql.
begin;
create schema if not exists rise_program;
revoke all on schema rise_program from public,anon,authenticated;
create table if not exists rise_program.units(
 id uuid primary key default gen_random_uuid(),owner_id uuid references auth.users(id) on delete set null,
 course_id uuid references rise_work.classifications(id),title text not null check(length(trim(title)) between 1 and 160),
 core text not null check(length(trim(core)) between 1 and 20000),reading text not null check(length(trim(reading)) between 1 and 20000),challenge text not null check(length(trim(challenge)) between 1 and 20000),
 minutes integer not null check(minutes between 1 and 30),exercises jsonb not null check(jsonb_typeof(exercises)='array' and jsonb_array_length(exercises) between 3 and 5),
 visual_url text not null default '',published boolean not null default false,created_at timestamptz not null default now());
create table if not exists rise_program.unit_visits(
 user_id uuid references auth.users(id) on delete cascade,unit_id uuid references rise_program.units(id) on delete cascade,
 first_opened timestamptz not null default now(),last_opened timestamptz not null default now(),primary key(user_id,unit_id));
create table if not exists rise_program.practice(
 id uuid primary key default gen_random_uuid(),unit_id uuid references rise_program.units(id) on delete cascade,
 student_id uuid references auth.users(id) on delete cascade,version integer not null,answers jsonb not null,change_note text not null default '',created_at timestamptz not null default now(),unique(unit_id,student_id,version));
create table if not exists rise_program.practice_reviews(
 id uuid primary key default gen_random_uuid(),practice_id uuid references rise_program.practice(id) on delete cascade,
 reviewer_id uuid references auth.users(id) on delete set null,analysis text not null,improvement text not null,followup text not null,passed boolean not null,created_at timestamptz not null default now(),unique(practice_id,reviewer_id));
create table if not exists rise_program.ai_analyses(
 id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete cascade,
 input_hash text not null,model text not null,prompt_version text not null,tags jsonb not null,
 created_at timestamptz not null default now(),check(jsonb_typeof(tags)='array'));
create or replace function rise_program.unit_visible(p_unit uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from rise_program.units x where x.id=p_unit and (
 rise_work.role()='admin' or (rise_work.role()='teacher' and x.owner_id=auth.uid()) or
 (x.published and (x.course_id is null or rise_work.course_allowed(x.course_id) or exists(select 1 from rise_work.class_members m where m.course_id=x.course_id and m.user_id=auth.uid())))));
$$;
create or replace function rise_program.practice_visible(s uuid,unit uuid) returns boolean language sql stable security definer set search_path='' as $$
 select s=auth.uid() or rise_work.role()='admin' or (rise_work.role()='teacher' and rise_work.student_allowed(s) and exists(select 1 from rise_program.units u where u.id=unit and (u.course_id is null or rise_work.course_allowed(u.course_id))));
$$;
create or replace function public.rise_module_api(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare r text:=rise_work.role();u uuid:=auth.uid();ident uuid:=nullif(p_data->>'id','')::uuid;c uuid;v integer;x rise_program.units%rowtype;pr rise_program.practice%rowtype;item jsonb;
begin
 if r is null then raise exception 'rise:請先登入並驗證信箱。' using errcode='42501';end if;
 if p_action='list' then return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),'[]') from rise_program.units t where rise_program.unit_visible(t.id)));
 elsif p_action='state' then
 select * into x from rise_program.units where id=ident for update;
 if not found or r not in ('teacher','admin') or (r<>'admin' and (x.owner_id<>u or (x.course_id is null and not rise_work.all_courses()) or (x.course_id is not null and not rise_work.course_allowed(x.course_id)))) then raise exception 'rise:無權管理此單元。' using errcode='42501';end if;
 update rise_program.units set published=(p_data->>'published')::boolean where id=ident;return '{"saved":true}';
 elsif p_action='save' then
 if r not in ('teacher','admin') then raise exception 'rise:僅教師與管理員可編輯單元。' using errcode='42501';end if;
 c:=nullif(p_data->>'course_id','')::uuid;
 if (c is null and not rise_work.all_courses()) or (c is not null and not rise_work.course_allowed(c)) then raise exception 'rise:單元課程超出授權範圍。' using errcode='42501';end if;
 if coalesce(p_data->>'visual_url','')<>'' and p_data->>'visual_url' !~ '^https://(www\.)?(geogebra\.org|desmos\.com|phet\.colorado\.edu)/' then raise exception 'rise:視覺化工具請使用 GeoGebra、Desmos 或 PhET 的 HTTPS 連結。';end if;
 if jsonb_typeof(p_data->'exercises') is distinct from 'array' then raise exception 'rise:請填寫 3–5 題練習。';end if;
 for item in select value from jsonb_array_elements(p_data->'exercises') loop if jsonb_typeof(item)<>'string' or length(trim(item#>>'{}')) not between 1 and 2000 then raise exception 'rise:練習題不可空白或超過 2000 字。';end if;end loop;
 if ident is null then
 insert into rise_program.units(owner_id,course_id,title,core,reading,challenge,minutes,exercises,visual_url,published)
 values(u,c,trim(p_data->>'title'),trim(p_data->>'core'),trim(p_data->>'reading'),trim(p_data->>'challenge'),(p_data->>'minutes')::integer,p_data->'exercises',coalesce(p_data->>'visual_url',''),coalesce((p_data->>'published')::boolean,false)) returning id into ident;
 else
 perform 1 from rise_program.units where id=ident and (owner_id=u or r='admin') for update;
 if not found then raise exception 'rise:無權編輯此單元。' using errcode='42501';end if;
 if exists(select 1 from rise_program.practice where unit_id=ident) then raise exception 'rise:已有習作的單元不能覆寫內容，請建立新版單元。';end if;
 update rise_program.units set course_id=c,title=trim(p_data->>'title'),core=trim(p_data->>'core'),reading=trim(p_data->>'reading'),challenge=trim(p_data->>'challenge'),minutes=(p_data->>'minutes')::integer,exercises=p_data->'exercises',visual_url=coalesce(p_data->>'visual_url',''),published=coalesce((p_data->>'published')::boolean,false) where id=ident;
 end if;return jsonb_build_object('id',ident);
 elsif p_action in ('open','submit','detail') then
 select * into x from rise_program.units where id=ident;
 if not found or not rise_program.unit_visible(ident) then raise exception 'rise:無權查看此單元。' using errcode='42501';end if;
 if p_action='open' then if r<>'student' then return '{"saved":false}';end if;insert into rise_program.unit_visits(user_id,unit_id) values(u,ident) on conflict(user_id,unit_id) do update set last_opened=now();return '{"saved":true}';end if;
 if p_action='submit' then
 if r<>'student' or not x.published then raise exception 'rise:僅學生能提交已發布單元的習作。' using errcode='42501';end if;
 perform 1 from public.rise_profiles where id=u for update;
 select coalesce(max(version),0) into v from rise_program.practice where unit_id=ident and student_id=u;
 if v is distinct from (p_data->>'expected_version')::integer then raise exception 'rise:版本已更新，請重新讀取。';end if;
 if jsonb_typeof(p_data->'answers') is distinct from 'array' or jsonb_array_length(p_data->'answers')<>jsonb_array_length(x.exercises) then raise exception 'rise:請完成每一道練習題。';end if;
 for item in select value from jsonb_array_elements(p_data->'answers') loop if jsonb_typeof(item)<>'string' or length(trim(item#>>'{}')) not between 1 and 10000 then raise exception 'rise:每題須填寫推理過程，最多 10000 字。';end if;end loop;
 if v>0 and coalesce(length(trim(p_data->>'change_note')),0)=0 then raise exception 'rise:修訂時請填寫修改說明。';end if;
 insert into rise_program.practice(unit_id,student_id,version,answers,change_note) values(ident,u,v+1,p_data->'answers',coalesce(p_data->>'change_note',''));return '{"saved":true}';end if;
 return jsonb_build_object('submissions',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('student_name',(select p.display_name from public.rise_profiles p where p.id=t.student_id)) order by created_at desc),'[]') from rise_program.practice t where unit_id=ident and rise_program.practice_visible(t.student_id,t.unit_id)),
 'reviews',(select coalesce(jsonb_agg(to_jsonb(g) order by g.created_at),'[]') from rise_program.practice_reviews g join rise_program.practice t on t.id=g.practice_id where t.unit_id=ident and rise_program.practice_visible(t.student_id,t.unit_id)));
 elsif p_action='review' then
 select * into pr from rise_program.practice where id=ident;
 if not found or r not in ('teacher','admin') or pr.student_id=u or not rise_program.practice_visible(pr.student_id,pr.unit_id) then raise exception 'rise:無權批閱此習作。' using errcode='42501';end if;
 if coalesce(length(trim(p_data->>'analysis')),0) not between 1 and 3000 or coalesce(length(trim(p_data->>'improvement')),0) not between 1 and 3000 or coalesce(length(trim(p_data->>'followup')),0) not between 1 and 3000 then raise exception 'rise:請完整填寫三要素批閱。';end if;
 insert into rise_program.practice_reviews(practice_id,reviewer_id,analysis,improvement,followup,passed) values(ident,u,trim(p_data->>'analysis'),trim(p_data->>'improvement'),trim(p_data->>'followup'),(p_data->>'passed')::boolean);return '{"saved":true}';
 end if;raise exception 'rise:不支援的單元操作。';
end $$;
create or replace function public.rise_record_ai_analysis(p_user_id uuid,p_hash text,p_model text,p_tags jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare ident uuid; t jsonb;
begin
 if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then raise exception 'invalid user';end if;
 if p_hash !~ '^[0-9a-f]{64}$' or coalesce(length(p_model),0) not between 1 and 200 or jsonb_typeof(p_tags) is distinct from 'array' or jsonb_array_length(p_tags)>3 then raise exception 'invalid analysis';end if;
 for t in select value from jsonb_array_elements(p_tags) loop
 if t->>'code' is null or t->>'code' not in ('calculation_slip','logic_gap','concept_misuse') or jsonb_typeof(t->'confidence') is distinct from 'number' or (t->>'confidence')::numeric not between 0 and 1 or coalesce(length(t->>'reason'),0) not between 1 and 500 then raise exception 'invalid tag';end if;end loop;
 insert into rise_program.ai_analyses(user_id,input_hash,model,prompt_version,tags) values(p_user_id,p_hash,p_model,'rise-advisor-v2',p_tags) returning id into ident;return ident;
end $$;
-- No client is allowed to create model findings; service-role Edge function only.
revoke all on function public.rise_record_ai_analysis(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.rise_record_ai_analysis(uuid,text,text,jsonb) to service_role;
revoke all on function public.rise_module_api(text,jsonb) from public,anon;
grant execute on function public.rise_module_api(text,jsonb) to authenticated;
revoke all on function rise_program.unit_visible(uuid),rise_program.practice_visible(uuid,uuid) from public,anon,authenticated;
do $$declare t text;begin foreach t in array array['units','unit_visits','practice','practice_reviews','ai_analyses'] loop execute format('alter table rise_program.%I enable row level security',t);execute format('revoke all on rise_program.%I from public,anon,authenticated',t);end loop;end $$;
notify pgrst,'reload schema';commit;

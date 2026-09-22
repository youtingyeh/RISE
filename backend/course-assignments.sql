-- Run this complete migration once; existing assignments remain assigned to all students.
-- RISE learning workflows v1. Requires existing public.rise_profiles and Supabase Auth/Storage.
begin;
create schema if not exists rise_work;
revoke all on schema rise_work from public,anon,authenticated;
create table if not exists rise_work.assignments (
 id uuid primary key default gen_random_uuid(), owner_id uuid references auth.users(id) on delete set null,
 title text not null check(char_length(title) between 1 and 160), body text not null check(char_length(body) between 1 and 20000),
 subject text not null check(subject in ('math','physics','chemistry','multiple')), due_at timestamptz,
 published boolean not null default false, closed boolean not null default false,created_at timestamptz not null default now()
);
create table if not exists rise_work.revisions (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null references rise_work.assignments(id),
 student_id uuid not null references auth.users(id) on delete cascade, version integer not null,
 body text not null check(char_length(body) between 1 and 20000), change_note text not null default '' check(char_length(change_note)<=2000),
 files jsonb not null default '[]',created_at timestamptz not null default now(), unique(assignment_id,student_id,version)
);
create table if not exists rise_work.reviews (
 id uuid primary key default gen_random_uuid(), revision_id uuid not null references rise_work.revisions(id) on delete cascade,
 reviewer_id uuid references auth.users(id) on delete set null, reviewer_role text not null,
 analysis text not null check(char_length(analysis) between 1 and 4000), improvement text not null check(char_length(improvement) between 1 and 4000),
 followup text not null check(char_length(followup) between 1 and 4000), score integer not null check(score between 0 and 4),
 outcome text not null check(outcome in ('revise','completed')), created_at timestamptz not null default now(), unique(revision_id,reviewer_id)
);
create table if not exists rise_work.courses (
 id uuid primary key default gen_random_uuid(), title text not null check(char_length(title) between 1 and 160),
 body text not null check(char_length(body) between 1 and 20000), published boolean not null default false,created_at timestamptz not null default now()
);
create table if not exists rise_work.training (
 id uuid primary key default gen_random_uuid(),course_id uuid not null references rise_work.courses(id),
 applicant_id uuid not null references auth.users(id) on delete cascade,version integer not null,
 body text not null check(char_length(body) between 1 and 20000),created_at timestamptz not null default now(),unique(course_id,applicant_id,version)
);
create table if not exists rise_work.certificates (
 id uuid primary key default gen_random_uuid(),submission_id uuid not null references rise_work.training(id) on delete cascade,
 reviewer_id uuid references auth.users(id) on delete set null,decision text not null check(decision in ('approved','returned','revoked')),
 note text not null check(char_length(note) between 1 and 4000),valid_until timestamptz,created_at timestamptz not null default now()
);
create table if not exists rise_work.competitions (
 id uuid primary key default gen_random_uuid(),owner_id uuid references auth.users(id) on delete set null,
 title text not null check(char_length(title) between 1 and 160),body text not null check(char_length(body) between 1 and 20000),
 deadline timestamptz not null,state text not null default 'draft' check(state in ('draft','open','judging','results')),created_at timestamptz not null default now()
);
create table if not exists rise_work.entries (
 id uuid primary key default gen_random_uuid(),competition_id uuid not null references rise_work.competitions(id),
 student_id uuid not null references auth.users(id) on delete cascade,version integer not null,
 division text not null check(division in ('高中','大專')),field text not null check(field in ('自然科學','人文','社會','跨領域')),
 title text not null check(char_length(title) between 1 and 160),body text not null check(char_length(body) between 1 and 20000),created_at timestamptz not null default now(),unique(competition_id,student_id,version)
);
create table if not exists rise_work.judges (
 competition_id uuid not null references rise_work.competitions(id),judge_id uuid not null references auth.users(id) on delete cascade,primary key(competition_id,judge_id)
);
create table if not exists rise_work.judgments (
 id uuid primary key default gen_random_uuid(),entry_id uuid not null references rise_work.entries(id) on delete cascade,
 judge_id uuid references auth.users(id) on delete set null,innovation integer not null check(innovation between 0 and 5),
 depth integer not null check(depth between 0 and 5),appropriateness integer not null check(appropriateness between 0 and 5),
 inspiration integer not null check(inspiration between 0 and 5),note text not null check(char_length(note) between 1 and 4000),
 created_at timestamptz not null default now(),unique(entry_id,judge_id)
);
create index if not exists wf_revision_student on rise_work.revisions(student_id,assignment_id,version desc);
create index if not exists wf_training_student on rise_work.training(applicant_id,course_id,version desc);
create index if not exists wf_entry_student on rise_work.entries(student_id,competition_id,version desc);
do $$ declare t text; begin
 foreach t in array array['assignments','revisions','reviews','courses','training','certificates','competitions','entries','judges','judgments'] loop
 execute format('alter table rise_work.%I enable row level security',t);
 execute format('revoke all on rise_work.%I from public,anon,authenticated',t);
 end loop;
end $$;

create or replace function rise_work.role() returns text language sql stable security definer set search_path='' as $$
 select p.role from public.rise_profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and u.email_confirmed_at is not null;
$$;
revoke all on function rise_work.role() from public,anon,authenticated;

-- All writes use this RPC. Never trust a role, student id, or reviewer id sent by a client.
-- Course classifications are independent from account roles and TA training courses.
-- This fragment is included in course-assignments.sql. Run that complete migration.
create table if not exists rise_work.classifications(
 id uuid primary key default gen_random_uuid(),title text not null check(char_length(trim(title)) between 1 and 100),
 description text not null default '' check(char_length(description)<=1000),active boolean not null default true,
 created_at timestamptz not null default now()
);
create unique index if not exists rise_class_title on rise_work.classifications(lower(title));
create table if not exists rise_work.class_members(
 course_id uuid not null references rise_work.classifications(id),user_id uuid not null references auth.users(id) on delete cascade,
 joined_at timestamptz not null default now(),primary key(course_id,user_id)
);
create index if not exists rise_class_user on rise_work.class_members(user_id,course_id);
alter table rise_work.classifications enable row level security;
alter table rise_work.class_members enable row level security;
revoke all on rise_work.classifications,rise_work.class_members from public,anon,authenticated;
alter table rise_work.assignments add column if not exists audience text not null default 'all' check(audience in ('all','courses','students'));
alter table rise_work.assignments add column if not exists course_ids uuid[] not null default '{}';
alter table rise_work.assignments add column if not exists student_ids uuid[] not null default '{}';

create or replace function rise_work.assignment_recipient(p_assignment uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from rise_work.assignments a where a.id=p_assignment and
 (a.audience='all' or (a.audience='students' and p_user=any(a.student_ids)) or
 (a.audience='courses' and exists(select 1 from rise_work.class_members m where m.user_id=p_user and m.course_id=any(a.course_ids)))));
$$;
revoke all on function rise_work.assignment_recipient(uuid,uuid) from public,anon,authenticated;

create or replace function rise_work.set_assignment_audience(p_id uuid,p_data jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare mode text:=coalesce(p_data->>'audience','all'); cs uuid[]:='{}'; us uuid[]:='{}';
begin
 if mode not in ('all','courses','students') then raise exception 'rise:作業對象不正確。';end if;
 if mode='courses' then
  if jsonb_typeof(p_data->'course_ids') is distinct from 'array' then raise exception 'rise:請選擇課程。';end if;
  if jsonb_array_length(p_data->'course_ids') not between 1 and 20 then raise exception 'rise:請選擇1至20門課程。';end if;
  select array_agg(distinct value::uuid) into cs from jsonb_array_elements_text(p_data->'course_ids');
  if exists(select 1 from unnest(cs) x where not exists(select 1 from rise_work.classifications c where c.id=x and c.active)) then raise exception 'rise:課程不存在或已停用。';end if;
 elsif mode='students' then
  if jsonb_typeof(p_data->'student_ids') is distinct from 'array' then raise exception 'rise:請選擇學生。';end if;
  if jsonb_array_length(p_data->'student_ids') not between 1 and 200 then raise exception 'rise:請選擇1至200位學生。';end if;
  select array_agg(distinct value::uuid) into us from jsonb_array_elements_text(p_data->'student_ids');
  if exists(select 1 from unnest(us) x where not exists(select 1 from public.rise_profiles p join auth.users u on u.id=p.id where p.id=x and p.role='student' and u.email_confirmed_at is not null)) then raise exception 'rise:只能指派給已驗證的學生帳號。';end if;
 end if;
 update rise_work.assignments set audience=mode,course_ids=cs,student_ids=us where id=p_id;
end $$;
revoke all on function rise_work.set_assignment_audience(uuid,jsonb) from public,anon,authenticated;

-- The public catalog contains course names only, never member lists.
create or replace function public.rise_course_catalog() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'description',description) order by title),'[]') from rise_work.classifications where active;
$$;
revoke all on function public.rise_course_catalog() from public;
grant execute on function public.rise_course_catalog() to anon,authenticated;

create or replace function public.rise_course_action(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r text:=rise_work.role(); ident uuid; ids uuid[]; result jsonb; term text;
begin
 if u is null or r is null then raise exception 'rise:請先登入並驗證信箱。' using errcode='42501';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'rise:資料格式不正確。';end if;
 perform 1 from public.rise_profiles where id=u for update;
 r:=rise_work.role();if r is null then raise exception 'rise:請重新登入。' using errcode='42501';end if;
 if p_action='list' then
  return jsonb_build_object('courses',(select coalesce(jsonb_agg(to_jsonb(c) order by c.title),'[]') from rise_work.classifications c where c.active or r='admin' or exists(select 1 from rise_work.class_members m where m.course_id=c.id and m.user_id=u)),
   'selected',(select coalesce(jsonb_agg(course_id),'[]') from rise_work.class_members where user_id=u));
 elsif p_action='membership' then
  if r<>'student' then raise exception 'rise:課程身分限學生自行設定。' using errcode='42501';end if;
  if jsonb_typeof(p_data->'course_ids') is distinct from 'array' then raise exception 'rise:請選擇課程。';end if;
  if jsonb_array_length(p_data->'course_ids')>20 then raise exception 'rise:最多選擇20門課程。';end if;
  select coalesce(array_agg(distinct value::uuid),'{}') into ids from jsonb_array_elements_text(p_data->'course_ids');
  if exists(select 1 from unnest(ids) x where not exists(select 1 from rise_work.classifications c where c.id=x and (c.active or exists(select 1 from rise_work.class_members m where m.course_id=x and m.user_id=u)))) then raise exception 'rise:課程不存在或已停止加入。';end if;
  delete from rise_work.class_members where user_id=u and not(course_id=any(ids));
  insert into rise_work.class_members(course_id,user_id) select unnest(ids),u on conflict do nothing;
  return jsonb_build_object('saved',true);
 elsif p_action='save' then
  if r<>'admin' then raise exception 'rise:僅管理員可設定課程分類。' using errcode='42501';end if;
  ident:=nullif(p_data->>'id','')::uuid;
  if ident is null then
   insert into rise_work.classifications(title,description,active) values(trim(p_data->>'title'),coalesce(trim(p_data->>'description'),''),coalesce((p_data->>'active')::boolean,true)) returning id into ident;
  else
   update rise_work.classifications set title=trim(p_data->>'title'),description=coalesce(trim(p_data->>'description'),''),active=coalesce((p_data->>'active')::boolean,true) where id=ident;
   if not found then raise exception 'rise:找不到課程。';end if;
  end if;
  return jsonb_build_object('id',ident);
 elsif p_action='roster' then
  if r not in ('teacher','admin') then raise exception 'rise:僅教師與管理員能選擇指派學生。' using errcode='42501';end if;
  term:=trim(coalesce(p_data->>'search',''));ident:=nullif(p_data->>'course_id','')::uuid;
  if char_length(term)<2 and ident is null then return '[]'::jsonb;end if;
  if char_length(term)>100 then raise exception 'rise:搜尋文字過長。';end if;
  select coalesce(jsonb_agg(to_jsonb(s)),'[]') into result from (
   select p.id,p.display_name from public.rise_profiles p join auth.users au on au.id=p.id
   where p.role='student' and au.email_confirmed_at is not null
   and (term='' or strpos(lower(p.display_name),lower(term))>0 or p.id::text=term)
   and (ident is null or exists(select 1 from rise_work.class_members m where m.user_id=p.id and m.course_id=ident))
   order by p.display_name,p.id limit 100
  ) s;
  return result;
 end if;
 raise exception 'rise:不支援的課程操作。';
end $$;
revoke all on function public.rise_course_action(text,jsonb) from public,anon;
grant execute on function public.rise_course_action(text,jsonb) to authenticated;

-- Enrollment at sign-up is a self-selection, not a grant of teacher/admin privileges.
create or replace function rise_work.enroll_signup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if jsonb_typeof(new.raw_user_meta_data->'course_ids')='array' then
  insert into rise_work.class_members(course_id,user_id)
   select c.id,new.id from rise_work.classifications c where c.active and c.id::text in
   (select value from jsonb_array_elements_text(new.raw_user_meta_data->'course_ids') limit 20)
   on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function rise_work.enroll_signup() from public,anon,authenticated;
drop trigger if exists rise_course_signup on auth.users;
create trigger rise_course_signup after insert on auth.users for each row execute function rise_work.enroll_signup();

create or replace function public.rise_workflow_action(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); r text:=rise_work.role(); ident uuid; parent uuid; expected integer; actual integer; nextversion integer;
 a rise_work.assignments%rowtype; rev rise_work.revisions%rowtype; tr rise_work.training%rowtype;
 contest rise_work.competitions%rowtype; ent rise_work.entries%rowtype; f jsonb; output jsonb;
begin
 if u is null or r is null or r not in ('student','ta','teacher','admin') then raise exception 'rise:請先登入並驗證信箱。' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'rise:資料格式不正確。';end if;
 -- Recheck role under a row lock, coordinating with administrative role changes.
 perform 1 from public.rise_profiles where id=u for update;
 r:=rise_work.role();
 if r is null or r not in ('student','ta','teacher','admin') then raise exception 'rise:帳號資格已變更，請重新登入。' using errcode='42501';end if;
 ident:=nullif(p_data->>'id','')::uuid;
 if p_action='assignment_create' then
  if r not in ('teacher','admin') then raise exception 'rise:僅教師與管理員能建立作業。' using errcode='42501';end if;
  insert into rise_work.assignments(owner_id,title,body,subject,due_at,published)
   values(u,trim(p_data->>'title'),trim(p_data->>'body'),p_data->>'subject',nullif(p_data->>'due_at','')::timestamptz,coalesce((p_data->>'published')::boolean,false)) returning id into ident;
  perform rise_work.set_assignment_audience(ident,p_data);
 elsif p_action='assignment_audience' then
  select * into a from rise_work.assignments where id=ident for update;
  if not found or r not in ('teacher','admin') or (a.owner_id is distinct from u and r<>'admin') then raise exception 'rise:無權管理此作業。' using errcode='42501';end if;
  perform rise_work.set_assignment_audience(ident,p_data);
 elsif p_action='assignment_state' then
  select * into a from rise_work.assignments where id=ident for update;
  if not found or r not in ('teacher','admin') or (a.owner_id is distinct from u and r<>'admin') then raise exception 'rise:無權管理此作業。' using errcode='42501';end if;
  update rise_work.assignments set published=coalesce((p_data->>'published')::boolean,published),closed=coalesce((p_data->>'closed')::boolean,closed) where id=ident;
 elsif p_action='assignment_submit' then
  if r<>'student' then raise exception 'rise:此提交入口限學生使用。' using errcode='42501';end if;
  select * into a from rise_work.assignments where id=ident for update;
  if not found or not a.published or a.closed or (a.due_at is not null and now()>a.due_at) then raise exception 'rise:作業未開放或已截止。';end if;
  if not rise_work.assignment_recipient(ident,u) then raise exception 'rise:此作業未指派給你。' using errcode='42501';end if;
  select coalesce(max(version),0) into actual from rise_work.revisions where assignment_id=ident and student_id=u;
  expected:=(p_data->>'expected_version')::integer;
  if expected is distinct from actual then raise exception 'rise:版本已更新，請重新整理確認是否已送出。';end if;
  if actual>0 and coalesce(trim(p_data->>'change_note'),'')='' then raise exception 'rise:修訂時請說明這次修改了什麼。';end if;
  if jsonb_typeof(coalesce(p_data->'files','[]'))<>'array' or jsonb_array_length(coalesce(p_data->'files','[]'))>3 then raise exception 'rise:最多三個附件。';end if;
  for f in select value from jsonb_array_elements(coalesce(p_data->'files','[]')) loop
   if coalesce(char_length(f->>'name'),0) not between 1 and 255 or not exists(select 1 from storage.objects o where o.bucket_id='rise-work-files' and o.name=f->>'path' and split_part(o.name,'/',1)=u::text) then raise exception 'rise:附件不存在或無權使用。';end if;
  end loop;
  insert into rise_work.revisions(assignment_id,student_id,version,body,change_note,files) values(ident,u,actual+1,trim(p_data->>'body'),coalesce(trim(p_data->>'change_note'),''),coalesce(p_data->'files','[]')) returning id into ident;
 elsif p_action='assignment_review' then
  if r not in ('ta','teacher','admin') then raise exception 'rise:僅教學人員可批閱。' using errcode='42501';end if;
  select * into rev from rise_work.revisions where id=ident;
  if not found or rev.student_id=u then raise exception 'rise:不能批閱此作業。';end if;
  insert into rise_work.reviews(revision_id,reviewer_id,reviewer_role,analysis,improvement,followup,score,outcome)
   values(ident,u,r,trim(p_data->>'analysis'),trim(p_data->>'improvement'),trim(p_data->>'followup'),(p_data->>'score')::integer,p_data->>'outcome') returning id into ident;
 elsif p_action='course_create' then
  if r<>'admin' then raise exception 'rise:僅管理員能管理培訓。' using errcode='42501';end if;
  insert into rise_work.courses(title,body,published) values(trim(p_data->>'title'),trim(p_data->>'body'),coalesce((p_data->>'published')::boolean,false)) returning id into ident;
 elsif p_action='course_publish' then
  if r<>'admin' then raise exception 'rise:僅管理員能管理培訓。' using errcode='42501';end if;
  update rise_work.courses set published=(p_data->>'published')::boolean where id=ident;
  if not found then raise exception 'rise:找不到課程。';end if;
 elsif p_action='training_submit' then
  if r not in ('ta','teacher') then raise exception 'rise:培訓成果限教師與助教提交。' using errcode='42501';end if;
  perform 1 from rise_work.courses where id=ident and published for update;
  if not found then raise exception 'rise:課程尚未開放。';end if;
  select coalesce(max(version),0) into actual from rise_work.training where course_id=ident and applicant_id=u;
  if (p_data->>'expected_version')::integer is distinct from actual then raise exception 'rise:版本已更新，請重新整理。';end if;
  insert into rise_work.training(course_id,applicant_id,version,body) values(ident,u,actual+1,trim(p_data->>'body')) returning id into ident;
 elsif p_action='certify' then
  if r<>'admin' then raise exception 'rise:僅管理員能核發或撤銷培訓認證。' using errcode='42501';end if;
  select * into tr from rise_work.training where id=ident for update;
  if not found or tr.applicant_id=u then raise exception 'rise:不可審核自己的培訓。';end if;
  if p_data->>'decision'<>'revoked' and exists(select 1 from rise_work.training where course_id=tr.course_id and applicant_id=tr.applicant_id and version>tr.version) then raise exception 'rise:請審核最新版本。';end if;
  insert into rise_work.certificates(submission_id,reviewer_id,decision,note,valid_until)
   values(ident,u,p_data->>'decision',trim(p_data->>'note'),case when p_data->>'decision'='approved' then now()+interval '1 year' else null end) returning id into ident;
 elsif p_action='competition_create' then
  if r not in ('teacher','admin') then raise exception 'rise:僅教師與管理員能建立競賽。' using errcode='42501';end if;
  if (p_data->>'deadline')::timestamptz<=now() then raise exception 'rise:截止時間須在未來。';end if;
  insert into rise_work.competitions(owner_id,title,body,deadline) values(u,trim(p_data->>'title'),trim(p_data->>'body'),(p_data->>'deadline')::timestamptz) returning id into ident;
 elsif p_action in ('competition_state','judge_assign','judge_remove') then
  select * into contest from rise_work.competitions where id=ident for update;
  if not found or r not in ('teacher','admin') or (contest.owner_id is distinct from u and r<>'admin') then raise exception 'rise:無權管理此競賽。' using errcode='42501';end if;
  if p_action in ('judge_assign','judge_remove') then
   if contest.state='results' then raise exception 'rise:結果發布後不能更改評審名單。';end if;
   parent:=(p_data->>'judge_id')::uuid;
   if p_action='judge_remove' then
    if exists(select 1 from rise_work.judgments g join rise_work.entries e on e.id=g.entry_id where e.competition_id=ident and g.judge_id=parent) then raise exception 'rise:評審已提交評分，不可移除。';end if;
    delete from rise_work.judges where competition_id=ident and judge_id=parent;
    return jsonb_build_object('id',ident);
   end if;
   if not exists(select 1 from public.rise_profiles p join auth.users usr on usr.id=p.id where p.id=parent and p.role in ('teacher','admin') and usr.email_confirmed_at is not null) or exists(select 1 from rise_work.entries where competition_id=ident and student_id=parent) then raise exception 'rise:評審须為已驗證教師或管理員，且不能是本競賽投稿人。';end if;
   insert into rise_work.judges values(ident,parent) on conflict do nothing;
  else
   if not ((contest.state='draft' and p_data->>'state'='open' and contest.deadline>now()) or (contest.state='open' and p_data->>'state'='judging' and contest.deadline<=now()) or (contest.state='judging' and p_data->>'state'='results')) then raise exception 'rise:狀態須依草稿、開放、截止後評審、發布結果依序進行。';end if;
   if p_data->>'state' in ('judging','results') and not exists(select 1 from rise_work.judges where competition_id=ident) then raise exception 'rise:請先指定至少一位評審。';end if;
   if p_data->>'state'='results' and exists(
    select 1 from rise_work.entries e cross join rise_work.judges j where e.competition_id=ident and j.competition_id=ident
    and not exists(select 1 from rise_work.entries e2 where e2.competition_id=ident and e2.student_id=e.student_id and e2.version>e.version)
    and not exists(select 1 from rise_work.judgments g where g.entry_id=e.id and g.judge_id=j.judge_id)
   ) then raise exception 'rise:仍有投稿尚未完成全部評審。';end if;
   update rise_work.competitions set state=p_data->>'state' where id=ident;
  end if;
 elsif p_action='competition_submit' then
  if r not in ('student','ta') then raise exception 'rise:此投稿入口限學生與助教。' using errcode='42501';end if;
  select * into contest from rise_work.competitions where id=ident for update;
  if not found or contest.state<>'open' or contest.deadline<=now() then raise exception 'rise:競賽尚未開放或已截止。';end if;
  if exists(select 1 from rise_work.judges where competition_id=ident and judge_id=u) then raise exception 'rise:評審不能投稿。';end if;
  select coalesce(max(version),0) into actual from rise_work.entries where competition_id=ident and student_id=u;
  if (p_data->>'expected_version')::integer is distinct from actual then raise exception 'rise:投稿版本已更新，請重新整理。';end if;
  insert into rise_work.entries(competition_id,student_id,version,division,field,title,body)
   values(ident,u,actual+1,p_data->>'division',p_data->>'field',trim(p_data->>'title'),trim(p_data->>'body')) returning id into ident;
 elsif p_action='competition_judge' then
  select * into ent from rise_work.entries where id=ident;
  if not found then raise exception 'rise:找不到投稿。';end if;
  select * into contest from rise_work.competitions where id=ent.competition_id for update;
  if contest.state<>'judging' or r not in ('teacher','admin') or ent.student_id=u or not exists(select 1 from rise_work.judges where competition_id=contest.id and judge_id=u) then raise exception 'rise:無權評審此投稿。' using errcode='42501';end if;
  if exists(select 1 from rise_work.entries where competition_id=ent.competition_id and student_id=ent.student_id and version>ent.version) then raise exception 'rise:只能評審最終版本。';end if;
  insert into rise_work.judgments(entry_id,judge_id,innovation,depth,appropriateness,inspiration,note)
   values(ident,u,(p_data->>'innovation')::integer,(p_data->>'depth')::integer,(p_data->>'appropriateness')::integer,(p_data->>'inspiration')::integer,trim(p_data->>'note')) returning id into ident;
 else raise exception 'rise:不支援的操作。';end if;
 return jsonb_build_object('id',ident);
end $$;
revoke all on function public.rise_workflow_action(text,jsonb) from public,anon;
grant execute on function public.rise_workflow_action(text,jsonb) to authenticated;

-- Read endpoints return only records needed for this screen. Competition judges get no student ids.
create or replace function public.rise_workflow_read(p_area text,p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid();r text:=rise_work.role();staff boolean;manager boolean;contest rise_work.competitions%rowtype;result jsonb;
begin
 if u is null or r is null or r not in ('student','ta','teacher','admin') then raise exception 'rise:請先登入並驗證信箱。' using errcode='42501';end if;
 staff:=r in ('ta','teacher','admin');
 if p_area='assignments' then
  return jsonb_build_object('items',(select coalesce(jsonb_agg((case when staff then to_jsonb(a) else to_jsonb(a)-'student_ids'-'course_ids' end) order by a.created_at desc),'[]') from rise_work.assignments a where (a.published and (staff or rise_work.assignment_recipient(a.id,u))) or (r in ('teacher','admin') and (a.owner_id=u or r='admin'))));
 elsif p_area='assignment' then
  if not exists(select 1 from rise_work.assignments where id=p_id and ((published and (staff or rise_work.assignment_recipient(id,u))) or (r in ('teacher','admin') and (owner_id=u or r='admin')))) then raise exception 'rise:無權查看作業。' using errcode='42501';end if;
  return jsonb_build_object('revisions',(select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('student_name',(select display_name from public.rise_profiles where id=v.student_id)) order by v.created_at desc),'[]') from rise_work.revisions v where v.assignment_id=p_id and (staff or v.student_id=u)),
   'reviews',(select coalesce(jsonb_agg(to_jsonb(g) order by g.created_at),'[]') from rise_work.reviews g join rise_work.revisions v on v.id=g.revision_id where v.assignment_id=p_id and (staff or v.student_id=u)));
 elsif p_area='training' then
  if not staff then raise exception 'rise:培訓區限教師、助教與管理員。' using errcode='42501';end if;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at),'[]') from rise_work.courses c where published or r='admin'),
   'submissions',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('applicant_name',(select display_name from public.rise_profiles where id=t.applicant_id)) order by t.created_at desc),'[]') from rise_work.training t where r='admin' or t.applicant_id=u),
   'certificates',(select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc),'[]') from rise_work.certificates c join rise_work.training t on t.id=c.submission_id where r='admin' or t.applicant_id=u));
 elsif p_area='competitions' then
  return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc),'[]') from rise_work.competitions c where c.state<>'draft' or (r in ('teacher','admin') and (c.owner_id=u or r='admin'))));
 elsif p_area='competition' then
  select * into contest from rise_work.competitions where id=p_id;
  manager:=r in ('teacher','admin') and (contest.owner_id=u or r='admin');
  if not found or (contest.state='draft' and not manager) then raise exception 'rise:無權查看競賽。' using errcode='42501';end if;
  return jsonb_build_object('own',(select coalesce(jsonb_agg(to_jsonb(e) order by e.version desc),'[]') from rise_work.entries e where e.competition_id=p_id and e.student_id=u),
   'judges',(select coalesce(jsonb_agg(j.judge_id),'[]') from rise_work.judges j where j.competition_id=p_id and (manager or j.judge_id=u)),
   'candidates',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'role',p.role)),'[]') from public.rise_profiles p join auth.users usr on usr.id=p.id where manager and p.role in ('teacher','admin') and usr.email_confirmed_at is not null),
   'entries',(select coalesce(jsonb_agg(to_jsonb(e)-'student_id' order by e.id),'[]') from rise_work.entries e where e.competition_id=p_id and contest.state in ('judging','results') and r in ('teacher','admin') and exists(select 1 from rise_work.judges where competition_id=p_id and judge_id=u) and not exists(select 1 from rise_work.entries later where later.competition_id=p_id and later.student_id=e.student_id and later.version>e.version)),
   'judgments',(select coalesce(jsonb_agg(to_jsonb(g)-'judge_id'),'[]') from rise_work.judgments g join rise_work.entries e on e.id=g.entry_id where e.competition_id=p_id and ((g.judge_id=u and r in ('teacher','admin')) or (contest.state='results' and e.student_id=u))),
   'results',(select coalesce(jsonb_agg(to_jsonb(scores) order by scores.division,scores.field,scores.average desc),'[]') from (
    select e.id,e.title,e.division,e.field,round(avg(g.innovation+g.depth+g.appropriateness+g.inspiration),2) as average,count(g.id) as reviewers
    from rise_work.entries e join rise_work.judgments g on g.entry_id=e.id where e.competition_id=p_id and contest.state='results'
    group by e.id,e.title,e.division,e.field) scores));
 elsif p_area='analytics' then
  return jsonb_build_object('scope',case when staff then '全站（已提交作業的學生）' else '我的學習紀錄' end,
   'summary',jsonb_build_object(
    'training_submissions',(select count(*) from rise_work.training where staff or applicant_id=u),
    'valid_certifications',(select count(*) from (
      select distinct on(t.course_id,t.applicant_id) c.decision,c.valid_until from rise_work.certificates c join rise_work.training t on t.id=c.submission_id
      where staff or t.applicant_id=u order by t.course_id,t.applicant_id,c.created_at desc,c.id desc
     )latest where latest.decision='approved' and latest.valid_until>now()),
    'competition_entries',(select count(*) from (select distinct competition_id,student_id from rise_work.entries where staff or student_id=u)entries),
    'reviewed_versions',(select count(distinct g.revision_id) from rise_work.reviews g join rise_work.revisions v on v.id=g.revision_id where staff or v.student_id=u)),
   'rows',(select coalesce(jsonb_agg(to_jsonb(metrics)),'[]') from (
    select p.id,p.display_name,count(distinct v.assignment_id) as assignments,count(v.id) as versions,
     count(v.id)-count(distinct v.assignment_id) as revisions,
     count(distinct v.assignment_id) filter(where latest.outcome='completed' and not exists(select 1 from rise_work.revisions newer where newer.assignment_id=v.assignment_id and newer.student_id=v.student_id and newer.version>v.version)) as completed,
     count(distinct v.assignment_id) filter(where latest.id is null and not exists(select 1 from rise_work.revisions newer where newer.assignment_id=v.assignment_id and newer.student_id=v.student_id and newer.version>v.version)) as awaiting_review
    from rise_work.revisions v join public.rise_profiles p on p.id=v.student_id
    left join lateral(select g.id,g.outcome from rise_work.reviews g where g.revision_id=v.id order by g.created_at desc,g.id desc limit 1) latest on true
    where staff or v.student_id=u group by p.id,p.display_name)metrics),
   'timeline',(select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') from (
    select v.student_id,v.assignment_id,v.version,g.score,g.outcome,g.reviewer_role,g.created_at from rise_work.reviews g join rise_work.revisions v on v.id=g.revision_id where staff or v.student_id=u
   )t));
 else raise exception 'rise:不支援的頁面。';end if;
end $$;
revoke all on function public.rise_workflow_read(text,uuid) from public,anon;
grant execute on function public.rise_workflow_read(text,uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('rise-work-files','rise-work-files',false,5242880,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
create or replace function public.rise_work_file_access(p_path text,p_write boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select rise_work.role() is not null and ((split_part(p_path,'/',1)=auth.uid()::text and (not p_write or rise_work.role()='student')) or
 (not p_write and rise_work.role() in ('ta','teacher','admin') and exists(select 1 from rise_work.revisions r,jsonb_array_elements(r.files) f where f->>'path'=p_path)));
$$;
revoke all on function public.rise_work_file_access(text,boolean) from public,anon;
grant execute on function public.rise_work_file_access(text,boolean) to authenticated;
drop policy if exists wf_file_upload on storage.objects;
create policy wf_file_upload on storage.objects for insert to authenticated with check(bucket_id='rise-work-files' and public.rise_work_file_access(name,true));
drop policy if exists wf_file_read on storage.objects;
create policy wf_file_read on storage.objects for select to authenticated using(bucket_id='rise-work-files' and public.rise_work_file_access(name,false));
-- Immutable attachments: no client UPDATE/DELETE policy; retain files for past revisions.
notify pgrst,'reload schema';
commit;


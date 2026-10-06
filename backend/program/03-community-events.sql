begin;
alter table rise_work.entries add column if not exists background text;
alter table rise_work.entries add column if not exists motivation text;
alter table rise_work.entries add column if not exists impact text;
alter table rise_work.entries add column if not exists public_consent boolean not null default false;
alter table rise_work.certificates add column if not exists competencies jsonb;

create table if not exists rise_program.events(
 id uuid primary key default gen_random_uuid(),owner_id uuid references auth.users(id) on delete set null,
 title text not null check(length(trim(title)) between 1 and 160),kind text not null check(kind in ('master','youth')),
 body text not null check(length(trim(body)) between 1 and 10000),deadline timestamptz not null,published boolean not null default false,created_at timestamptz not null default now());
create table if not exists rise_program.event_questions(
 id uuid primary key default gen_random_uuid(),event_id uuid references rise_program.events(id) on delete cascade,student_id uuid references auth.users(id) on delete cascade,
 version integer not null,summary text not null check(length(trim(summary)) between 1 and 3000),public_consent boolean not null default false,
 created_at timestamptz not null default now(),unique(event_id,student_id,version));
create table if not exists rise_program.event_selections(
 question_id uuid primary key references rise_program.event_questions(id) on delete cascade,reviewer_id uuid references auth.users(id) on delete set null,
 selected boolean not null,note text not null check(length(trim(note)) between 1 and 2000),created_at timestamptz not null default now());
create table if not exists rise_program.posts(
 id uuid primary key default gen_random_uuid(),author_id uuid references auth.users(id) on delete cascade,
 area text not null check(area in ('ta_forum','plc')),month date not null default date_trunc('month',now()),
 title text not null check(length(trim(title)) between 1 and 160),body text not null check(length(trim(body)) between 1 and 20000),
 resource_url text not null default '',school text not null default '',kind text not null default 'experience' check(kind in ('experience','lesson','case')),
 created_at timestamptz not null default now());
create table if not exists rise_program.post_replies(
 id uuid primary key default gen_random_uuid(),post_id uuid references rise_program.posts(id) on delete cascade,author_id uuid references auth.users(id) on delete cascade,
 body text not null check(length(trim(body)) between 1 and 10000),created_at timestamptz not null default now());
create table if not exists rise_program.club_applications(
 id uuid primary key default gen_random_uuid(),applicant_id uuid references auth.users(id) on delete cascade,
 school text not null check(length(trim(school)) between 1 and 200),club text not null check(club in ('數思社','理學思維社')),
 plan text not null check(length(trim(plan)) between 1 and 10000),budget numeric not null check(budget>0 and budget<=10000000),
 status text not null default 'pending' check(status in ('pending','returned','approved','rejected')),
 review_note text not null default '',created_at timestamptz not null default now());
create table if not exists rise_program.club_reviews(
 id uuid primary key default gen_random_uuid(),application_id uuid references rise_program.club_applications(id) on delete cascade,
 reviewer_id uuid references auth.users(id) on delete set null,status text not null,note text not null,created_at timestamptz not null default now());
create table if not exists rise_program.oer(
 id uuid primary key default gen_random_uuid(),owner_id uuid references auth.users(id) on delete set null,
 year integer not null check(year between 2025 and 2100),title text not null check(length(trim(title)) between 1 and 200),
 kind text not null check(kind in ('dialogue','transcript','question','answer','reading')),
 body text not null check(length(trim(body)) between 1 and 30000),url text not null default '',attribution text not null check(length(trim(attribution)) between 1 and 1000),
 license text not null check(license in ('CC BY 4.0','CC BY-SA 4.0','CC0')),published boolean not null default false,rights_confirmed boolean not null check(rights_confirmed),created_at timestamptz not null default now());
create table if not exists rise_program.awards(
 entry_id uuid primary key references rise_work.entries(id) on delete cascade,award text not null check(length(trim(award)) between 1 and 100),
 published boolean not null default false,reviewer_id uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
create or replace function rise_program.community_allowed(a text) returns boolean language sql stable security definer set search_path='' as $$
 select (a='plc' and rise_work.role() in ('teacher','admin')) or (a='ta_forum' and rise_work.role() in ('ta','teacher','admin'));
$$;
create or replace function public.rise_program_api(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare r text:=rise_work.role();u uuid:=auth.uid();ident uuid:=nullif(p_data->>'id','')::uuid;ev rise_program.events%rowtype;q rise_program.event_questions%rowtype;post rise_program.posts%rowtype;v integer;entry rise_work.entries%rowtype;
begin
 if p_action='oer_public' then return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'year',year,'title',title,'kind',kind,'body',body,'url',url,'attribution',attribution,'license',license) order by year desc,created_at desc),'[]') from rise_program.oer where published);end if;
 if p_action='awards_public' then return (select coalesce(jsonb_agg(jsonb_build_object('award',a.award,'title',e.title,'body',e.body,'background',e.background,'motivation',e.motivation,'impact',e.impact,'division',e.division,'field',e.field,'competition',c.title) order by a.created_at desc),'[]') from rise_program.awards a join rise_work.entries e on e.id=a.entry_id join rise_work.competitions c on c.id=e.competition_id where a.published and e.public_consent and c.state='results');end if;
 if r is null then raise exception 'rise:請先登入並驗證信箱。' using errcode='42501';end if;
 if p_action in ('events','event_save','event_submit','event_detail','event_select') then
 if p_action='events' then return (select coalesce(jsonb_agg(to_jsonb(t) order by deadline),'[]') from rise_program.events t where published or owner_id=u or r='admin');end if;
 if p_action='event_save' then
 if r not in ('teacher','admin') then raise exception 'rise:僅教師與管理員可建立活動。' using errcode='42501';end if;
 insert into rise_program.events(owner_id,title,kind,body,deadline,published) values(u,trim(p_data->>'title'),p_data->>'kind',trim(p_data->>'body'),(p_data->>'deadline')::timestamptz,true) returning id into ident;return jsonb_build_object('id',ident);end if;
 if p_action='event_select' then
 select * into q from rise_program.event_questions where id=ident;
 select * into ev from rise_program.events where id=q.event_id for update;
 if q.id is null or r not in ('teacher','admin') or (r<>'admin' and (ev.owner_id<>u or not rise_work.student_allowed(q.student_id))) then raise exception 'rise:無權評選此提問。' using errcode='42501';end if;
 if exists(select 1 from rise_program.event_questions where event_id=q.event_id and student_id=q.student_id and version>q.version) then raise exception 'rise:請評選最新提交版本。';end if;
 insert into rise_program.event_selections(question_id,reviewer_id,selected,note) values(ident,u,(p_data->>'selected')::boolean,trim(p_data->>'note'));return '{"saved":true}';end if;
 select * into ev from rise_program.events where id=ident for update;
 if not found or not(ev.published or ev.owner_id=u or r='admin') then raise exception 'rise:活動未開放。';end if;
 if p_action='event_submit' then
 if r<>'student' or not ev.published or ev.deadline<=now() then raise exception 'rise:提問徵集未開放或已截止。';end if;
 select coalesce(max(version),0) into v from rise_program.event_questions where event_id=ident and student_id=u;
 if v is distinct from (p_data->>'expected_version')::integer then raise exception 'rise:版本已更新，請重新整理。';end if;
 insert into rise_program.event_questions(event_id,student_id,version,summary,public_consent) values(ident,u,v+1,trim(p_data->>'summary'),coalesce((p_data->>'public_consent')::boolean,false));return '{"saved":true}';end if;
 return jsonb_build_object('questions',(select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),'[]') from rise_program.event_questions t where event_id=ident and (student_id=u or r='admin' or (r='teacher' and ev.owner_id=u and rise_work.student_allowed(student_id)))),
 'selections',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from rise_program.event_selections s join rise_program.event_questions t on t.id=s.question_id where event_id=ident and (student_id=u or r='admin' or (r='teacher' and ev.owner_id=u and rise_work.student_allowed(student_id)))));
 elsif p_action in ('posts','post_save','reply','replies') then
 if p_action in ('reply','replies') then select * into post from rise_program.posts where id=ident;if not found then raise exception 'rise:找不到主題。';end if;
 else post.area:=p_data->>'area';end if;
 if not coalesce(rise_program.community_allowed(post.area),false) then raise exception 'rise:無權進入此社群。' using errcode='42501';end if;
 if p_action='posts' then return (select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),'[]') from (select * from rise_program.posts where area=post.area and (nullif(p_data->>'month','') is null or month=date_trunc('month',(p_data->>'month')::date)::date) order by created_at desc limit 100)t);end if;
 if p_action='replies' then return (select coalesce(jsonb_agg(to_jsonb(t) order by created_at),'[]') from rise_program.post_replies t where post_id=ident);end if;
 if p_action='reply' then insert into rise_program.post_replies(post_id,author_id,body) values(ident,u,trim(p_data->>'body'));return '{"saved":true}';end if;
 if coalesce(p_data->>'resource_url','')<>'' and p_data->>'resource_url' !~ '^https://[^[:space:]]+$' then raise exception 'rise:教材連結須為 HTTPS。';end if;
 if coalesce((p_data->>'anonymized')::boolean,false) is not true then raise exception 'rise:請確認已移除學生個資並取得分享授權。';end if;
 insert into rise_program.posts(author_id,area,month,title,body,resource_url,school,kind) values(u,post.area,date_trunc('month',(p_data->>'month')::date),trim(p_data->>'title'),trim(p_data->>'body'),coalesce(p_data->>'resource_url',''),coalesce(p_data->>'school',''),coalesce(p_data->>'kind','experience'));return '{"saved":true}';
 elsif p_action in ('clubs','club_submit','club_review') then
 if r not in ('teacher','admin') then raise exception 'rise:社團補助限教師與管理員使用。' using errcode='42501';end if;
 if p_action='clubs' then return (select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),'[]') from rise_program.club_applications t where applicant_id=u or r='admin');end if;
 if p_action='club_submit' then insert into rise_program.club_applications(applicant_id,school,club,plan,budget) values(u,trim(p_data->>'school'),p_data->>'club',trim(p_data->>'plan'),(p_data->>'budget')::numeric);return '{"saved":true}';end if;
 if r<>'admin' then raise exception 'rise:僅管理員可審核補助。' using errcode='42501';end if;
 perform 1 from rise_program.club_applications where id=ident and applicant_id<>u and status='pending' for update;
 if not found then raise exception 'rise:不能審核本人或已處理的申請。';end if;
 if p_data->>'status' is null or p_data->>'status' not in ('returned','approved','rejected') or coalesce(length(trim(p_data->>'note')),0) not between 1 and 2000 then raise exception 'rise:請填寫審核決定及意見。';end if;
 update rise_program.club_applications set status=p_data->>'status',review_note=trim(p_data->>'note') where id=ident;
 insert into rise_program.club_reviews(application_id,reviewer_id,status,note) values(ident,u,p_data->>'status',trim(p_data->>'note'));return '{"saved":true}';
 elsif p_action in ('oer_admin','oer_save','award_candidates','award_save') then
 if r<>'admin' then raise exception 'rise:僅管理員可編輯公開出版內容。' using errcode='42501';end if;
 if p_action='oer_admin' then return (select coalesce(jsonb_agg(to_jsonb(t) order by year desc,created_at desc),'[]') from rise_program.oer t);end if;
 if p_action='oer_save' then
 if coalesce(p_data->>'url','')<>'' and p_data->>'url' !~ '^https://[^[:space:]]+$' then raise exception 'rise:請填寫 HTTPS 來源連結。';end if;
 if ident is null then insert into rise_program.oer(owner_id,year,title,kind,body,url,attribution,license,rights_confirmed,published) values(u,(p_data->>'year')::integer,trim(p_data->>'title'),p_data->>'kind',trim(p_data->>'body'),coalesce(p_data->>'url',''),trim(p_data->>'attribution'),p_data->>'license',coalesce((p_data->>'rights_confirmed')::boolean,false),coalesce((p_data->>'published')::boolean,false));
 else update rise_program.oer set published=(p_data->>'published')::boolean where id=ident;if not found then raise exception 'rise:找不到出版紀錄。';end if;end if;return '{"saved":true}';end if;
 if p_action='award_candidates' then return (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'competition',c.title,'division',e.division,'field',e.field,'consent',e.public_consent,'award',a.award,'published',a.published)),'[]') from rise_work.entries e join rise_work.competitions c on c.id=e.competition_id left join rise_program.awards a on a.entry_id=e.id where c.state='results' and not exists(select 1 from rise_work.entries n where n.competition_id=e.competition_id and n.student_id=e.student_id and n.version>e.version));end if;
 select * into entry from rise_work.entries where id=ident;
 if not found or not entry.public_consent or not exists(select 1 from rise_work.competitions where id=entry.competition_id and state='results') or exists(select 1 from rise_work.entries n where n.competition_id=entry.competition_id and n.student_id=entry.student_id and n.version>entry.version) then raise exception 'rise:僅能刊登已結賽、投稿人同意公開的最新作品。';end if;
 insert into rise_program.awards(entry_id,award,published,reviewer_id) values(ident,trim(p_data->>'award'),(p_data->>'published')::boolean,u) on conflict(entry_id) do update set award=excluded.award,published=excluded.published,reviewer_id=u;return '{"saved":true}';
 end if;raise exception 'rise:不支援的操作。';
end $$;
revoke all on function rise_program.community_allowed(text) from public,anon,authenticated;
revoke all on function public.rise_program_api(text,jsonb) from public;
grant execute on function public.rise_program_api(text,jsonb) to anon,authenticated;
do $$declare t text;begin foreach t in array array['events','event_questions','event_selections','posts','post_replies','club_applications','club_reviews','oer','awards'] loop execute format('alter table rise_program.%I enable row level security',t);execute format('revoke all on rise_program.%I from public,anon,authenticated',t);end loop;end $$;
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
  if r='teacher' and (not rise_work.assignment_allowed(ident) or (a.audience='all' and not rise_work.all_courses()) or (a.audience='courses' and exists(select 1 from unnest(a.course_ids) c where not rise_work.course_allowed(c)))) then raise exception 'rise:此作業的發布對象超出核准課程範圍。' using errcode='42501';end if;
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
  if not found or rev.student_id=u or (r='teacher' and not rise_work.revision_allowed(rev.student_id,rev.assignment_id)) then raise exception 'rise:不能批閱此作業。';end if;
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
  insert into rise_work.certificates(submission_id,reviewer_id,decision,note,valid_until,competencies)
   values(ident,u,p_data->>'decision',trim(p_data->>'note'),case when p_data->>'decision'='approved' then now()+interval '1 year' else null end,p_data->'competencies') returning id into ident;
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
  insert into rise_work.entries(competition_id,student_id,version,division,field,title,body,background,motivation,impact,public_consent)
   values(ident,u,actual+1,p_data->>'division',p_data->>'field',trim(p_data->>'title'),trim(p_data->>'body'),trim(p_data->>'background'),trim(p_data->>'motivation'),trim(p_data->>'impact'),coalesce((p_data->>'public_consent')::boolean,false)) returning id into ident;
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
create or replace function rise_program.check_structured_entry() returns trigger language plpgsql set search_path='' as $$
begin
 if coalesce(length(trim(new.background)),0) not between 1 and 5000 or coalesce(length(trim(new.motivation)),0) not between 1 and 5000 or coalesce(length(trim(new.impact)),0) not between 1 and 5000 then raise exception 'rise:投稿必須分別填寫說明背景、提問動機與可能影響。';end if;return new;
end $$;
drop trigger if exists rise_structured_entry on rise_work.entries;
create trigger rise_structured_entry before insert on rise_work.entries for each row execute function rise_program.check_structured_entry();
create or replace function rise_program.check_certification() returns trigger language plpgsql set search_path='' as $$
begin
 if new.decision='approved' and (new.competencies is null or not(new.competencies @> '{"communication":true,"diagnosis":true,"review":true,"ethics":true}'::jsonb)) then raise exception 'rise:認證須確認教學溝通、錯誤診斷、試批考核及回饋倫理四項均通過。';end if;return new;
end $$;
drop trigger if exists rise_certification_rubric on rise_work.certificates;
create trigger rise_certification_rubric before insert on rise_work.certificates for each row execute function rise_program.check_certification();
revoke all on function rise_program.check_structured_entry(),rise_program.check_certification() from public,anon,authenticated;
-- Frontend can reject old deployments before new required fields are silently ignored.
create or replace function public.rise_program_revision() returns text language sql stable set search_path='' as $$ select '20261006'::text $$;
revoke all on function public.rise_program_revision() from public,anon;
grant execute on function public.rise_program_revision() to authenticated;
notify pgrst,'reload schema';commit;

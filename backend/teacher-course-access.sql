-- Run AFTER course-assignments.sql and training-course-management.sql, and existing staff/QA setup.
-- Reapply this file LAST if any older workflow migration is run again.
-- Existing teachers receive NO student access until an administrator grants it.
begin;
create table if not exists rise_work.teacher_access(
 user_id uuid primary key references public.rise_profiles(id) on delete cascade,
 scope text not null check(scope in ('none','courses','all')),
 course_ids uuid[] not null default '{}', updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now());
create table if not exists rise_work.teacher_access_log(
 id bigint generated always as identity primary key, teacher_id uuid, actor_id uuid,
 before_access jsonb, after_access jsonb, created_at timestamptz not null default now());
alter table rise_work.teacher_access enable row level security;
alter table rise_work.teacher_access_log enable row level security;
revoke all on rise_work.teacher_access,rise_work.teacher_access_log from public,anon,authenticated;
alter table public.rise_teacher_applications add column if not exists requested_access text not null default 'none';
alter table public.rise_teacher_applications add column if not exists requested_course_ids uuid[] not null default '{}';
create or replace function rise_work.all_courses() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(rise_work.role()='admin' or (rise_work.role()='teacher' and exists(select 1 from rise_work.teacher_access where user_id=auth.uid() and scope='all')),false);
$$;
create or replace function rise_work.course_allowed(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select rise_work.all_courses() or (rise_work.role()='teacher' and exists(select 1 from rise_work.teacher_access where user_id=auth.uid() and scope='courses' and c=any(course_ids)));
$$;
create or replace function rise_work.student_allowed(s uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(s=auth.uid() or rise_work.all_courses() or (rise_work.role()='teacher' and exists(select 1 from rise_work.class_members m where m.user_id=s and rise_work.course_allowed(m.course_id))),false);
$$;
create or replace function rise_work.revision_allowed(s uuid,a uuid,c uuid default null) returns boolean language sql stable security definer set search_path='' as $$
 select rise_work.student_allowed(s)
 and (c is null or (rise_work.course_allowed(c) and exists(select 1 from rise_work.class_members where user_id=s and course_id=c)))
 and exists(select 1 from rise_work.assignments x where x.id=a and
 (s=auth.uid() or (rise_work.all_courses() and c is null) or (x.audience<>'courses' or exists(select 1 from unnest(x.course_ids) k where rise_work.course_allowed(k) and (c is null or k=c) and exists(select 1 from rise_work.class_members where user_id=s and course_id=k)))));
$$;
create or replace function rise_work.assignment_allowed(a uuid) returns boolean language sql stable security definer set search_path='' as $$
 select rise_work.all_courses() or exists(select 1 from rise_work.assignments x where x.id=a and (
 (x.audience='courses' and exists(select 1 from unnest(x.course_ids) k where rise_work.course_allowed(k))) or
 (x.audience='students' and exists(select 1 from unnest(x.student_ids) s where rise_work.student_allowed(s))) or
 (x.audience='all' and exists(select 1 from rise_work.teacher_access where user_id=auth.uid() and scope='courses' and cardinality(course_ids)>0))));
$$;
create or replace function rise_work.set_teacher_access(target uuid,mode text,ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare previous jsonb; next_value jsonb;
begin
 if rise_work.role() is distinct from 'admin' then raise exception 'rise:僅管理員可設定教師課程權限。' using errcode='42501';end if;
 perform 1 from public.rise_profiles where id=target and role='teacher' for update;
 if not found then raise exception 'rise:請選擇教師帳號。';end if;
 if mode is null or mode not in ('none','courses','all') or ids is null then raise exception 'rise:權限格式不正確。';end if;
 if mode='courses' and (cardinality(ids)=0 or exists(select 1 from unnest(ids) x where x is null or not exists(select 1 from rise_work.classifications where id=x))) then raise exception 'rise:請選擇有效課程。';end if;
 if mode<>'courses' then ids:='{}';end if;
 select to_jsonb(t) into previous from rise_work.teacher_access t where user_id=target;
 insert into rise_work.teacher_access(user_id,scope,course_ids,updated_by) values(target,mode,ids,auth.uid())
 on conflict(user_id) do update set scope=excluded.scope,course_ids=excluded.course_ids,updated_by=auth.uid(),updated_at=now();
 select to_jsonb(t) into next_value from rise_work.teacher_access t where user_id=target;
 insert into rise_work.teacher_access_log(teacher_id,actor_id,before_access,after_access) values(target,auth.uid(),previous,next_value);
end $$;
-- A later role promotion must not revive a previous teacher's access.
create or replace function rise_work.reset_teacher_access() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.role is distinct from new.role then
 insert into rise_work.teacher_access_log(teacher_id,actor_id,before_access,after_access)
 select new.id,auth.uid(),to_jsonb(a),jsonb_build_object('scope','none','reason','role changed') from rise_work.teacher_access a where user_id=new.id;
 delete from rise_work.teacher_access where user_id=new.id;
 end if;
 return new;
end $$;
revoke all on function rise_work.reset_teacher_access() from public,anon,authenticated;
drop trigger if exists rise_reset_teacher_access on public.rise_profiles;
create trigger rise_reset_teacher_access after update of role on public.rise_profiles for each row execute function rise_work.reset_teacher_access();
create or replace function public.rise_teacher_access(p_action text default 'self',p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare r text:=rise_work.role();
begin
 if r is null then raise exception 'rise:請先登入並驗證信箱。' using errcode='42501';end if;
 if p_action='self' then
 return jsonb_build_object('scope',case when r='admin' then 'all' else coalesce((select scope from rise_work.teacher_access where user_id=auth.uid()),'none') end,
 'courses',(select coalesce(jsonb_agg(to_jsonb(c) order by title),'[]') from rise_work.classifications c where rise_work.course_allowed(c.id)));
 end if;
 if r<>'admin' then raise exception 'rise:僅管理員可設定教師課程權限。' using errcode='42501';end if;
 if p_action='save' then
 perform rise_work.set_teacher_access((p_data->>'user_id')::uuid,p_data->>'scope',array(select value::uuid from jsonb_array_elements_text(p_data->'course_ids')));
 return '{"saved":true}'::jsonb;
 elsif p_action='list' then
 return jsonb_build_object('courses',(select coalesce(jsonb_agg(to_jsonb(c) order by title),'[]') from rise_work.classifications c),
 'teachers',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'email',u.email,'scope',coalesce(a.scope,'none'),'course_ids',coalesce(a.course_ids,'{}')) order by p.display_name),'[]') from public.rise_profiles p join auth.users u on u.id=p.id left join rise_work.teacher_access a on a.user_id=p.id where p.role='teacher'));
 end if;
 raise exception 'rise:不支援的操作。';
end $$;
create or replace function public.rise_submit_scoped_application(p_school text,p_subject text,p_reason text,p_expected_version integer,p_requested_role text,p_attachments jsonb,p_access text,p_course_ids uuid[]) returns uuid language plpgsql security definer set search_path='' as $$
declare ident uuid;
begin
 if p_requested_role='teacher' then
 if p_access is null or p_access not in ('courses','all') then raise exception 'rise:請選擇任教課程或申請全部課程。';end if;
 if p_access='courses' and (p_course_ids is null or cardinality(p_course_ids)=0 or exists(select 1 from unnest(p_course_ids) x where x is null or not exists(select 1 from rise_work.classifications where id=x and active))) then raise exception 'rise:請選擇目前開放的任教課程。';end if;
 else p_access:='none';end if;
 if p_access<>'courses' then p_course_ids:='{}';end if;
 ident:=public.rise_submit_staff_application(p_school,p_subject,p_reason,p_expected_version,p_requested_role,p_attachments);
 update public.rise_teacher_applications set requested_access=p_access,requested_course_ids=p_course_ids where id=ident;
 return ident;
end $$;
create or replace function public.rise_review_scoped_application(p_application_id uuid,p_decision text,p_note text,p_expected_version integer,p_access text,p_course_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare a public.rise_teacher_applications%rowtype;
begin
 -- Original function preserves verification, version check, audit and mail-queue triggers.
 perform public.rise_review_teacher_application(p_application_id,p_decision,p_note,p_expected_version);
 select * into a from public.rise_teacher_applications where id=p_application_id;
 if p_decision='approved' and a.requested_role='teacher' then perform rise_work.set_teacher_access(a.user_id,p_access,p_course_ids);end if;
end $$;
revoke all on function rise_work.all_courses(),rise_work.course_allowed(uuid),rise_work.student_allowed(uuid),rise_work.revision_allowed(uuid,uuid,uuid),rise_work.assignment_allowed(uuid),rise_work.set_teacher_access(uuid,text,uuid[]) from public,anon,authenticated;
revoke all on function public.rise_teacher_access(text,jsonb),public.rise_submit_scoped_application(text,text,text,integer,text,jsonb,text,uuid[]),public.rise_review_scoped_application(uuid,text,text,integer,text,uuid[]) from public,anon;
grant execute on function public.rise_teacher_access(text,jsonb),public.rise_submit_scoped_application(text,text,text,integer,text,jsonb,text,uuid[]),public.rise_review_scoped_application(uuid,text,text,integer,text,uuid[]) to authenticated;
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
 if rise_work.role()='teacher' and not rise_work.all_courses() then
 if mode='all' or (mode='courses' and exists(select 1 from unnest(cs) x where not rise_work.course_allowed(x))) or (mode='students' and exists(select 1 from unnest(us) x where not rise_work.student_allowed(x))) then raise exception 'rise:指派對象超出核准課程範圍。' using errcode='42501';end if;end if;
 update rise_work.assignments set audience=mode,course_ids=cs,student_ids=us where id=p_id;
end $$;
create or replace function public.rise_course_action(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r text:=rise_work.role(); ident uuid; ids uuid[]; result jsonb; term text;
begin
 if u is null or r is null then raise exception 'rise:請先登入並驗證信箱。' using errcode='42501';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'rise:資料格式不正確。';end if;
 perform 1 from public.rise_profiles where id=u for update;
 r:=rise_work.role();if r is null then raise exception 'rise:請重新登入。' using errcode='42501';end if;
 if p_action='list' then
  return jsonb_build_object('courses',(select coalesce(jsonb_agg(to_jsonb(c) order by c.title),'[]') from rise_work.classifications c where (r<>'teacher' or rise_work.course_allowed(c.id)) and (c.active or r='admin' or exists(select 1 from rise_work.class_members m where m.course_id=c.id and m.user_id=u))),
   'can_assign_all',rise_work.all_courses(),'selected',(select coalesce(jsonb_agg(course_id),'[]') from rise_work.class_members where user_id=u));
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
   where p.role='student' and au.email_confirmed_at is not null and rise_work.student_allowed(p.id) and (ident is null or rise_work.course_allowed(ident))
   and (term='' or strpos(lower(p.display_name),lower(term))>0 or p.id::text=term)
   and (ident is null or exists(select 1 from rise_work.class_members m where m.user_id=p.id and m.course_id=ident))
   order by p.display_name,p.id limit 100
  ) s;
  return result;
 end if;
 raise exception 'rise:不支援的課程操作。';
end $$;
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
create or replace function public.rise_workflow_read(p_area text,p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid();r text:=rise_work.role();staff boolean;manager boolean;contest rise_work.competitions%rowtype;result jsonb;
begin
 if u is null or r is null or r not in ('student','ta','teacher','admin') then raise exception 'rise:請先登入並驗證信箱。' using errcode='42501';end if;
 staff:=r in ('ta','teacher','admin');
 if p_area='assignments' then
  return jsonb_build_object('items',(select coalesce(jsonb_agg((case when staff then to_jsonb(a)||jsonb_build_object('student_ids',case when r='teacher' then (select coalesce(jsonb_agg(x),'[]') from unnest(a.student_ids) x where rise_work.student_allowed(x)) else to_jsonb(a.student_ids) end) else to_jsonb(a)-'student_ids'-'course_ids' end) order by a.created_at desc),'[]') from rise_work.assignments a where (a.published and ((staff and (r<>'teacher' or rise_work.assignment_allowed(a.id))) or rise_work.assignment_recipient(a.id,u))) or (r in ('teacher','admin') and (a.owner_id=u or r='admin'))));
 elsif p_area='assignment' then
  if not exists(select 1 from rise_work.assignments where id=p_id and ((published and ((staff and (r<>'teacher' or rise_work.assignment_allowed(id))) or rise_work.assignment_recipient(id,u))) or (r in ('teacher','admin') and (owner_id=u or r='admin')))) then raise exception 'rise:無權查看作業。' using errcode='42501';end if;
  return jsonb_build_object('revisions',(select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('student_name',(select display_name from public.rise_profiles where id=v.student_id)) order by v.created_at desc),'[]') from rise_work.revisions v where v.assignment_id=p_id and ((staff and r<>'teacher') or rise_work.revision_allowed(v.student_id,v.assignment_id))),
   'reviews',(select coalesce(jsonb_agg(to_jsonb(g) order by g.created_at),'[]') from rise_work.reviews g join rise_work.revisions v on v.id=g.revision_id where v.assignment_id=p_id and ((staff and r<>'teacher') or rise_work.revision_allowed(v.student_id,v.assignment_id))));
 elsif p_area='training' then
  if not staff then raise exception 'rise:培訓區限教師、助教與管理員。' using errcode='42501';end if;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at),'[]') from rise_work.courses c where published or r='admin' or (r='teacher' and c.owner_id=u)),
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
  if p_id is not null and (r not in ('teacher','admin') or not rise_work.course_allowed(p_id) or not exists(select 1 from rise_work.classifications where id=p_id)) then raise exception 'rise:無權查看此課程的成效。' using errcode='42501';end if;
  return jsonb_build_object('access_version',1,'all_courses',rise_work.all_courses(),'scope',case when r='admin' then '管理員課程成效' when r='teacher' then '核准課程的學習成效' else '我的學習紀錄' end,'courses',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title) order by c.title),'[]') from rise_work.classifications c where r in ('teacher','admin') and rise_work.course_allowed(c.id)),'course_id',p_id,
   'summary',case when r='teacher' or p_id is not null then null else jsonb_build_object(
    'training_submissions',(select count(*) from rise_work.training where (r='admin' and p_id is null) or (r in ('student','ta') and applicant_id=u)),
    'valid_certifications',(select count(*) from (
      select distinct on(t.course_id,t.applicant_id) c.decision,c.valid_until from rise_work.certificates c join rise_work.training t on t.id=c.submission_id
      where (r='admin' and p_id is null) or (r in ('student','ta') and t.applicant_id=u) order by t.course_id,t.applicant_id,c.created_at desc,c.id desc
     )latest where latest.decision='approved' and latest.valid_until>now()),
    'competition_entries',(select count(*) from (select distinct competition_id,student_id from rise_work.entries where (r='admin' and p_id is null) or (r in ('student','ta') and student_id=u))entries),
    'reviewed_versions',(select count(distinct g.revision_id) from rise_work.reviews g join rise_work.revisions v on v.id=g.revision_id where rise_work.revision_allowed(v.student_id,v.assignment_id,p_id))) end,
   'rows',(select coalesce(jsonb_agg(to_jsonb(metrics)),'[]') from (
    select p.id,p.display_name,count(distinct v.assignment_id) as assignments,count(v.id) as versions,
     count(v.id)-count(distinct v.assignment_id) as revisions,
     count(distinct v.assignment_id) filter(where latest.outcome='completed' and not exists(select 1 from rise_work.revisions newer where newer.assignment_id=v.assignment_id and newer.student_id=v.student_id and newer.version>v.version)) as completed,
     count(distinct v.assignment_id) filter(where latest.id is null and not exists(select 1 from rise_work.revisions newer where newer.assignment_id=v.assignment_id and newer.student_id=v.student_id and newer.version>v.version)) as awaiting_review
    from rise_work.revisions v join public.rise_profiles p on p.id=v.student_id
    left join lateral(select g.id,g.outcome from rise_work.reviews g where g.revision_id=v.id order by g.created_at desc,g.id desc limit 1) latest on true
    where rise_work.revision_allowed(v.student_id,v.assignment_id,p_id) group by p.id,p.display_name)metrics),
   'timeline',(select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') from (
    select v.student_id,v.assignment_id,v.version,g.score,g.outcome,g.reviewer_role,g.created_at from rise_work.reviews g join rise_work.revisions v on v.id=g.revision_id where rise_work.revision_allowed(v.student_id,v.assignment_id,p_id)
   )t));
 else raise exception 'rise:不支援的頁面。';end if;
end $$;
create or replace function public.rise_work_file_access(p_path text,p_write boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select rise_work.role() is not null and ((split_part(p_path,'/',1)=auth.uid()::text and (not p_write or rise_work.role()='student')) or
 (not p_write and rise_work.role() in ('ta','teacher','admin') and exists(select 1 from rise_work.revisions r,jsonb_array_elements(r.files) f where f->>'path'=p_path and (rise_work.role()<>'teacher' or rise_work.revision_allowed(r.student_id,r.assignment_id)))));
$$;

-- Student question records follow the same teacher/course boundary.
create or replace function rise_private.teacher_student_access(s uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(rise_work.role()<>'teacher' or rise_work.student_allowed(s),false);
$$;
revoke all on function rise_private.teacher_student_access(uuid) from public,anon;
grant execute on function rise_private.teacher_student_access(uuid) to authenticated;
drop policy if exists rise_teacher_course_question on public.rise_questions;
create policy rise_teacher_course_question on public.rise_questions as restrictive for select to authenticated using(rise_private.teacher_student_access(user_id));
drop policy if exists rise_teacher_course_answer on public.rise_answers;
create policy rise_teacher_course_answer on public.rise_answers as restrictive for select to authenticated using(exists(select 1 from public.rise_questions q where q.id=question_id and rise_private.teacher_student_access(q.user_id)));
drop policy if exists rise_teacher_course_images on public.rise_question_images;
create policy rise_teacher_course_images on public.rise_question_images as restrictive for select to authenticated using(rise_private.teacher_student_access(user_id));
drop policy if exists rise_teacher_course_storage on storage.objects;
create policy rise_teacher_course_storage on storage.objects as restrictive for select to authenticated using(bucket_id<>'rise-question-images' or split_part(name,'/',1)=auth.uid()::text or exists(select 1 from public.rise_question_images i where i.path=storage.objects.name and rise_private.teacher_student_access(i.user_id)));
create or replace function public.rise_staff_question_queue(p_filter text default 'unanswered',p_offset integer default 0)
returns table(id uuid,user_id uuid,subject text,title text,body text,created_at timestamptz,has_staff_answer boolean)
language plpgsql security definer set search_path='' as $$
begin
 if not rise_private.can_answer() then raise exception 'rise:僅限已核准的教師、助教與管理員。';end if;
 if p_filter is null or p_filter not in ('unanswered','answered','all') or p_offset is null or p_offset<0 then raise exception 'rise:篩選條件不正確。';end if;
 return query select q.id,q.user_id,q.subject,q.title,q.body,q.created_at,
 exists(select 1 from public.rise_answers a where a.question_id=q.id and a.author_role in ('teacher','ta','admin'))
 from public.rise_questions q where rise_private.teacher_student_access(q.user_id) and (p_filter='all' or
 (exists(select 1 from public.rise_answers a where a.question_id=q.id and a.author_role in ('teacher','ta','admin')))=(p_filter='answered'))
 order by q.created_at asc,q.id asc limit 21 offset p_offset;
end;$$;
create or replace function public.rise_answer_question(p_question_id uuid,p_body text) returns void language plpgsql security definer set search_path='' as $$
declare p public.rise_profiles%rowtype; q public.rise_questions%rowtype;
begin
 select * into p from public.rise_profiles where id=auth.uid();
 if not found or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'rise:請先登入並驗證信箱。';end if;
 select * into q from public.rise_questions where id=p_question_id;
 if not found or not rise_private.teacher_student_access(q.user_id) or (q.user_id<>auth.uid() and not rise_private.can_answer()) then raise exception 'rise:沒有回覆這個問題的權限。';end if;
 if p_body is null or char_length(trim(p_body)) not between 1 and 10000 then raise exception 'rise:回覆須為 1 至 10000 字。';end if;
 insert into public.rise_answers(question_id,user_id,author_name,author_role,body) values(q.id,auth.uid(),p.display_name,p.role,trim(p_body));
end;$$;

notify pgrst,'reload schema';
commit;

-- Run after backend/course-assignments.sql. Existing training courses stay admin-managed.
-- Reapply this migration if an older workflow/course migration is run again.
-- Teachers manage their own courses; only admins issue/revoke certifications.
begin;
alter table rise_work.courses add column if not exists owner_id uuid references auth.users(id) on delete set null;
create or replace function public.rise_training_manage(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r text; ident uuid;
begin
 perform 1 from public.rise_profiles where id=u for update;
 r:=rise_work.role();
 if u is null or r is null or r not in ('teacher','admin') then raise exception 'rise:僅教師與管理員能建立或管理培訓課程。' using errcode='42501';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'rise:資料格式不正確。';end if;
 if p_action='course_create' then
  insert into rise_work.courses(owner_id,title,body,published)
  values(u,trim(p_data->>'title'),trim(p_data->>'body'),coalesce((p_data->>'published')::boolean,false)) returning id into ident;
 elsif p_action='course_publish' then
  ident:=(p_data->>'id')::uuid;
  perform 1 from rise_work.courses where id=ident and (r='admin' or owner_id=u) for update;
  if not found then raise exception 'rise:無權管理此培訓課程。' using errcode='42501';end if;
  update rise_work.courses set published=(p_data->>'published')::boolean where id=ident;
 else
  raise exception 'rise:不支援的培訓操作。';
 end if;
 return jsonb_build_object('id',ident);
end $$;
revoke all on function public.rise_training_manage(text,jsonb) from public,anon;
grant execute on function public.rise_training_manage(text,jsonb) to authenticated;

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

notify pgrst,'reload schema';
commit;

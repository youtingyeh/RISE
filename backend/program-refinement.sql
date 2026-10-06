-- RISE precision refinement, after backend/program-upgrade.sql. Repeatable, no data deletion.
-- This file does not create lesson content or change the three-subject catalog.
begin;
do $$begin
 if to_regclass('public.rise_question_versions') is null or to_regclass('rise_program.ai_analyses') is null then
  raise exception 'Run backend/program-upgrade.sql before program-refinement.sql.';
 end if;
end $$;
-- Link student follow-up replies to the version they were written against.
create or replace function rise_private.require_question_feedback() returns trigger language plpgsql security definer set search_path='' as $$
declare v integer;
begin
 select max(version) into v from public.rise_question_versions where question_id=new.question_id;
 if new.author_role in ('teacher','ta','admin') then
  if coalesce(length(trim(new.analysis)),0) not between 1 and 3000 or coalesce(length(trim(new.improvement)),0) not between 1 and 3000 or coalesce(length(trim(new.followup)),0) not between 1 and 3000 or new.question_version is distinct from v then
   raise exception 'rise:教學回饋須包含思路分析、改進建議與延伸提問，並指向最新版本。';end if;
 else new.question_version:=v;
 end if;return new;
end $$;
create or replace function rise_program.question_visible(qid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rise_questions q where q.id=qid and rise_work.role() is not null and
 (q.user_id=auth.uid() or (rise_private.can_answer() and rise_private.teacher_student_access(q.user_id))));
$$;
create or replace function public.rise_question_timeline(p_question_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb;
begin
 if not rise_program.question_visible(p_question_id) then raise exception 'rise:無權讀取此提問。' using errcode='42501';end if;
 if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'rise:分頁範圍不正確。';end if;
 select coalesce(jsonb_agg(t.data order by t.created_at,t.version,t.rank,t.id),'[]') into items from (
 select * from (
  select v.id::text as id,v.created_at,v.version,0 as rank,jsonb_build_object('kind','version','id',v.id,'created_at',v.created_at,'version',v.version,'title',v.title,'body',v.body,'change_note',v.change_note) as data
  from public.rise_question_versions v where v.question_id=p_question_id
  union all
  select a.id::text,a.created_at,coalesce(a.question_version,0),1,jsonb_build_object('kind','reply','id',a.id,'created_at',a.created_at,'version',a.question_version,'author_name',a.author_name,'author_role',a.author_role,'body',a.body,'analysis',a.analysis,'improvement',a.improvement,'followup',a.followup)
  from public.rise_answers a where a.question_id=p_question_id
 ) e order by e.created_at,e.version,e.rank,e.id limit 101 offset p_offset
 ) t;
 return jsonb_build_object('items',items,'page_size',100);
end $$;
-- AI drafts are private. Only an analysis explicitly attached to a submitted question is visible to its authorized reviewers.
create table if not exists rise_program.question_analyses(
 question_id uuid not null,version integer not null,analysis_id uuid not null references rise_program.ai_analyses(id) on delete cascade,
 shared_at timestamptz not null default now(),primary key(question_id,version,analysis_id),
 foreign key(question_id,version) references public.rise_question_versions(question_id,version) on delete cascade);
alter table rise_program.question_analyses enable row level security;
revoke all on rise_program.question_analyses from public,anon,authenticated;
create or replace function public.rise_link_question_analysis(p_question_id uuid,p_version integer,p_input_hash text) returns void language plpgsql security definer set search_path='' as $$
declare aid uuid;actual integer;
begin
 if rise_work.role() is distinct from 'student' then raise exception 'rise:僅學生可分享自己的提問分析。' using errcode='42501';end if;
 perform 1 from public.rise_questions where id=p_question_id and user_id=auth.uid() for update;
 if not found then raise exception 'rise:無權修改此提問。' using errcode='42501';end if;
 select max(version) into actual from public.rise_question_versions where question_id=p_question_id;
 if p_version is distinct from actual then raise exception 'rise:提問已修訂，請重新確認分析所屬版本。';end if;
 select id into aid from rise_program.ai_analyses where user_id=auth.uid() and input_hash=p_input_hash order by created_at desc,id desc limit 1;
 if aid is null then raise exception 'rise:找不到此帳號的已儲存分析。';end if;
 insert into rise_program.question_analyses(question_id,version,analysis_id) values(p_question_id,p_version,aid) on conflict do nothing;
end $$;
create or replace function public.rise_question_ai_context(p_question_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not rise_program.question_visible(p_question_id) then raise exception 'rise:無權查看此提問的分析。' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('version',x.version,'created_at',a.created_at,'shared_at',x.shared_at,'model',a.model,'tags',a.tags) order by x.version desc,a.created_at desc),'[]')
 from rise_program.question_analyses x join rise_program.ai_analyses a on a.id=x.analysis_id where x.question_id=p_question_id);
end $$;
-- Own certification status: an account role does not imply passing training.
create or replace function public.rise_my_ta_certification() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if rise_work.role() is null then raise exception 'rise:請先登入並驗證信箱。' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('course_id',c.id,'course_title',c.title,'certificate_id',g.id,'issued_at',g.created_at,'valid_until',g.valid_until,
 'status',case when g.id is null then 'pending' when g.decision='approved' and g.valid_until>now() then 'valid' when g.decision='approved' then 'expired' else g.decision end,
 'competencies',coalesce(g.competencies,'{}'::jsonb)) order by c.title),'[]')
 from rise_work.courses c join (select distinct course_id from rise_work.training where applicant_id=auth.uid()) own on own.course_id=c.id
 left join lateral(select cert.* from rise_work.certificates cert join rise_work.training t on t.id=cert.submission_id where t.course_id=c.id and t.applicant_id=auth.uid() order by cert.created_at desc,cert.id desc limit 1)g on true);
end $$;
create or replace function public.rise_program_refinement_revision() returns text language sql stable set search_path='' as $$select '20261006-refinement-v1'::text$$;
revoke all on function rise_private.require_question_feedback(),rise_program.question_visible(uuid) from public,anon,authenticated;
revoke all on function public.rise_question_timeline(uuid,integer),public.rise_link_question_analysis(uuid,integer,text),public.rise_question_ai_context(uuid),public.rise_my_ta_certification(),public.rise_program_refinement_revision() from public,anon;
grant execute on function public.rise_question_timeline(uuid,integer),public.rise_link_question_analysis(uuid,integer,text),public.rise_question_ai_context(uuid),public.rise_my_ta_certification(),public.rise_program_refinement_revision() to authenticated;
-- Taiwan calendar years; completion is a complete exercise submission, not inferred video understanding.
create or replace view rise_program.annual_operation_statistics as
 select extract(year from occurred_at at time zone 'Asia/Taipei')::integer as report_year,event_type,actor_role,count(*) as records,count(distinct actor_id) as participants
 from rise_program.operation_events group by 1,2,3;
create or replace view rise_program.annual_module_progress as
 with starts as (
  select unit_id,user_id as student_id,first_opened as started_at from rise_program.unit_visits
  union all select unit_id,student_id,created_at from rise_program.practice
 ), cohort as (
  select unit_id,student_id,min(started_at) as started_at,extract(year from min(started_at) at time zone 'Asia/Taipei')::integer as report_year from starts group by unit_id,student_id
 ), results as (
  select c.*,u.title,null::text as subject,p.id as practice_id,g.passed from cohort c join rise_program.units u on u.id=c.unit_id
  left join lateral(select t.id from rise_program.practice t where t.unit_id=c.unit_id and t.student_id=c.student_id and t.created_at < make_timestamptz(c.report_year+1,1,1,0,0,0,'Asia/Taipei') order by t.version desc limit 1)p on true
  left join lateral(select r.passed from rise_program.practice_reviews r where r.practice_id=p.id and r.created_at < make_timestamptz(c.report_year+1,1,1,0,0,0,'Asia/Taipei') order by r.created_at desc,r.id desc limit 1)g on true
 ) select report_year,unit_id,title,subject,count(*) as started,count(practice_id) as completed,count(*) filter(where passed) as passed,
 round(count(practice_id)::numeric/nullif(count(*),0),4) as completion_rate,
 round(count(*) filter(where passed)::numeric/nullif(count(practice_id),0),4) as pass_rate
 from results group by report_year,unit_id,title,subject;
revoke all on rise_program.annual_operation_statistics,rise_program.annual_module_progress from public,anon,authenticated;
create or replace function public.rise_annual_education_report(p_year integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare start_at timestamptz;end_at timestamptz;
begin
 if rise_work.role() is distinct from 'admin' then raise exception 'rise:僅管理員可彙整年度教育資料。' using errcode='42501';end if;
 if p_year is null or p_year not between 2000 and extract(year from now() at time zone 'Asia/Taipei')::integer then raise exception 'rise:請選擇已開始的年度。';end if;
 start_at:=make_timestamptz(p_year,1,1,0,0,0,'Asia/Taipei');end_at:=make_timestamptz(p_year+1,1,1,0,0,0,'Asia/Taipei');
 return jsonb_build_object('year',p_year,'timezone','Asia/Taipei','generated_at',now(),'period_end',least(end_at,now()),'provisional',now()<end_at,
 'cumulative_registrations',(select count(*) from rise_program.operation_events where event_type='registration' and occurred_at<end_at),
 'new_registrations',(select count(*) from rise_program.operation_events where event_type='registration' and occurred_at>=start_at and occurred_at<end_at),
 'current_role_distribution',(select coalesce(jsonb_object_agg(role,n),'{}') from (select role,count(*) as n from public.rise_profiles group by role)r),
 'review_records',(select count(*) from rise_program.operation_events where event_type in ('assignment_review','question_review','practice_review') and occurred_at>=start_at and occurred_at<end_at),
 'operations',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from rise_program.annual_operation_statistics x where report_year=p_year),
 'modules',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from rise_program.annual_module_progress x where report_year=p_year),
 'competition_groups',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select competition_id,division,field,count(*) as works from (
 select distinct on(competition_id,student_id) competition_id,student_id,division,field from rise_work.entries where created_at>=start_at and created_at<end_at order by competition_id,student_id,version desc
 ) latest group by competition_id,division,field)x),
 'definitions',jsonb_build_object('modules','當年度首次開啟或提交之學生，以該年年底前最後習作版本及該版本最後批閱判定；未批閱不算通過。已刪除學生不在單元明細分母內。','reviews','批閱紀錄數，包含不同版本及不同評閱人，不等於獨立學生或作業數。','competitions','operations 的 competition_version 是歷次提交數；competition_groups 為當年度最新版本的現存作品件數。','roles','目前角色分布，並非該年年底角色快照。','history','安裝前已刪除且無事件紀錄的歷史資料無法追溯。'));
end $$;
revoke all on function public.rise_annual_education_report(integer) from public,anon;
grant execute on function public.rise_annual_education_report(integer) to authenticated;
notify pgrst,'reload schema';
commit;

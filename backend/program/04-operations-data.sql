-- No KPI UI. Private views + admin-only RPC; recorded by database triggers.
begin;
create table if not exists rise_program.operation_events(
 id bigint generated always as identity primary key,event_type text not null,source_id text not null,
 actor_id uuid references auth.users(id) on delete set null,actor_role text,occurred_at timestamptz not null default now(),
 unique(event_type,source_id));
alter table rise_program.operation_events enable row level security;
revoke all on rise_program.operation_events from public,anon,authenticated;
create or replace function rise_program.capture_operation() returns trigger language plpgsql security definer set search_path='' as $$
declare j jsonb:=to_jsonb(new);actor uuid;event text:=tg_argv[0];source text;
begin
 actor:=nullif(j->>tg_argv[1],'')::uuid;source:=coalesce(j->>'id',(j->>'user_id')||':'||(j->>'unit_id'));
 insert into rise_program.operation_events(event_type,source_id,actor_id,actor_role,occurred_at)
 values(event,source,actor,(select role from public.rise_profiles where id=actor),coalesce((j->>'created_at')::timestamptz,(j->>'first_opened')::timestamptz,now())) on conflict do nothing;
 return new;
end $$;
revoke all on function rise_program.capture_operation() from public,anon,authenticated;
drop trigger if exists rise_op_registration on public.rise_profiles;
create trigger rise_op_registration after insert on public.rise_profiles for each row execute function rise_program.capture_operation('registration','id');
drop trigger if exists rise_op_assignment_review on rise_work.reviews;
create trigger rise_op_assignment_review after insert on rise_work.reviews for each row execute function rise_program.capture_operation('assignment_review','reviewer_id');
drop trigger if exists rise_op_question_review on public.rise_answers;
create trigger rise_op_question_review after insert on public.rise_answers for each row when(new.author_role in ('teacher','ta','admin')) execute function rise_program.capture_operation('question_review','user_id');
drop trigger if exists rise_op_practice_review on rise_program.practice_reviews;
create trigger rise_op_practice_review after insert on rise_program.practice_reviews for each row execute function rise_program.capture_operation('practice_review','reviewer_id');
drop trigger if exists rise_op_practice on rise_program.practice;
create trigger rise_op_practice after insert on rise_program.practice for each row execute function rise_program.capture_operation('practice_version','student_id');
drop trigger if exists rise_op_entry on rise_work.entries;
create trigger rise_op_entry after insert on rise_work.entries for each row execute function rise_program.capture_operation('competition_version','student_id');
drop trigger if exists rise_op_unit_open on rise_program.unit_visits;
create trigger rise_op_unit_open after insert on rise_program.unit_visits for each row execute function rise_program.capture_operation('unit_started','user_id');
insert into rise_program.operation_events(event_type,source_id,actor_id,actor_role,occurred_at)
 select 'registration',id::text,id,role,created_at from public.rise_profiles on conflict do nothing;
insert into rise_program.operation_events(event_type,source_id,actor_id,actor_role,occurred_at)
 select 'assignment_review',id::text,reviewer_id,reviewer_role,created_at from rise_work.reviews on conflict do nothing;
insert into rise_program.operation_events(event_type,source_id,actor_id,actor_role,occurred_at)
 select 'question_review',id::text,user_id,author_role,created_at from public.rise_answers where author_role in ('teacher','ta','admin') on conflict do nothing;
insert into rise_program.operation_events(event_type,source_id,actor_id,actor_role,occurred_at)
 select 'competition_version',id::text,student_id,null,created_at from rise_work.entries on conflict do nothing;
create or replace view rise_program.registration_statistics as
 select (select count(*) from rise_program.operation_events where event_type='registration') as cumulative_registrations,
 (select count(*) from public.rise_profiles) as current_accounts,
 (select coalesce(jsonb_object_agg(role,n),'{}') from (select role,count(*) n from public.rise_profiles group by role)t) as role_distribution;
create or replace view rise_program.review_statistics as
 select event_type,actor_role,count(*) as review_records,count(distinct actor_id) as reviewers
 from rise_program.operation_events where event_type in ('assignment_review','question_review','practice_review') group by event_type,actor_role;
create or replace view rise_program.competition_statistics as
 select c.id as competition_id,c.title,e.division,e.field,count(*) as submissions,count(distinct e.student_id) as participants,
 count(*) filter(where not exists(select 1 from rise_work.entries n where n.competition_id=e.competition_id and n.student_id=e.student_id and n.version>e.version)) as works
 from rise_work.entries e join rise_work.competitions c on c.id=e.competition_id group by c.id,c.title,e.division,e.field;
create or replace view rise_program.module_progress as
 with learners as(select user_id,unit_id from rise_program.unit_visits union select student_id,unit_id from rise_program.practice)
 select x.id as unit_id,x.title,count(l.user_id) as started,
 count(last.id) as completed,count(last.id) filter(where grading.passed) as passed,
 round(count(last.id)::numeric/nullif(count(l.user_id),0),4) as completion_rate,
 round(count(last.id) filter(where grading.passed)::numeric/nullif(count(last.id),0),4) as pass_rate
 from rise_program.units x left join learners l on l.unit_id=x.id
 left join lateral(select p.id from rise_program.practice p where p.unit_id=x.id and p.student_id=l.user_id order by version desc limit 1)last on true
 left join lateral(select g.passed from rise_program.practice_reviews g where g.practice_id=last.id order by created_at desc,id desc limit 1)grading on true
 group by x.id,x.title;
create or replace view rise_program.ai_error_statistics as
 select tag->>'code' as error_type,count(*) as model_findings,count(distinct a.user_id) as learners
 from rise_program.ai_analyses a cross join lateral jsonb_array_elements(a.tags) tag group by tag->>'code';
revoke all on rise_program.registration_statistics,rise_program.review_statistics,rise_program.competition_statistics,rise_program.module_progress,rise_program.ai_error_statistics from public,anon,authenticated;
create or replace function public.rise_operations_statistics() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if rise_work.role() is distinct from 'admin' then raise exception 'rise:僅管理員能查詢營運統計。' using errcode='42501';end if;
 return jsonb_build_object('registrations',(select to_jsonb(t) from rise_program.registration_statistics t),
 'reviews',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from rise_program.review_statistics t),
 'modules',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from rise_program.module_progress t),
 'competitions',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from rise_program.competition_statistics t),
 'ai_findings',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from rise_program.ai_error_statistics t),
 'watch_sessions',(select count(*) from public.rise_watch_sessions),
 'definitions',jsonb_build_object('completion','最新版本已完整提交全部習作 / 曾開啟或提交單元的人數','pass','最新版本最近一次批閱通過 / 已提交人數；尚未批閱不計通過','watch','播放器回報紀錄，不等同理解或觀看完成','ai','AI 初步標籤，非教師診斷；同一人多次分析會多次計入','deleted','累計註冊保留刪除帳號數，當前角色分布只計現存帳號'));
end $$;
revoke all on function public.rise_operations_statistics() from public,anon;
grant execute on function public.rise_operations_statistics() to authenticated;
notify pgrst,'reload schema';commit;

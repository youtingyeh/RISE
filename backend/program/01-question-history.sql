-- Requires teacher-course-access.sql. Additive, repeatable; legacy answers stay readable.
begin;
create table if not exists public.rise_question_versions(
 id uuid primary key default gen_random_uuid(), question_id uuid not null references public.rise_questions(id) on delete cascade,
 version integer not null check(version>0), subject text not null,title text not null,body text not null,
 change_note text not null default '',created_at timestamptz not null default now(),unique(question_id,version));
alter table public.rise_answers add column if not exists analysis text;
alter table public.rise_answers add column if not exists improvement text;
alter table public.rise_answers add column if not exists followup text;
alter table public.rise_answers add column if not exists question_version integer;
alter table public.rise_question_versions enable row level security;
revoke all on public.rise_question_versions from public,anon,authenticated;
grant select on public.rise_question_versions to authenticated;
drop policy if exists question_version_read on public.rise_question_versions;
create policy question_version_read on public.rise_question_versions for select to authenticated using(exists(select 1 from public.rise_questions q where q.id=question_id));
insert into public.rise_question_versions(question_id,version,subject,title,body,created_at)
select id,1,subject,title,body,created_at from public.rise_questions on conflict do nothing;
create or replace function rise_private.capture_question_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.rise_question_versions(question_id,version,subject,title,body,change_note)
 select new.id,coalesce(max(version),0)+1,new.subject,new.title,new.body,coalesce(current_setting('rise.question_change_note',true),'') from public.rise_question_versions where question_id=new.id;
 return new;
end $$;
drop trigger if exists rise_capture_question_version on public.rise_questions;
create trigger rise_capture_question_version after insert or update of subject,title,body on public.rise_questions for each row execute function rise_private.capture_question_version();
create or replace function public.rise_revise_question(p_id uuid,p_version integer,p_title text,p_body text,p_change_note text) returns void language plpgsql security definer set search_path='' as $$
declare q public.rise_questions%rowtype; actual integer;
begin
 if rise_work.role() is distinct from 'student' then raise exception 'rise:僅學生能修訂自己的提問。' using errcode='42501';end if;
 select * into q from public.rise_questions where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception 'rise:無權修訂此提問。' using errcode='42501';end if;
 select max(version) into actual from public.rise_question_versions where question_id=p_id;
 if actual is distinct from p_version then raise exception 'rise:版本已更新，請重新整理後再提交。';end if;
 if coalesce(length(trim(p_title)),0) not between 1 and 160 or coalesce(length(trim(p_body)),0) not between 1 and 10000 or coalesce(length(trim(p_change_note)),0) not between 1 and 2000 then raise exception 'rise:請填寫標題、完整內容與本次修改說明。';end if;
 perform set_config('rise.question_change_note',trim(p_change_note),true);
 update public.rise_questions set title=trim(p_title),body=trim(p_body) where id=p_id;
end $$;
create or replace function rise_private.require_question_feedback() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.author_role in ('teacher','ta','admin') and (coalesce(length(trim(new.analysis)),0) not between 1 and 3000 or coalesce(length(trim(new.improvement)),0) not between 1 and 3000 or coalesce(length(trim(new.followup)),0) not between 1 and 3000 or new.question_version is null) then raise exception 'rise:教學回饋須包含思路分析、改進建議與延伸提問，並指明提問版本。';end if;
 return new;
end $$;
drop trigger if exists rise_require_question_feedback on public.rise_answers;
create trigger rise_require_question_feedback before insert on public.rise_answers for each row execute function rise_private.require_question_feedback();
create or replace function public.rise_review_question(p_id uuid,p_version integer,p_analysis text,p_improvement text,p_followup text) returns void language plpgsql security definer set search_path='' as $$
declare q public.rise_questions%rowtype; actual integer; p public.rise_profiles%rowtype;
begin
 perform 1 from public.rise_profiles where id=auth.uid() for update;
 if not rise_private.can_answer() then raise exception 'rise:僅教學人員可批閱。' using errcode='42501';end if;
 select * into q from public.rise_questions where id=p_id for update;
 if not found or not rise_private.teacher_student_access(q.user_id) or q.user_id=auth.uid() then raise exception 'rise:無權批閱此提問。' using errcode='42501';end if;
 select max(version) into actual from public.rise_question_versions where question_id=p_id;
 if actual is distinct from p_version then raise exception 'rise:學生已更新問題，請讀取最新版本後批閱。';end if;
 select * into p from public.rise_profiles where id=auth.uid();
 insert into public.rise_answers(question_id,user_id,author_name,author_role,body,analysis,improvement,followup,question_version)
 values(p_id,p.id,p.display_name,p.role,'思路分析：'||p_analysis||E'\n改進建議：'||p_improvement||E'\n延伸提問：'||p_followup,trim(p_analysis),trim(p_improvement),trim(p_followup),actual);
end $$;
revoke all on function rise_private.capture_question_version(),rise_private.require_question_feedback() from public,anon,authenticated;
revoke all on function public.rise_revise_question(uuid,integer,text,text,text),public.rise_review_question(uuid,integer,text,text,text) from public,anon;
grant execute on function public.rise_revise_question(uuid,integer,text,text,text),public.rise_review_question(uuid,integer,text,text,text) to authenticated;
create or replace function public.rise_staff_question_queue(p_filter text default 'unanswered',p_offset integer default 0)
returns table(id uuid,user_id uuid,subject text,title text,body text,created_at timestamptz,has_staff_answer boolean)
language plpgsql security definer set search_path='' as $$
begin
 if not rise_private.can_answer() then raise exception 'rise:僅限已核准的教師、助教與管理員。';end if;
 if p_filter is null or p_filter not in ('unanswered','answered','all') or p_offset is null or p_offset<0 then raise exception 'rise:篩選條件不正確。';end if;
 return query select q.id,q.user_id,q.subject,q.title,q.body,q.created_at,
 exists(select 1 from public.rise_answers a where a.question_id=q.id and a.author_role in ('teacher','ta','admin') and coalesce(a.question_version,1)=(select max(v.version) from public.rise_question_versions v where v.question_id=q.id))
 from public.rise_questions q where rise_private.teacher_student_access(q.user_id) and (p_filter='all' or
 (exists(select 1 from public.rise_answers a where a.question_id=q.id and a.author_role in ('teacher','ta','admin') and coalesce(a.question_version,1)=(select max(v.version) from public.rise_question_versions v where v.question_id=q.id)))=(p_filter='answered'))
 order by q.created_at asc,q.id asc limit 21 offset p_offset;
end;$$;
notify pgrst,'reload schema';commit;

-- 已安裝 setup.sql 的專案：新增教師附件、助教審核與私有問答。可重複執行。
begin;
alter table public.rise_profiles drop constraint if exists rise_profiles_requested_kind_check;
alter table public.rise_profiles add constraint rise_profiles_requested_kind_check check(requested_kind in ('student','teacher','ta'));
alter table public.rise_teacher_applications add column if not exists requested_role text not null default 'teacher' check(requested_role in ('teacher','ta'));
alter table public.rise_teacher_applications add column if not exists attachments jsonb not null default '[]'::jsonb check(jsonb_typeof(attachments)='array' and jsonb_array_length(attachments)<=3);
create or replace function rise_private.handle_new_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.rise_profiles(id,display_name,role,requested_kind)
 values(new.id,coalesce(nullif(left(trim(new.raw_user_meta_data->>'display_name'),80),''),'RISE 使用者'),
 'student',case when new.raw_user_meta_data->>'requested_kind' in ('teacher','ta') then new.raw_user_meta_data->>'requested_kind' else 'student' end);
 return new;
end;
$$;
revoke all on function rise_private.handle_new_user() from public;
create or replace function public.rise_review_teacher_application(p_application_id uuid,p_decision text,p_note text,p_expected_version integer)
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
 if p_decision='approved' then update public.rise_profiles set role=a.requested_role where id=target;end if;
 update public.rise_teacher_applications set status=p_decision,review_note=trim(coalesce(p_note,'')),
 reviewer_id=auth.uid(),reviewed_at=now(),updated_at=now(),version=version+1
 where id=a.id returning * into a;
 insert into public.rise_application_events(application_id,actor_id,action,note,snapshot)
 values(a.id,auth.uid(),case p_decision when 'approved' then '核准' || a.requested_role || '資格' when 'returned' then '退回補件' else '不予核准' end,a.review_note,to_jsonb(a));
end;
$$;
revoke all on function public.rise_review_teacher_application(uuid,text,text,integer) from public;
grant execute on function public.rise_review_teacher_application(uuid,text,text,integer) to authenticated;

create or replace function rise_private.is_verified() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null);
$$;
revoke all on function rise_private.is_verified() from public;
grant execute on function rise_private.is_verified() to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('rise-credentials','rise-credentials',false,5242880,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists rise_credentials_read on storage.objects;
create policy rise_credentials_read on storage.objects for select to authenticated using(bucket_id='rise-credentials' and ((storage.foldername(name))[1]=auth.uid()::text or rise_private.is_admin()));
drop policy if exists rise_credentials_upload on storage.objects;
create policy rise_credentials_upload on storage.objects for insert to authenticated with check(bucket_id='rise-credentials' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.rise_profiles where id=auth.uid() and role='student') and rise_private.is_verified());
drop policy if exists rise_credentials_delete on storage.objects;
create policy rise_credentials_delete on storage.objects for delete to authenticated using(bucket_id='rise-credentials' and (storage.foldername(name))[1]=auth.uid()::text);
-- 不提供 UPDATE，禁止覆寫已上傳的證明。
create or replace function public.rise_submit_staff_application(p_school text,p_subject text,p_reason text,p_expected_version integer,p_requested_role text,p_attachments jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare aid uuid; item jsonb;
begin
 if p_requested_role is null or p_requested_role not in ('teacher','ta') then raise exception 'rise:申請身分不正確。'; end if;
 if p_attachments is null or jsonb_typeof(p_attachments)<>'array' then raise exception 'rise:附件格式錯誤。'; end if;
 if jsonb_array_length(p_attachments) not between 1 and 3 then raise exception 'rise:請提供 1 至 3 份證明。'; end if;
 for item in select value from jsonb_array_elements(p_attachments) loop
  if jsonb_typeof(item)<>'object' or coalesce(char_length(item->>'name'),0) not between 1 and 255 or
    not exists(select 1 from storage.objects where bucket_id='rise-credentials' and name=item->>'path' and (storage.foldername(name))[1]=auth.uid()::text)
  then raise exception 'rise:附件不存在或無權使用，請重新上傳。'; end if;
 end loop;
 aid:=public.rise_submit_teacher_application(p_school,p_subject,p_reason,p_expected_version);
 update public.rise_teacher_applications set requested_role=p_requested_role,attachments=p_attachments where id=aid;
 update public.rise_application_events set snapshot=to_jsonb(a) from public.rise_teacher_applications a
 where application_id=aid and a.id=aid and actor_id=auth.uid() and rise_application_events.created_at=now();
 return aid;
end;
$$;
revoke all on function public.rise_submit_teacher_application(text,text,text,integer) from public,anon,authenticated;
revoke all on function public.rise_submit_staff_application(text,text,text,integer,text,jsonb) from public,anon;
grant execute on function public.rise_submit_staff_application(text,text,text,integer,text,jsonb) to authenticated;

create or replace function rise_private.can_answer() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rise_profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.role in ('admin','teacher','ta') and u.email_confirmed_at is not null);
$$;
revoke all on function rise_private.can_answer() from public;
grant execute on function rise_private.can_answer() to authenticated;
create table if not exists public.rise_questions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 subject text not null check(subject in ('math','physics','chemistry','multiple')),
 title text not null check(char_length(trim(title)) between 1 and 160),
 body text not null check(char_length(trim(body)) between 1 and 10000),
 created_at timestamptz not null default now()
);
create table if not exists public.rise_answers (
 id uuid primary key default gen_random_uuid(), question_id uuid not null references public.rise_questions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 author_name text not null, author_role text not null check(author_role in ('student','teacher','ta','admin')),
 body text not null check(char_length(trim(body)) between 1 and 10000),created_at timestamptz not null default now()
);
create index if not exists rise_questions_owner on public.rise_questions(user_id,created_at desc);
create index if not exists rise_answers_question on public.rise_answers(question_id,created_at);
alter table public.rise_questions enable row level security;
alter table public.rise_answers enable row level security;
revoke all on public.rise_questions,public.rise_answers from anon,authenticated;
grant select on public.rise_questions,public.rise_answers to authenticated;
grant insert(user_id,subject,title,body) on public.rise_questions to authenticated;
drop policy if exists rise_question_read on public.rise_questions;
create policy rise_question_read on public.rise_questions for select to authenticated using(user_id=auth.uid() or rise_private.can_answer());
drop policy if exists rise_question_create on public.rise_questions;
create policy rise_question_create on public.rise_questions for insert to authenticated with check(user_id=auth.uid() and rise_private.is_verified());
drop policy if exists rise_answer_read on public.rise_answers;
create policy rise_answer_read on public.rise_answers for select to authenticated using(exists(select 1 from public.rise_questions q where q.id=question_id and (q.user_id=auth.uid() or rise_private.can_answer())));
create or replace function public.rise_answer_question(p_question_id uuid,p_body text) returns void language plpgsql security definer set search_path='' as $$
declare p public.rise_profiles%rowtype; q public.rise_questions%rowtype;
begin
 select * into p from public.rise_profiles where id=auth.uid();
 if not found or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'rise:請先登入並驗證信箱。';end if;
 select * into q from public.rise_questions where id=p_question_id;
 if not found or (q.user_id<>auth.uid() and not rise_private.can_answer()) then raise exception 'rise:沒有回覆這個問題的權限。';end if;
 if p_body is null or char_length(trim(p_body)) not between 1 and 10000 then raise exception 'rise:回覆須為 1 至 10000 字。';end if;
 insert into public.rise_answers(question_id,user_id,author_name,author_role,body) values(q.id,auth.uid(),p.display_name,p.role,trim(p_body));
end;$$;
revoke all on function public.rise_answer_question(uuid,text) from public,anon;
grant execute on function public.rise_answer_question(uuid,text) to authenticated;
commit;

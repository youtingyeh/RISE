-- 在 staff-upgrade.sql 後執行；可重複執行。問答圖片使用獨立的 Supabase 私有 bucket。
begin;
create table if not exists public.rise_qa_account_state (
 user_id uuid primary key references auth.users(id) on delete cascade,
 deleting boolean not null default false
);
alter table public.rise_qa_account_state enable row level security;
revoke all on public.rise_qa_account_state from public,anon,authenticated;
create table if not exists public.rise_question_images (
 path text primary key,
 question_id uuid not null references public.rise_questions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(char_length(name) between 1 and 255)
);
create index if not exists rise_question_images_question on public.rise_question_images(question_id);
alter table public.rise_question_images enable row level security;
revoke all on public.rise_question_images from public,anon,authenticated;
grant select on public.rise_question_images to authenticated;
drop policy if exists rise_question_images_read on public.rise_question_images;
create policy rise_question_images_read on public.rise_question_images for select to authenticated
using(exists(select 1 from public.rise_questions q where q.id=question_id and (q.user_id=auth.uid() or rise_private.can_answer())));
create or replace function rise_private.qa_upload_open() returns boolean language sql stable security definer set search_path='' as $$
 select rise_private.is_verified() and not exists(select 1 from public.rise_qa_account_state where user_id=auth.uid() and deleting);
$$;
revoke all on function rise_private.qa_upload_open() from public;
grant execute on function rise_private.qa_upload_open() to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('rise-question-images','rise-question-images',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists rise_qa_image_upload on storage.objects;
create policy rise_qa_image_upload on storage.objects for insert to authenticated
with check(bucket_id='rise-question-images' and (storage.foldername(name))[1]=auth.uid()::text and rise_private.qa_upload_open());
drop policy if exists rise_qa_image_read on storage.objects;
create policy rise_qa_image_read on storage.objects for select to authenticated
using(bucket_id='rise-question-images' and ((storage.foldername(name))[1]=auth.uid()::text or
 exists(select 1 from public.rise_question_images i join public.rise_questions q on q.id=i.question_id where i.path=storage.objects.name and rise_private.can_answer())));
drop policy if exists rise_qa_image_delete on storage.objects;
create policy rise_qa_image_delete on storage.objects for delete to authenticated
using(bucket_id='rise-question-images' and (storage.foldername(name))[1]=auth.uid()::text);
create or replace function public.rise_begin_qa_delete() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not rise_private.is_verified() then raise exception 'rise:請先登入。'; end if;
 perform 1 from public.rise_profiles where id=auth.uid() and role<>'admin' for update;
 if not found then raise exception 'rise:此帳號不能自行刪除。';end if;
 insert into public.rise_qa_account_state(user_id,deleting) values(auth.uid(),true)
 on conflict(user_id) do update set deleting=true;
end;$$;
revoke all on function public.rise_begin_qa_delete() from public,anon;
grant execute on function public.rise_begin_qa_delete() to authenticated;
create or replace function public.rise_submit_question(p_id uuid,p_subject text,p_title text,p_body text,p_images jsonb default '[]') returns uuid
language plpgsql security definer set search_path='' as $$
declare item jsonb; existing uuid;
begin
 if auth.uid() is null or not rise_private.is_verified() then raise exception 'rise:請先登入並驗證信箱。';end if;
 perform 1 from public.rise_profiles where id=auth.uid() for update;
 if not found or not rise_private.qa_upload_open() then raise exception 'rise:帳號無法提交問題。';end if;
 if p_id is null then raise exception 'rise:問題編號錯誤。';end if;
 select user_id into existing from public.rise_questions where id=p_id;
 if found then
  if existing<>auth.uid() then raise exception 'rise:問題編號已使用。';end if;
  return p_id; -- 網路回應遺失後重試不建立重複問題。
 end if;
 if p_images is null or jsonb_typeof(p_images)<>'array' then raise exception 'rise:圖片格式錯誤。';end if;
 if jsonb_array_length(p_images)>3 then raise exception 'rise:最多三張圖片。';end if;
 if p_title is null or char_length(trim(p_title)) not between 1 and 160 or p_body is null or char_length(trim(p_body)) not between 1 and 10000 then raise exception 'rise:請填寫問題標題與內容。';end if;
 if p_subject is null or p_subject not in ('math','physics','chemistry','multiple') then raise exception 'rise:學科不正確。';end if;
 for item in select value from jsonb_array_elements(p_images) loop
  if jsonb_typeof(item)<>'object' or coalesce(char_length(item->>'name'),0) not between 1 and 255 or not exists(
   select 1 from storage.objects where bucket_id='rise-question-images' and name=item->>'path' and (storage.foldername(name))[1]=auth.uid()::text
  ) then raise exception 'rise:圖片不存在或不屬於此帳號。';end if;
 end loop;
 insert into public.rise_questions(id,user_id,subject,title,body) values(p_id,auth.uid(),p_subject,trim(p_title),trim(p_body));
 for item in select value from jsonb_array_elements(p_images) loop
  insert into public.rise_question_images(path,question_id,user_id,name) values(item->>'path',p_id,auth.uid(),item->>'name');
 end loop;
 return p_id;
end;$$;
revoke all on function public.rise_submit_question(uuid,text,text,text,jsonb) from public,anon;
grant execute on function public.rise_submit_question(uuid,text,text,text,jsonb) to authenticated;
-- security definer 內明確檢查即時角色；一般學生不能讀取全站問題。
create or replace function public.rise_staff_question_queue(p_filter text default 'unanswered',p_offset integer default 0)
returns table(id uuid,user_id uuid,subject text,title text,body text,created_at timestamptz,has_staff_answer boolean)
language plpgsql security definer set search_path='' as $$
begin
 if not rise_private.can_answer() then raise exception 'rise:僅限已核准的教師、助教與管理員。';end if;
 if p_filter is null or p_filter not in ('unanswered','answered','all') or p_offset is null or p_offset<0 then raise exception 'rise:篩選條件不正確。';end if;
 return query select q.id,q.user_id,q.subject,q.title,q.body,q.created_at,
 exists(select 1 from public.rise_answers a where a.question_id=q.id and a.author_role in ('teacher','ta','admin'))
 from public.rise_questions q where p_filter='all' or
 (exists(select 1 from public.rise_answers a where a.question_id=q.id and a.author_role in ('teacher','ta','admin')))=(p_filter='answered')
 order by q.created_at asc,q.id asc limit 21 offset p_offset;
end;$$;
revoke all on function public.rise_staff_question_queue(text,integer) from public,anon;
grant execute on function public.rise_staff_question_queue(text,integer) to authenticated;
notify pgrst,'reload schema';
commit;

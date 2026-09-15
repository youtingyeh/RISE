-- 先安裝 setup.sql / staff-upgrade.sql，再執行本檔。可重複執行。
begin;
create table if not exists public.rise_teaching_resources (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 160),
 summary text not null default '' check(char_length(summary)<=500),
 body text not null default '' check(char_length(body)<=50000),
 subject text not null check(subject in ('math','physics','chemistry','multiple')),
 kind text not null check(kind in ('article','material','video')),
 status text not null default 'draft' check(status in ('draft','published')),
 youtube_id text not null default '' check(youtube_id='' or youtube_id ~ '^[a-zA-Z0-9_-]{11}$'),
 files jsonb not null default '[]' check(jsonb_typeof(files)='array' and jsonb_array_length(files)<=5),
 version integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists rise_resources_status on public.rise_teaching_resources(status,updated_at desc);
create or replace function rise_private.can_edit_resources() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rise_profiles p join auth.users u on p.id=u.id where p.id=auth.uid() and p.role in ('teacher','admin') and u.email_confirmed_at is not null);
$$;
revoke all on function rise_private.can_edit_resources() from public;
grant execute on function rise_private.can_edit_resources() to authenticated;
alter table public.rise_teaching_resources enable row level security;
revoke all on public.rise_teaching_resources from public,anon,authenticated;
grant select on public.rise_teaching_resources to anon,authenticated;
drop policy if exists rise_resources_public on public.rise_teaching_resources;
create policy rise_resources_public on public.rise_teaching_resources for select to anon,authenticated using(status='published');
drop policy if exists rise_resources_edit_read on public.rise_teaching_resources;
create policy rise_resources_edit_read on public.rise_teaching_resources for select to authenticated
using(rise_private.can_edit_resources() and (owner_id=auth.uid() or rise_private.is_admin()));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('rise-teaching-files','rise-teaching-files',false,52428800,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','image/jpeg','image/png','image/webp','video/mp4','video/webm'])
on conflict(id) do update set public=false,file_size_limit=52428800,allowed_mime_types=excluded.allowed_mime_types;
create or replace function rise_private.can_read_teaching_file(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select rise_private.is_verified() and (
 (split_part(p_path,'/',1)=auth.uid()::text or (rise_private.can_edit_resources() and rise_private.is_admin()))
 or exists(select 1 from public.rise_teaching_resources r, jsonb_array_elements(r.files) f where r.status='published' and f->>'path'=p_path));
$$;
revoke all on function rise_private.can_read_teaching_file(text) from public;
grant execute on function rise_private.can_read_teaching_file(text) to authenticated;
drop policy if exists rise_teaching_file_read on storage.objects;
create policy rise_teaching_file_read on storage.objects for select to authenticated using(bucket_id='rise-teaching-files' and rise_private.can_read_teaching_file(name));
drop policy if exists rise_teaching_file_upload on storage.objects;
create policy rise_teaching_file_upload on storage.objects for insert to authenticated with check(bucket_id='rise-teaching-files' and (storage.foldername(name))[1]=auth.uid()::text and rise_private.can_edit_resources());
-- 不提供覆寫。可用下架保留版本來源；移除中的舊附件不立即刪除，避免回應遺失導致失聯。
drop policy if exists rise_teaching_file_delete on storage.objects;
create policy rise_teaching_file_delete on storage.objects for delete to authenticated using(bucket_id='rise-teaching-files' and (storage.foldername(name))[1]=auth.uid()::text);
create or replace function public.rise_save_resource(p_id uuid,p_expected_version integer,p_document jsonb) returns public.rise_teaching_resources
language plpgsql security definer set search_path='' as $$
declare old public.rise_teaching_resources%rowtype; saved public.rise_teaching_resources%rowtype; item jsonb; attachments jsonb; mime text;
begin
 if not rise_private.can_edit_resources() then raise exception 'rise:僅限已核准教師與管理員編輯。';end if;
 if p_id is null or p_document is null or jsonb_typeof(p_document)<>'object' then raise exception 'rise:資源格式錯誤。';end if;
 perform 1 from public.rise_profiles where id=auth.uid() for update;
 if not rise_private.can_edit_resources() then raise exception 'rise:編輯資格已變更。';end if;
 select * into old from public.rise_teaching_resources where id=p_id for update;
 if found then
  if old.owner_id<>auth.uid() and not rise_private.is_admin() then raise exception 'rise:只能編輯自己建立的資源。';end if;
  if old.version is distinct from p_expected_version then raise exception 'rise:內容已被其他人更新，請重新載入後再編輯。';end if;
 elsif p_expected_version is distinct from 0 then raise exception 'rise:找不到原資源。';end if;
 if coalesce(char_length(trim(p_document->>'title')),0) not between 1 and 160 then raise exception 'rise:請填寫標題（最多160字）。';end if;
 if coalesce(p_document->>'status','') not in ('draft','published') or coalesce(p_document->>'kind','') not in ('article','material','video') or coalesce(p_document->>'subject','') not in ('math','physics','chemistry','multiple') then raise exception 'rise:資源分類不正確。';end if;
 if char_length(coalesce(p_document->>'summary',''))>500 or char_length(coalesce(p_document->>'body',''))>50000 then raise exception 'rise:內容超過字數限制。';end if;
 if coalesce(p_document->>'youtube_id','')<>'' and (p_document->>'youtube_id')!~'^[a-zA-Z0-9_-]{11}$' then raise exception 'rise:YouTube 網址不正確。';end if;
 attachments:=coalesce(p_document->'files','[]'::jsonb);
 if jsonb_typeof(attachments)<>'array' then raise exception 'rise:附件格式錯誤。';end if;
 if jsonb_array_length(attachments)>5 then raise exception 'rise:最多五個附件。';end if;
 for item in select value from jsonb_array_elements(attachments) loop
  if jsonb_typeof(item)<>'object' or coalesce(char_length(item->>'name'),0) not between 1 and 255 then raise exception 'rise:附件名稱不正確。';end if;
  if not exists(select 1 from storage.objects s where s.bucket_id='rise-teaching-files' and s.name=item->>'path' and (
    split_part(s.name,'/',1)=auth.uid()::text or rise_private.is_admin() or exists(select 1 from jsonb_array_elements(coalesce(old.files,'[]')) f where f->>'path'=s.name)
  )) then raise exception 'rise:附件不存在或無權使用。';end if;
  if coalesce(item->>'type','') not in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','image/jpeg','image/png','image/webp','video/mp4','video/webm') then raise exception 'rise:不支援的附件格式。';end if;
 end loop;
 if p_document->>'status'='published' then
  if p_document->>'kind'='article' and char_length(trim(coalesce(p_document->>'body','')))=0 then raise exception 'rise:請先撰寫文章內容。';end if;
  if p_document->>'kind'='material' and jsonb_array_length(attachments)=0 then raise exception 'rise:請先上傳教材。';end if;
  if p_document->>'kind'='video' and coalesce(p_document->>'youtube_id','')='' and not exists(select 1 from jsonb_array_elements(attachments) f where f->>'type' in ('video/mp4','video/webm')) then raise exception 'rise:請提供 YouTube 網址或影片檔。';end if;
 end if;
 insert into public.rise_teaching_resources(id,owner_id,title,summary,body,subject,kind,status,youtube_id,files,version)
 values(p_id,coalesce(old.owner_id,auth.uid()),trim(p_document->>'title'),coalesce(p_document->>'summary',''),coalesce(p_document->>'body',''),p_document->>'subject',p_document->>'kind',p_document->>'status',coalesce(p_document->>'youtube_id',''),attachments,coalesce(old.version,0)+1)
 on conflict(id) do update set title=excluded.title,summary=excluded.summary,body=excluded.body,subject=excluded.subject,kind=excluded.kind,status=excluded.status,youtube_id=excluded.youtube_id,files=excluded.files,version=excluded.version,updated_at=now()
 where public.rise_teaching_resources.version=p_expected_version and (public.rise_teaching_resources.owner_id=auth.uid() or rise_private.is_admin())
 returning * into saved;
 if not found then raise exception 'rise:內容已被更新，請重新載入。';end if;
 return saved;
end;$$;
revoke all on function public.rise_save_resource(uuid,integer,jsonb) from public,anon;
grant execute on function public.rise_save_resource(uuid,integer,jsonb) to authenticated;
create table if not exists public.rise_resource_visits (
 user_id uuid not null references auth.users(id) on delete cascade,
 resource_id uuid not null references public.rise_teaching_resources(id) on delete cascade,
 last_opened_at timestamptz not null default now(),primary key(user_id,resource_id)
);
alter table public.rise_resource_visits enable row level security;
revoke all on public.rise_resource_visits from public,anon,authenticated;
grant select on public.rise_resource_visits to authenticated;
drop policy if exists rise_resource_visits_own on public.rise_resource_visits;
create policy rise_resource_visits_own on public.rise_resource_visits for select to authenticated using(user_id=auth.uid());
create or replace function public.rise_record_resource_visit(p_resource_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not rise_private.is_verified() then raise exception 'rise:請先登入。';end if;
 if not exists(select 1 from public.rise_teaching_resources r where r.id=p_resource_id and (r.status='published' or (rise_private.can_edit_resources() and (r.owner_id=auth.uid() or rise_private.is_admin())))) then raise exception 'rise:無法讀取此資源。';end if;
 insert into public.rise_resource_visits(user_id,resource_id) values(auth.uid(),p_resource_id)
 on conflict(user_id,resource_id) do update set last_opened_at=now();
end;$$;
revoke all on function public.rise_record_resource_visit(uuid) from public,anon;
grant execute on function public.rise_record_resource_visit(uuid) to authenticated;
notify pgrst,'reload schema';
commit;

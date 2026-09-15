-- 先執行 staff-upgrade.sql。此檔保留舊附件，新增 Google Drive 儲存。
begin;
create table if not exists public.rise_drive_settings (
 id boolean primary key default true check(id), folder_id text not null, enabled boolean not null default false
);
create table if not exists public.rise_drive_owners (
 user_id uuid primary key references auth.users(id) on delete cascade,
 deleting boolean not null default false
);
create table if not exists public.rise_drive_files (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete restrict,
 drive_id text not null unique, original_name text not null check(char_length(original_name) between 1 and 255),
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
 bytes integer not null check(bytes between 1 and 5242880),
 status text not null default 'pending' check(status in ('pending','ready')),
 created_at timestamptz not null default now()
);
create index if not exists rise_drive_files_owner on public.rise_drive_files(user_id);
alter table public.rise_drive_settings enable row level security;
alter table public.rise_drive_owners enable row level security;
alter table public.rise_drive_files enable row level security;
revoke all on public.rise_drive_settings,public.rise_drive_owners,public.rise_drive_files from public,anon,authenticated;
grant all on public.rise_drive_settings,public.rise_drive_owners,public.rise_drive_files to service_role;
create or replace function public.rise_attachment_backend() returns text language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.rise_drive_settings where id and enabled) then 'google-drive' else 'supabase' end;
$$;
revoke all on function public.rise_attachment_backend() from public,anon;
grant execute on function public.rise_attachment_backend() to authenticated;
create or replace function rise_private.attachments_open() returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.rise_drive_owners where user_id=auth.uid() and deleting);
$$;
revoke all on function rise_private.attachments_open() from public;
grant execute on function rise_private.attachments_open() to authenticated;
drop policy if exists rise_credentials_upload on storage.objects;
create policy rise_credentials_upload on storage.objects for insert to authenticated with check(
 bucket_id='rise-credentials' and (storage.foldername(name))[1]=auth.uid()::text and
 exists(select 1 from public.rise_profiles where id=auth.uid() and role='student') and
 rise_private.is_verified() and rise_private.attachments_open());
-- 只有 Edge Function 的服務端憑證可登記檔案；前台不可偽造 Drive ID。
create or replace function public.rise_drive_reserve(p_user uuid,p_id uuid,p_drive_id text,p_name text,p_mime text,p_bytes integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.rise_profiles where id=p_user and role='student' for update;
 if not found or not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then raise exception 'rise:只有已驗證的一般帳號可上傳資格證明。';end if;
 if exists(select 1 from public.rise_drive_owners where user_id=p_user and deleting) then raise exception 'rise:帳號正在刪除，請完成刪除後再操作。';end if;
 if (select count(*) from public.rise_drive_files where user_id=p_user)>=30 then raise exception 'rise:此帳號附件已達上限，請聯絡管理員。';end if;
 insert into public.rise_drive_files(id,user_id,drive_id,original_name,mime_type,bytes) values(p_id,p_user,p_drive_id,p_name,p_mime,p_bytes);
end;$$;
revoke all on function public.rise_drive_reserve(uuid,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.rise_drive_reserve(uuid,uuid,text,text,text,integer) to service_role;
create or replace function public.rise_drive_prepare_delete() returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.rise_profiles where id=auth.uid() and role<>'admin' for update;
 if not found then raise exception 'rise:請登入一般帳號，管理員不得自行刪除。';end if;
 if exists(select 1 from public.rise_drive_files where user_id=auth.uid() and status='pending' and created_at>now()-interval '2 minutes') then raise exception 'rise:附件仍在處理中，請兩分鐘後再刪除帳號。';end if;
 insert into public.rise_drive_owners(user_id,deleting) values(auth.uid(),true) on conflict(user_id) do update set deleting=true;
 return exists(select 1 from public.rise_drive_files where user_id=auth.uid());
end;$$;
revoke all on function public.rise_drive_prepare_delete() from public,anon;
grant execute on function public.rise_drive_prepare_delete() to authenticated;
create or replace function public.rise_submit_staff_application(p_school text,p_subject text,p_reason text,p_expected_version integer,p_requested_role text,p_attachments jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare aid uuid; item jsonb;
begin
 perform 1 from public.rise_profiles where id=auth.uid() for update;
 if not rise_private.attachments_open() then raise exception 'rise:帳號正在刪除，不能送出申請。';end if;
 if p_requested_role is null or p_requested_role not in ('teacher','ta') then raise exception 'rise:申請身分不正確。'; end if;
 if p_attachments is null or jsonb_typeof(p_attachments)<>'array' then raise exception 'rise:附件格式錯誤。'; end if;
 if jsonb_array_length(p_attachments) not between 1 and 3 then raise exception 'rise:請提供 1 至 3 份證明。'; end if;
 for item in select value from jsonb_array_elements(p_attachments) loop
  if jsonb_typeof(item)<>'object' or coalesce(char_length(item->>'name'),0) not between 1 and 255 or
    not (
   (coalesce(item->>'provider','supabase')='supabase' and exists(select 1 from storage.objects where bucket_id='rise-credentials' and name=item->>'path' and (storage.foldername(name))[1]=auth.uid()::text))
   or (item->>'provider'='google-drive' and exists(select 1 from public.rise_drive_files f where f.id::text=item->>'path' and f.user_id=auth.uid() and f.status='ready' and f.original_name=item->>'name'))
  )
  then raise exception 'rise:附件不存在或無權使用，請重新上傳。'; end if;
 end loop;
 aid:=public.rise_submit_teacher_application(p_school,p_subject,p_reason,p_expected_version);
 update public.rise_teacher_applications set requested_role=p_requested_role,attachments=p_attachments where id=aid;
 update public.rise_application_events set snapshot=to_jsonb(a) from public.rise_teacher_applications a
 where application_id=aid and a.id=aid and actor_id=auth.uid() and rise_application_events.created_at=now();
 return aid;
end;
$$;

notify pgrst, 'reload schema';
commit;

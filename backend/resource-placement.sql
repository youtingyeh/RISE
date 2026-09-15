-- 在 teaching-resources.sql 後執行；可重複執行。既有資料歸入科學探索／待整理教材。
begin;
alter table public.rise_teaching_resources add column if not exists destination text not null default 'science' check(destination in ('science','learning'));
alter table public.rise_teaching_resources add column if not exists collection text not null default '待整理教材' check(char_length(collection) between 1 and 100);
alter table public.rise_teaching_resources add column if not exists group_order integer not null default 0 check(group_order between 0 and 999999);
alter table public.rise_teaching_resources add column if not exists item_order integer not null default 0 check(item_order between 0 and 999999);
create index if not exists rise_resource_placement on public.rise_teaching_resources(destination,status,subject,owner_id,collection);
create or replace function public.rise_save_resource(p_id uuid,p_expected_version integer,p_document jsonb) returns public.rise_teaching_resources
language plpgsql security definer set search_path='' as $$
declare old public.rise_teaching_resources%rowtype; saved public.rise_teaching_resources%rowtype; item jsonb; attachments jsonb; mime text; destination text; collection text; group_order integer; item_order integer;
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
 destination:=coalesce(p_document->>'destination',old.destination,'science');
 collection:=trim(coalesce(p_document->>'collection',old.collection,'待整理教材'));
 if destination not in ('science','learning') or char_length(collection) not between 1 and 100 then raise exception 'rise:請選擇發布區域並填寫主題／單元名稱（最多100字）。';end if;
 if coalesce(p_document->>'group_order','0')!~'^[0-9]{1,6}$' or coalesce(p_document->>'item_order','0')!~'^[0-9]{1,6}$' then raise exception 'rise:排序須為0至999999的整數。';end if;
 group_order:=coalesce((p_document->>'group_order')::integer,old.group_order,0);
 item_order:=coalesce((p_document->>'item_order')::integer,old.item_order,0);
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
 insert into public.rise_teaching_resources(id,owner_id,title,summary,body,subject,kind,status,youtube_id,files,version,destination,collection,group_order,item_order)
 values(p_id,coalesce(old.owner_id,auth.uid()),trim(p_document->>'title'),coalesce(p_document->>'summary',''),coalesce(p_document->>'body',''),p_document->>'subject',p_document->>'kind',p_document->>'status',coalesce(p_document->>'youtube_id',''),attachments,coalesce(old.version,0)+1,destination,collection,group_order,item_order)
 on conflict(id) do update set title=excluded.title,summary=excluded.summary,body=excluded.body,subject=excluded.subject,kind=excluded.kind,status=excluded.status,youtube_id=excluded.youtube_id,files=excluded.files,version=excluded.version,updated_at=now(),destination=excluded.destination,collection=excluded.collection,group_order=excluded.group_order,item_order=excluded.item_order
 where public.rise_teaching_resources.version=p_expected_version and (public.rise_teaching_resources.owner_id=auth.uid() or rise_private.is_admin())
 returning * into saved;
 if not found then raise exception 'rise:內容已被更新，請重新載入。';end if;
 return saved;
end;$$;
revoke all on function public.rise_save_resource(uuid,integer,jsonb) from public,anon;
grant execute on function public.rise_save_resource(uuid,integer,jsonb) to authenticated;
-- 各教師的同名單元分開計算。學生先看單元卡片，不直接列出每個上傳檔案。
create or replace function public.rise_resource_groups(p_destination text,p_subject text default 'all',p_kind text default 'all',p_offset integer default 0)
returns table(owner_id uuid,collection text,subject text,item_count bigint,group_order integer)
language sql stable security invoker set search_path='' as $$
 select r.owner_id,r.collection,r.subject,count(*),min(r.group_order)
 from public.rise_teaching_resources r
 where r.status='published' and r.destination=p_destination and (p_subject='all' or r.subject=p_subject) and (p_kind='all' or r.kind=p_kind)
 group by r.owner_id,r.collection,r.subject
 order by min(r.group_order),min(r.created_at),r.owner_id,r.collection,r.subject
 limit 13 offset greatest(0,least(coalesce(p_offset,0),1000000));
$$;
revoke all on function public.rise_resource_groups(text,text,text,integer) from public;
grant execute on function public.rise_resource_groups(text,text,text,integer) to anon,authenticated;
create or replace function public.rise_resource_group_items(p_owner uuid,p_destination text,p_collection text,p_subject text,p_kind text default 'all',p_offset integer default 0)
returns table(id uuid,title text,summary text,kind text,item_order integer)
language sql stable security invoker set search_path='' as $$
 select r.id,r.title,r.summary,r.kind,r.item_order from public.rise_teaching_resources r
 where r.status='published' and r.owner_id=p_owner and r.destination=p_destination and r.collection=p_collection and r.subject=p_subject and (p_kind='all' or r.kind=p_kind)
 order by r.item_order,r.created_at,r.id limit 13 offset greatest(0,least(coalesce(p_offset,0),1000000));
$$;
revoke all on function public.rise_resource_group_items(uuid,text,text,text,text,integer) from public;
grant execute on function public.rise_resource_group_items(uuid,text,text,text,text,integer) to anon,authenticated;
-- 選取多筆後可一次歸類與排序。先鎖定、檢查全部版本與權限，再於同一交易更新。
create or replace function public.rise_organize_resources(p_changes jsonb,p_destination text,p_collection text,p_group_order integer) returns void
language plpgsql security definer set search_path='' as $$
declare r public.rise_teaching_resources%rowtype; item jsonb; total integer:=0;
begin
 perform 1 from public.rise_profiles where id=auth.uid() for update;
 if not rise_private.can_edit_resources() then raise exception 'rise:只有已核准教師與管理員可整理教材。';end if;
 if p_changes is null or jsonb_typeof(p_changes)<>'array' then raise exception 'rise:請先選取教材。';end if;
 if jsonb_array_length(p_changes) not between 1 and 100 then raise exception 'rise:一次請選取1至100筆教材。';end if;
 if p_destination is null or p_destination not in ('science','learning') or coalesce(char_length(trim(p_collection)),0) not between 1 and 100 or p_group_order is null or p_group_order not between 0 and 999999 then raise exception 'rise:發布區域、單元名稱或排序不正確。';end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_changes))<>jsonb_array_length(p_changes) then raise exception 'rise:教材編號重複。';end if;
 for r in select * from public.rise_teaching_resources where id in(select (value->>'id')::uuid from jsonb_array_elements(p_changes)) order by id for update loop
  if r.owner_id<>auth.uid() and not rise_private.is_admin() then raise exception 'rise:不能整理其他教師的教材。';end if;
  select value into item from jsonb_array_elements(p_changes) where value->>'id'=r.id::text;
  if r.version is distinct from (item->>'version')::integer then raise exception 'rise:所選教材已更新，請重新選取。';end if;
  if coalesce(item->>'position','')!~'^[0-9]{1,6}$' then raise exception 'rise:排序不正確。';end if;
  total:=total+1;
 end loop;
 if total<>jsonb_array_length(p_changes) then raise exception 'rise:部分教材已不存在，請重新整理。';end if;
 for item in select value from jsonb_array_elements(p_changes) loop
  update public.rise_teaching_resources set destination=p_destination,collection=trim(p_collection),group_order=p_group_order,item_order=(item->>'position')::integer,version=version+1,updated_at=now() where id=(item->>'id')::uuid;
 end loop;
end;$$;
revoke all on function public.rise_organize_resources(jsonb,text,text,integer) from public,anon;
grant execute on function public.rise_organize_resources(jsonb,text,text,integer) to authenticated;
notify pgrst,'reload schema';
commit;

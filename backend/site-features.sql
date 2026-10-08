-- RISE website availability settings. Run once after the account setup; repeatable.
-- Presentation switches do not replace RLS or revoke access to previously published files.
begin;
do $$begin
 if to_regclass('public.rise_profiles') is null then raise exception 'Install the account system first.';end if;
end $$;
create schema if not exists rise_private;
create table if not exists rise_private.site_features(
 id boolean primary key default true check(id),
 version bigint not null default 1,
 flags jsonb not null,
 updated_at timestamptz not null default now()
);
insert into rise_private.site_features(id,flags) values(true,
 '{"science":true,"videos":true,"questions":true,"modules":true,"assignments":true,"discussions":true,"competitions":true,"gallery":true,"dialogues":true,"yearbook":true,"ta_training":true,"ta_forum":true,"plc":true,"club_grants":true,"learning_report":true,"schedule":true}'::jsonb)
on conflict do nothing;
create table if not exists rise_private.site_feature_events(
 id bigint generated always as identity primary key,
 actor_id uuid references auth.users(id) on delete set null,
 changes jsonb not null,version bigint not null,created_at timestamptz not null default now()
);
alter table rise_private.site_features enable row level security;
alter table rise_private.site_feature_events enable row level security;
revoke all on rise_private.site_features,rise_private.site_feature_events from public,anon,authenticated;

create or replace function public.rise_site_features() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('flags',s.flags,'version',s.version,'updated_at',s.updated_at,
 'is_admin',exists(select 1 from public.rise_profiles p join auth.users u on u.id=p.id
 where p.id=auth.uid() and p.role='admin' and u.email_confirmed_at is not null))
 from rise_private.site_features s where s.id;
$$;
revoke all on function public.rise_site_features() from public;
grant execute on function public.rise_site_features() to anon,authenticated;

create or replace function public.rise_set_site_features(p_changes jsonb,p_version bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_flags jsonb;current_version bigint;delta jsonb;
begin
 -- Lock the actor profile so a concurrent role revocation cannot race this write.
 perform 1 from public.rise_profiles p join auth.users u on u.id=p.id
 where p.id=auth.uid() and p.role='admin' and u.email_confirmed_at is not null for share of p;
 if not found then raise exception 'rise:僅已驗證的管理員可以變更網站開放設定。' using errcode='42501';end if;
 if p_changes is null or jsonb_typeof(p_changes)<>'object' or p_changes='{}'::jsonb then
  raise exception 'rise:請提供要變更的功能開關。';end if;
 select flags,version into current_flags,current_version from rise_private.site_features where id for update;
 if p_version is distinct from current_version then raise exception 'rise:設定已被其他管理員更新，請重新讀取後再操作。' using errcode='40001';end if;
 if exists(select 1 from jsonb_each(p_changes) e where not current_flags ? e.key or jsonb_typeof(e.value)<>'boolean') then
  raise exception 'rise:未知功能或開關格式不正確。';end if;
 select jsonb_object_agg(e.key,e.value) into delta from jsonb_each(p_changes) e where current_flags->e.key is distinct from e.value;
 if delta is null then return public.rise_site_features();end if;
 update rise_private.site_features set flags=flags||delta,version=version+1,updated_at=now() where id;
 insert into rise_private.site_feature_events(actor_id,changes,version) values(auth.uid(),delta,current_version+1);
 return public.rise_site_features();
end $$;
revoke all on function public.rise_set_site_features(jsonb,bigint) from public,anon;
grant execute on function public.rise_set_site_features(jsonb,bigint) to authenticated;
notify pgrst,'reload schema';
commit;

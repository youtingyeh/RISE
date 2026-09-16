-- 在 Supabase SQL Editor 執行；不會刪除既有資料。
begin;
create table if not exists public.rise_explore_videos (
 id text primary key default gen_random_uuid()::text,
 subject text not null check(subject in ('math','physics','chemistry')),
 title text not null check(char_length(btrim(title)) between 1 and 160),
 summary text not null default '' check(char_length(summary)<=10000),
 "youtubeId" text not null check("youtubeId" ~ '^[A-Za-z0-9_-]{11}$'),
 speaker text not null default '' check(char_length(speaker)<=160),
 level text not null default '' check(char_length(level)<=160),
 duration text not null default '' check(char_length(duration)<=80),
 question text not null default '' check(char_length(question)<=4000),
 reflection text not null default '' check(char_length(reflection)<=4000),
 published boolean not null default false,
 sort_order integer not null default 0
);
create or replace function public.rise_video_admin() returns boolean
language sql stable security definer set search_path='' as $video_admin$
 select exists(select 1 from public.rise_profiles p join auth.users u on u.id=p.id
 where p.id=auth.uid() and p.role='admin' and u.email_confirmed_at is not null);
$video_admin$;
revoke all on function public.rise_video_admin() from public;
grant execute on function public.rise_video_admin() to anon,authenticated;
alter table public.rise_explore_videos enable row level security;
revoke all on public.rise_explore_videos from anon,authenticated;
grant select on public.rise_explore_videos to anon,authenticated;
grant insert,update on public.rise_explore_videos to authenticated;
drop policy if exists video_read on public.rise_explore_videos;
create policy video_read on public.rise_explore_videos for select to anon,authenticated
 using(published or public.rise_video_admin());
drop policy if exists video_insert on public.rise_explore_videos;
create policy video_insert on public.rise_explore_videos for insert to authenticated
 with check(public.rise_video_admin());
drop policy if exists video_update on public.rise_explore_videos;
create policy video_update on public.rise_explore_videos for update to authenticated
 using(public.rise_video_admin()) with check(public.rise_video_admin());
notify pgrst,'reload schema';
commit;

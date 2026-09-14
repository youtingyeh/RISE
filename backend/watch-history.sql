-- RISE 個人觀看紀錄。可重複執行；不刪除既有會員或觀看資料。
begin;

create table if not exists public.rise_watch_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  video_id text not null check (char_length(video_id) between 1 and 200),
  video_title text not null check (char_length(video_title) <= 300),
  position_seconds numeric not null default 0 check (position_seconds between 0 and 604800),
  duration_seconds numeric not null default 0 check (duration_seconds between 0 and 604800),
  watched_seconds numeric not null default 0 check (watched_seconds between 0 and 604800),
  sequence_number integer not null check (sequence_number > 0),
  reached_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, session_id)
);

alter table public.rise_watch_sessions enable row level security;
revoke all on public.rise_watch_sessions from anon, authenticated;
grant select on public.rise_watch_sessions to authenticated;

drop policy if exists rise_watch_own on public.rise_watch_sessions;
create policy rise_watch_own
on public.rise_watch_sessions
for select
to authenticated
using (user_id = auth.uid());

create or replace function public.rise_save_watch(
  p_session_id uuid,
  p_video_id text,
  p_title text,
  p_position numeric,
  p_duration numeric,
  p_watched numeric,
  p_sequence integer,
  p_ended boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid := auth.uid();
begin
  if u is null or not exists (
    select 1
    from auth.users
    where id = u and email_confirmed_at is not null
  ) then
    raise exception 'rise:請先登入並驗證信箱。';
  end if;

  if p_session_id is null
    or p_video_id is null
    or char_length(p_video_id) not between 1 and 200
    or p_title is null
    or char_length(p_title) > 300
    or p_position is null
    or p_position not between 0 and 604800
    or p_duration is null
    or p_duration not between 0 and 604800
    or p_watched is null
    or p_watched not between 0 and 604800
    or p_sequence is null
    or p_sequence < 1
    or p_ended is null
  then
    raise exception 'rise:觀看紀錄格式不正確。';
  end if;

  insert into public.rise_watch_sessions as existing (
    user_id,
    session_id,
    video_id,
    video_title,
    position_seconds,
    duration_seconds,
    watched_seconds,
    sequence_number,
    reached_end
  )
  values (
    u,
    p_session_id,
    p_video_id,
    p_title,
    case when p_duration > 0 then least(p_position, p_duration) else p_position end,
    p_duration,
    p_watched,
    p_sequence,
    p_ended
  )
  on conflict (user_id, session_id) do update set
    video_title = excluded.video_title,
    position_seconds = excluded.position_seconds,
    duration_seconds = excluded.duration_seconds,
    watched_seconds = greatest(existing.watched_seconds, excluded.watched_seconds),
    sequence_number = excluded.sequence_number,
    reached_end = existing.reached_end or excluded.reached_end,
    updated_at = now()
  where existing.video_id = excluded.video_id
    and existing.sequence_number < excluded.sequence_number;
end;
$$;

revoke all on function public.rise_save_watch(
  uuid, text, text, numeric, numeric, numeric, integer, boolean
) from public, anon;

grant execute on function public.rise_save_watch(
  uuid, text, text, numeric, numeric, numeric, integer, boolean
) to authenticated;

create or replace view public.rise_watch_history
with (security_invoker = true)
as
select
  user_id,
  video_id,
  (array_agg(video_title order by updated_at desc, session_id))[1] as video_title,
  (array_agg(position_seconds order by updated_at desc, session_id))[1] as position_seconds,
  (array_agg(duration_seconds order by updated_at desc, session_id))[1] as duration_seconds,
  sum(watched_seconds) as watched_seconds,
  bool_or(reached_end) as reached_end,
  max(updated_at) as last_watched_at
from public.rise_watch_sessions
group by user_id, video_id;

revoke all on public.rise_watch_history from anon, authenticated;
grant select on public.rise_watch_history to authenticated;

commit;

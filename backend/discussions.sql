-- 在既有帳號系統（rise_profiles）安裝後執行，可重複執行。
begin;
create or replace function public.rise_discussion_role(p_roles text[]) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rise_profiles p join auth.users u on u.id=p.id
 where p.id=auth.uid() and u.email_confirmed_at is not null and p.role=any(p_roles));
$$;
revoke all on function public.rise_discussion_role(text[]) from public,anon;
grant execute on function public.rise_discussion_role(text[]) to authenticated;
create table if not exists public.rise_discussion_topics (
 id uuid primary key default gen_random_uuid(),
 author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 title text not null check(char_length(trim(title)) between 1 and 160),
 body text not null check(char_length(trim(body)) between 1 and 10000),
 closed boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.rise_discussion_answers (
 id uuid primary key default gen_random_uuid(),
 topic_id uuid not null references public.rise_discussion_topics(id) on delete cascade,
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 body text not null check(char_length(trim(body)) between 1 and 10000),
 created_at timestamptz not null default now(),
 unique(topic_id,user_id)
);
create index if not exists rise_discussion_topics_time on public.rise_discussion_topics(created_at desc,id);
create index if not exists rise_discussion_answers_topic on public.rise_discussion_answers(topic_id,created_at,id);
alter table public.rise_discussion_topics enable row level security;
alter table public.rise_discussion_answers enable row level security;
revoke all on public.rise_discussion_topics,public.rise_discussion_answers from anon,authenticated;
grant select on public.rise_discussion_topics,public.rise_discussion_answers to authenticated;
grant insert(title,body) on public.rise_discussion_topics to authenticated;
grant update(closed) on public.rise_discussion_topics to authenticated;
grant insert(topic_id,body) on public.rise_discussion_answers to authenticated;
drop policy if exists rise_topics_read on public.rise_discussion_topics;
create policy rise_topics_read on public.rise_discussion_topics for select to authenticated
 using(public.rise_discussion_role(array['student','ta','teacher','admin']));
drop policy if exists rise_topics_publish on public.rise_discussion_topics;
create policy rise_topics_publish on public.rise_discussion_topics for insert to authenticated
 with check(author_id=auth.uid() and public.rise_discussion_role(array['teacher','admin']));
drop policy if exists rise_topics_close on public.rise_discussion_topics;
create policy rise_topics_close on public.rise_discussion_topics for update to authenticated
 using((author_id=auth.uid() and public.rise_discussion_role(array['teacher'])) or public.rise_discussion_role(array['admin']))
 with check((author_id=auth.uid() and public.rise_discussion_role(array['teacher'])) or public.rise_discussion_role(array['admin']));
drop policy if exists rise_answers_read on public.rise_discussion_answers;
create policy rise_answers_read on public.rise_discussion_answers for select to authenticated
 using(public.rise_discussion_role(array['teacher','admin']) or (user_id=auth.uid() and public.rise_discussion_role(array['student','ta'])));
drop policy if exists rise_answers_submit on public.rise_discussion_answers;
create policy rise_answers_submit on public.rise_discussion_answers for insert to authenticated
 with check(user_id=auth.uid() and public.rise_discussion_role(array['student','ta'])
 and exists(select 1 from public.rise_discussion_topics t where t.id=topic_id and not t.closed));
notify pgrst,'reload schema';
commit;

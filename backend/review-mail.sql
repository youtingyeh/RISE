-- 在既有 staff-upgrade.sql 之後執行。僅記錄安裝後的新審核，不重寄歷史案件。
begin;
create table if not exists public.rise_review_mail (
 id uuid primary key default gen_random_uuid(),
 application_id uuid not null references public.rise_teacher_applications(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 version integer not null,
 decision text not null check(decision in ('approved','returned','rejected')),
 requested_role text not null,
 note text not null,
 state text not null default 'pending' check(state in ('pending','sending','sent')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 sent_at timestamptz,
 created_at timestamptz not null default now(),
 unique(application_id,version)
);
alter table public.rise_review_mail enable row level security;
revoke all on public.rise_review_mail from public,anon,authenticated;
grant all on public.rise_review_mail to service_role;
create or replace function rise_private.queue_review_mail() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.status='pending' and new.status in ('approved','returned','rejected') then
 insert into public.rise_review_mail(application_id,user_id,version,decision,requested_role,note)
 values(new.id,new.user_id,new.version,new.status,new.requested_role,coalesce(new.review_note,''))
 on conflict(application_id,version) do nothing;
 end if;
 return new;
end;$$;
revoke all on function rise_private.queue_review_mail() from public,anon,authenticated;
drop trigger if exists rise_queue_review_mail on public.rise_teacher_applications;
create trigger rise_queue_review_mail after update on public.rise_teacher_applications
for each row execute function rise_private.queue_review_mail();
create or replace function public.rise_claim_review_mail() returns setof public.rise_review_mail
language sql security definer set search_path='' as $$
 update public.rise_review_mail set state='sending', attempts=attempts+1, available_at=now()+interval '10 minutes'
 where id in (select id from public.rise_review_mail where state<>'sent' and available_at<=now()
 order by created_at for update skip locked limit 1) returning *;
$$;
revoke all on function public.rise_claim_review_mail() from public,anon,authenticated;
grant execute on function public.rise_claim_review_mail() to service_role;
notify pgrst,'reload schema';
commit;

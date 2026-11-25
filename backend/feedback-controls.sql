-- Apply after feedback.sql and feedback-autofix.sql. Leave the previous migrations installed.
begin;

create table if not exists rise_private.feedback_repair_settings (
 singleton boolean primary key default true check (singleton),
 enabled boolean not null default false,
 epoch uuid not null default gen_random_uuid()
);
alter table rise_private.feedback_repair_settings enable row level security;
revoke all on rise_private.feedback_repair_settings from public,anon,authenticated,service_role;
insert into rise_private.feedback_repair_settings (singleton) values (true)
on conflict (singleton) do nothing;

alter table public.rise_autofix_cases
 add column if not exists link_text text,
 add column if not exists "authorization" uuid,
 add column if not exists authorized_by uuid references auth.users(id) on delete set null,
 add column if not exists authorized_at timestamptz,
 add column if not exists repair_epoch uuid,
 add column if not exists repair_lease_until timestamptz,
 add column if not exists workflow_run_url text,
 add column if not exists workflow_patch_name text;

-- This clear-text marker is a job version. Authentication is still required at the worker RPC.
create or replace function rise_private.feedback_repair_eligible(f public.rise_feedback)
returns boolean language sql immutable set search_path='' as $$
 select not f.urgent and not f.is_simulation and f.kind='bug' and f.triage_class='link_candidate'
    and f.page in ('join.html','schedule.html');
$$;
revoke all on function rise_private.feedback_repair_eligible(public.rise_feedback)
 from public,anon,authenticated,service_role;

-- Every repair transition takes the settings row lock before locking a report.
-- Expired or invalidated work releases its lease while keeping the consumed attempt.
create or replace function rise_private.feedback_recover_repairs(p_epoch uuid)
returns void language plpgsql set search_path='' as $$
declare job record;
begin
 for job in
  select f.id,a.attempts,a.is_simulation
  from public.rise_feedback f join public.rise_autofix_cases a on a.feedback_id=f.id
  where (a.state='attempting' or (a.state='fix_ready' and a."authorization" is not null and a.workflow_run_url is null))
    and (a.repair_epoch is distinct from p_epoch or a.repair_lease_until is null or a.repair_lease_until<=clock_timestamp())
  order by f.id limit 50 for update of f
 loop
  update public.rise_autofix_cases
   set state=case when job.attempts>=2 then 'escalated' else 'attempt_failed' end,
       stop_reason='repair_lease_expired',repair_epoch=null,repair_lease_until=null,updated_at=now()
   where feedback_id=job.id;
  update public.rise_feedback
   set status=case when job.attempts>=2 then 'escalated' else 'triaged' end,updated_at=now()
   where id=job.id and status in ('in_progress','fix_ready');
  insert into public.rise_autofix_events(feedback_id,attempt,phase,is_simulation)
   values (job.id,job.attempts,'repair_lease_expired',job.is_simulation);
 end loop;
end $$;
revoke all on function rise_private.feedback_recover_repairs(uuid) from public,anon,authenticated,service_role;

create or replace function public.rise_feedback_submission_ready()
returns boolean language sql stable security definer set search_path='' as $$
 select exists (
  select 1 from auth.users u join public.rise_profiles p on p.id=u.id
  where u.id=auth.uid() and u.email_confirmed_at is not null
 );
$$;
revoke all on function public.rise_feedback_submission_ready() from public,anon,authenticated;
grant execute on function public.rise_feedback_submission_ready() to authenticated;

create or replace function public.rise_feedback_get_repair_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not rise_private.feedback_is_admin() then
  raise exception 'rise:僅已驗證的管理員可以查看修正設定。' using errcode='42501';
 end if;
 return jsonb_build_object('enabled',coalesce(
  (select enabled from rise_private.feedback_repair_settings where singleton),false));
end $$;
revoke all on function public.rise_feedback_get_repair_settings() from public,anon,authenticated;
grant execute on function public.rise_feedback_get_repair_settings() to authenticated;

create or replace function public.rise_feedback_set_repair_settings(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare settings rise_private.feedback_repair_settings;
begin
 if not rise_private.feedback_is_admin() then
  raise exception 'rise:僅已驗證的管理員可以更新修正設定。' using errcode='42501';
 end if;
 if p_enabled is null then raise exception 'rise:請指定修正開關。';end if;
 select * into strict settings from rise_private.feedback_repair_settings where singleton for update;
 if settings.enabled is distinct from p_enabled then
  update rise_private.feedback_repair_settings
   set enabled=p_enabled,epoch=gen_random_uuid() where singleton returning * into settings;
  perform rise_private.feedback_recover_repairs(settings.epoch);
 end if;
 return jsonb_build_object('enabled',settings.enabled);
end $$;
revoke all on function public.rise_feedback_set_repair_settings(boolean) from public,anon,authenticated;
grant execute on function public.rise_feedback_set_repair_settings(boolean) to authenticated;

create or replace function public.rise_feedback_repair_authorize(p_feedback uuid,p_link_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.rise_feedback;a public.rise_autofix_cases;label text:=btrim(coalesce(p_link_text,''));
begin
 if not rise_private.feedback_is_admin() then
  raise exception 'rise:僅已驗證的管理員可以授權修正。' using errcode='42501';
 end if;
 if char_length(label) not between 1 and 160 or label ~ '[[:cntrl:]]' then
  raise exception 'rise:請輸入 1 到 160 字的連結文字。';
 end if;
 perform 1 from rise_private.feedback_repair_settings where singleton for update;
 if not found then raise exception 'rise:目前無法設定修正授權。';end if;
 select * into f from public.rise_feedback where id=p_feedback for update;
 if not found or not rise_private.feedback_repair_eligible(f) or f.status not in ('new','triaged') then
  raise exception 'rise:這則回報不符合逐案授權條件。';
 end if;
 select * into a from public.rise_autofix_cases where feedback_id=p_feedback for update;
 if found and (a.attempts>=2 or a.state in ('attempting','published','verified')) then
  raise exception 'rise:這則回報目前無法再次授權。';
 end if;
 if a."authorization" is not null then
  if a.link_text<>label then raise exception 'rise:請先撤回原有授權，再變更連結文字。';end if;
  return jsonb_build_object('authorization',a."authorization",'link_text',a.link_text);
 end if;
 insert into public.rise_autofix_cases (feedback_id,link_text,"authorization",authorized_by,authorized_at)
  values (p_feedback,label,gen_random_uuid(),auth.uid(),now())
 on conflict (feedback_id) do update set
  state=case when rise_autofix_cases.attempts=0 then 'queued' else 'attempt_failed' end,
  link_text=excluded.link_text,"authorization"=excluded."authorization",authorized_by=excluded.authorized_by,
  authorized_at=excluded.authorized_at,branch='',commit_sha='',workflow_run_url=null,workflow_patch_name=null,stop_reason='',
  repair_epoch=null,repair_lease_until=null,updated_at=now()
 returning * into a;
 update public.rise_feedback set status='triaged',triaged_by=auth.uid(),updated_at=now() where id=p_feedback;
 insert into public.rise_autofix_events(feedback_id,attempt,phase,result)
  values (p_feedback,a.attempts,'repair_authorized',jsonb_build_object('actor',auth.uid()));
 return jsonb_build_object('authorization',a."authorization",'link_text',a.link_text);
end $$;
revoke all on function public.rise_feedback_repair_authorize(uuid,text) from public,anon,authenticated;
grant execute on function public.rise_feedback_repair_authorize(uuid,text) to authenticated;

-- Call with the settings and report row already locked.
create or replace function rise_private.feedback_clear_repair_authorization(p_feedback uuid,p_retriage boolean)
returns boolean language plpgsql set search_path='' as $$
declare a public.rise_autofix_cases;
begin
 update public.rise_autofix_cases
  set "authorization"=null,authorized_by=null,authorized_at=null,repair_epoch=null,repair_lease_until=null,
      state=case
        when state not in ('queued','attempt_failed','attempting','fix_ready') then state
        when attempts>=2 then 'escalated'
        when attempts=0 then 'queued'
        else 'attempt_failed' end,
      stop_reason='authorization_revoked',updated_at=now()
  where feedback_id=p_feedback and "authorization" is not null returning * into a;
 if not found then return false;end if;
 if p_retriage then
  update public.rise_feedback
   set status=case when a.attempts>=2 then 'escalated' else 'triaged' end,updated_at=now()
   where id=p_feedback and status in ('in_progress','fix_ready');
 end if;
 insert into public.rise_autofix_events(feedback_id,attempt,phase,result,is_simulation)
  values (p_feedback,a.attempts,'repair_authorization_revoked',jsonb_build_object('actor',auth.uid()),a.is_simulation);
 return true;
end $$;
revoke all on function rise_private.feedback_clear_repair_authorization(uuid,boolean)
 from public,anon,authenticated,service_role;

create or replace function public.rise_feedback_repair_revoke(p_feedback uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not rise_private.feedback_is_admin() then
  raise exception 'rise:僅已驗證的管理員可以撤回修正授權。' using errcode='42501';
 end if;
 perform 1 from rise_private.feedback_repair_settings where singleton for update;
 if not found then raise exception 'rise:目前無法設定修正授權。';end if;
 perform 1 from public.rise_feedback where id=p_feedback for update;
 if not found then raise exception 'rise:找不到這則回報。';end if;
 return jsonb_build_object('revoked',rise_private.feedback_clear_repair_authorization(p_feedback,true));
end $$;
revoke all on function public.rise_feedback_repair_revoke(uuid) from public,anon,authenticated;
grant execute on function public.rise_feedback_repair_revoke(uuid) to authenticated;

create or replace function public.rise_admin_triage_feedback(p_id uuid,p_status text,p_priority text,p_admin_note text,p_public_reply text,p_duplicate_of uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare old public.rise_feedback;a public.rise_autofix_cases;
begin
 if not rise_private.feedback_is_admin() then
  raise exception 'rise:僅已驗證的管理員可以處理回報。' using errcode='42501';
 end if;
 if p_priority is null or p_priority not in ('low','normal','high') then raise exception 'rise:優先順序不正確。';end if;
 if char_length(coalesce(p_admin_note,''))>2000 or char_length(coalesce(p_public_reply,''))>1000 then
  raise exception 'rise:備註或回覆過長。';
 end if;
 perform 1 from rise_private.feedback_repair_settings where singleton for update;
 if not found then raise exception 'rise:目前無法更新回報。';end if;
 select * into old from public.rise_feedback where id=p_id for update;
 if not found then raise exception 'rise:找不到這則回報。';end if;
 if p_status is null or (p_status<>old.status and
    p_status not in ('new','triaged','in_progress','needs_info','escalated','resolved','wontfix','duplicate')) then
  raise exception 'rise:狀態不正確。';
 end if;
 if p_status='duplicate' and (p_duplicate_of is null or p_duplicate_of=p_id or
    not exists(select 1 from public.rise_feedback where id=p_duplicate_of)) then
  raise exception 'rise:標記重複時請指定另一則存在的回報。';
 end if;
 select * into a from public.rise_autofix_cases where feedback_id=p_id for update;
 if a."authorization" is not null and not (
     (a.state in ('queued','attempt_failed') and p_status in ('new','triaged'))
     or (a.state='attempting' and p_status='in_progress')
     or (a.state='fix_ready' and p_status='fix_ready')) then
  perform rise_private.feedback_clear_repair_authorization(p_id,false);
 end if;
 update public.rise_feedback
  set status=p_status,priority=p_priority,admin_note=coalesce(p_admin_note,''),public_reply=coalesce(p_public_reply,''),
      duplicate_of=case when p_status='duplicate' then p_duplicate_of else null end,triaged_by=auth.uid(),updated_at=now()
  where id=p_id;
 insert into public.rise_feedback_events(feedback_id,actor_id,changes)
  values(p_id,auth.uid(),jsonb_build_object(
   'from',jsonb_build_object('status',old.status,'priority',old.priority),
   'to',jsonb_build_object('status',p_status,'priority',p_priority)));
end $$;
revoke all on function public.rise_admin_triage_feedback(uuid,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.rise_admin_triage_feedback(uuid,text,text,text,text,uuid) to authenticated;

create or replace function public.rise_feedback_repair_worker(p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 settings rise_private.feedback_repair_settings;
 f public.rise_feedback;
 a public.rise_autofix_cases;
 result jsonb;
 attempt integer;
 waiting boolean;
 active boolean;
 ready boolean;
 branch_name text:=p_payload->>'branch';
 outcome text:=p_payload->>'outcome';
 run_url text:=p_payload->>'url';
 patch_name text:=p_payload->>'filename';
begin
 if p_action is null or p_action not in ('candidates','check','begin','log','finish','deliver') then
  raise exception 'rise:repair-action-invalid';
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536 then
  raise exception 'rise:repair-payload-invalid';
 end if;
 select * into settings from rise_private.feedback_repair_settings where singleton for update;
 if not found or not settings.enabled then
  if p_action='candidates' then return '[]'::jsonb;end if;
  if p_action='check' then return 'false'::jsonb;end if;
  raise exception 'rise:repair-disabled';
 end if;
 if p_action='candidates' then
  perform rise_private.feedback_recover_repairs(settings.epoch);
  select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate.case_no),'[]'::jsonb) into result
  from (
   select report.id as feedback_id,report.case_no,report.kind,report.page,
          repair.attempts,repair.link_text,repair."authorization",settings.epoch
   from public.rise_feedback report join public.rise_autofix_cases repair on repair.feedback_id=report.id
   where rise_private.feedback_repair_eligible(report) and report.status in ('new','triaged')
     and repair.state in ('queued','attempt_failed') and repair.attempts<2 and repair."authorization" is not null
     and repair.link_text is not null
   order by report.created_at,report.id limit 50
  ) candidate;
  return result;
 end if;

 if p_payload->>'epoch' is distinct from settings.epoch::text or
    coalesce(p_payload->>'id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
  if p_action='check' then return 'false'::jsonb;end if;
  raise exception 'rise:repair-authorization-inactive';
 end if;
 select * into f from public.rise_feedback where id=(p_payload->>'id')::uuid for update;
 select * into a from public.rise_autofix_cases where feedback_id=f.id for update;
 if not found or not rise_private.feedback_repair_eligible(f) or
    a."authorization" is null or a."authorization"::text is distinct from p_payload->>'authorization' then
  if p_action='check' then return 'false'::jsonb;end if;
  raise exception 'rise:repair-authorization-inactive';
 end if;
 if p_payload ? 'attempt' and coalesce(p_payload->>'attempt','') !~ '^[012]$' then
  raise exception 'rise:repair-attempt-invalid';
 end if;
 attempt:=coalesce((p_payload->>'attempt')::integer,0);
 waiting:=a.state in ('queued','attempt_failed') and a.attempts<2 and f.status in ('new','triaged');
 active:=a.state='attempting' and f.status='in_progress' and a.repair_epoch is not distinct from settings.epoch
    and coalesce(a.repair_lease_until>clock_timestamp(),false);
 ready:=a.state='fix_ready' and f.status='fix_ready' and a.repair_epoch is not distinct from settings.epoch
    and (a.workflow_run_url is not null or coalesce(a.repair_lease_until>clock_timestamp(),false));

 if p_action='check' then
  return to_jsonb(case when attempt=0 then waiting or active or ready
                       else (active or ready) and attempt=a.attempts end);
 elsif p_action='begin' and waiting then
  if coalesce(branch_name,'') !~ '^autofix/repair-[0-9a-f]{24}$' then raise exception 'rise:repair-branch-invalid';end if;
  attempt:=public.rise_autofix_begin_attempt(f.id,branch_name,false);
  update public.rise_autofix_cases set repair_epoch=settings.epoch,repair_lease_until=clock_timestamp()+interval '20 minutes'
   where feedback_id=f.id;
  return to_jsonb(attempt);
 elsif p_action='log' and ((waiting and attempt=0) or (active and attempt=a.attempts)) then
  if coalesce(char_length(p_payload->>'phase'),0) not between 1 and 40 or
     coalesce(jsonb_typeof(p_payload->'result'),'object')<>'object' then
   raise exception 'rise:repair-payload-invalid';
  end if;
  perform public.rise_autofix_log(f.id,attempt,p_payload->>'phase',p_payload->'result');
  return 'null'::jsonb;
 elsif p_action='finish' and ((waiting and attempt=0 and outcome in ('escalate','needs_info')) or (active and attempt=a.attempts)) then
  if coalesce(jsonb_typeof(p_payload->'payload'),'object')<>'object' or
     outcome is null or outcome not in ('fix_ready','attempt_failed','escalate','needs_info') then
   raise exception 'rise:repair-payload-invalid';
  end if;
  if outcome='fix_ready' and (a.branch is distinct from p_payload->'payload'->>'branch' or
     coalesce(p_payload->'payload'->>'commit','') !~ '^[0-9a-f]{40}$') then
   raise exception 'rise:repair-proposal-invalid';
  end if;
  outcome:=public.rise_autofix_finish(f.id,outcome,coalesce(p_payload->'payload','{}'::jsonb));
  update public.rise_autofix_cases
   set repair_lease_until=case when outcome='fix_ready' then clock_timestamp()+interval '20 minutes' else null end,
       repair_epoch=case when outcome='fix_ready' then settings.epoch else null end
   where feedback_id=f.id;
  return to_jsonb(outcome);
 elsif p_action='deliver' and ready then
  if a.branch is distinct from branch_name or a.commit_sha is distinct from p_payload->>'commit' or
     coalesce(run_url,'') !~ '^https://github[.]com/youtingyeh/RISE/actions/runs/[1-9][0-9]{0,19}$' or
     coalesce(patch_name,'') !~ '^fix-[0-9]{2}[.]patch$' or
     (a.workflow_run_url is not null and (a.workflow_run_url<>run_url or a.workflow_patch_name is distinct from patch_name)) then
   raise exception 'rise:repair-delivery-invalid';
  end if;
  if a.workflow_run_url is null then
   update public.rise_autofix_cases
    set workflow_run_url=run_url,workflow_patch_name=patch_name,repair_lease_until=null,updated_at=now()
    where feedback_id=f.id;
   insert into public.rise_autofix_events(feedback_id,attempt,phase,result,is_simulation)
    values (f.id,a.attempts,'repair_artifact_delivered',jsonb_build_object('url',run_url,'filename',patch_name),a.is_simulation);
  end if;
  return 'true'::jsonb;
 end if;
 raise exception 'rise:repair-state-inactive';
end $$;
revoke all on function public.rise_feedback_repair_worker(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.rise_feedback_repair_worker(text,jsonb) to service_role;

-- Only the gated worker can use the old implementation helpers. The old
-- publisher and site verification jobs also lose execution privileges.
revoke all on function
 public.rise_autofix_candidates(),
 public.rise_autofix_begin_attempt(uuid,text,boolean),
 public.rise_autofix_log(uuid,integer,text,jsonb),
 public.rise_autofix_finish(uuid,text,jsonb),
 public.rise_autofix_approved(),
 public.rise_autofix_mark_published(uuid,text),
 public.rise_autofix_awaiting_verification(),
 public.rise_autofix_mark_verified(uuid,boolean,jsonb),
 public.rise_admin_autofix_decide(uuid,text,boolean,text)
 from public,anon,authenticated,service_role;
revoke all on public.rise_autofix_cases,public.rise_autofix_events from service_role;

notify pgrst,'reload schema';
commit;

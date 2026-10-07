-- Read-only checks after security-hardening.sql. Does not reveal user records or keys.
-- Result 1: all rows should have rls_enabled=true.
select n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('r','p') and (n.nspname in ('rise_private','rise_work','rise_program') or (n.nspname='public' and c.relname like 'rise\_%' escape '\'))
order by 1,2;
-- Result 2: should return NO ROWS (no PUBLIC execution of privileged RISE functions).
select n.nspname,p.proname
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where p.prosecdef and (n.nspname in ('rise_private','rise_work','rise_program') or (n.nspname='public' and p.proname like 'rise\_%' escape '\'))
and exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE');
-- Result 3: all rows should have public=false.
select id,public from storage.buckets where id in ('rise-credentials','rise-question-images','rise-teaching-files','rise-work-files');
-- Result 4: both values should be true.
select to_regprocedure('public.rise_prepare_account_delete()') is not null as safe_delete_installed,
       to_regprocedure('public.rise_question_timeline(uuid,integer)') is not null as timeline_installed;

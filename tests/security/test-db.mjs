import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const pg=new PGlite();
await pg.exec(`create role service_role bypassrls;create role anon;create role authenticated;create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',created_at timestamptz default now(),last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text);
create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
alter table storage.objects enable row level security;grant usage on schema auth,storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
for(const file of ['setup','staff-upgrade','google-drive','qa-upgrade','teaching-resources','resource-placement','watch-history','review-mail','course-assignments','training-course-management','teacher-course-access','discussions','video-management','question-advisor','program-upgrade','program-refinement','admin-console','security-hardening','security-hardening']){
 try{await pg.exec(await readFile(new URL('../../backend/'+file+'.sql',import.meta.url),'utf8'));}catch(e){console.error('Migration failed: '+file);throw e;}
}
const ids=Object.fromEntries(['student','other','ta','teacher','admin','admin2','unverified','orphan'].map((k,i)=>[k,'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0')]));
for(const [key,id] of Object.entries(ids)){
 await pg.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)',[id,key+'@example.invalid',key==='unverified'?null:new Date().toISOString()]);
 await pg.query('update public.rise_profiles set role=$2 where id=$1',[id,['ta','teacher','admin','admin2'].includes(key)?key==='admin2'?'admin':key:'student']);
}
await pg.query('delete from public.rise_profiles where id=$1',[ids.orphan]);
async function as(key,fn){await pg.query("select set_config('app.uid',$1,false)",[ids[key]||'']);await pg.exec('set role '+(key?'authenticated':'anon'));try{return await fn();}finally{await pg.exec('reset role');}}
const rpc=(key,name,args=[])=>as(key,async()=>(await pg.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as data',args)).rows[0].data);
const raw=(key,sql,args=[])=>as(key,()=>pg.query(sql,args));
const tables=(await pg.query("select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname in ('rise_private','rise_work','rise_program') or (n.nspname='public' and c.relname like 'rise_%'))")).rows;
assert(tables.length>35);assert(tables.every(t=>t.relrowsecurity));
for(const table of tables.filter(t=>t.nspname!=='public'))await assert.rejects(()=>raw('student','select * from '+table.nspname+'.'+table.relname),/permission denied/);
const definerLeaks=(await pg.query("select n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and (n.nspname like 'rise_%' or (n.nspname='public' and p.proname like 'rise_%')) and exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')")).rows;
assert.deepEqual(definerLeaks,[]);
assert((await pg.query("select public from storage.buckets where id like 'rise-%'")).rows.every(b=>b.public===false));
const path=ids.student+'/proof.pdf';await raw('student',"insert into storage.objects(bucket_id,name) values('rise-credentials',$1)",[path]);
assert.equal((await raw('other',"select * from storage.objects where bucket_id='rise-credentials'")).rows.length,0);
assert.equal((await raw('teacher',"select * from storage.objects where bucket_id='rise-credentials'")).rows.length,0);
assert.equal((await raw('admin',"select * from storage.objects where bucket_id='rise-credentials'")).rows.length,1);
await assert.rejects(()=>raw('other',"insert into storage.objects(bucket_id,name) values('rise-credentials',$1)",[path]),/row-level security/);
for(const role of ['admin','unverified','orphan',null])await assert.rejects(()=>rpc(role,'rise_prepare_account_delete'));
for(const role of ['admin','unverified','orphan',null])await assert.rejects(()=>rpc(role,'rise_delete_my_account'));
await assert.rejects(()=>rpc('student','rise_delete_my_account'),/確認並開始/);
const question=crypto.randomUUID();await rpc('student','rise_submit_question',[question,'chemistry','A question','Reasoning',[]]);
assert.equal((await raw('other','select * from public.rise_question_versions')).rows.length,0);
await assert.rejects(()=>raw('student',"insert into public.rise_questions(user_id,subject,title,body) values($1,'math','bypass','body')",[ids.student]),/permission denied/);
await assert.rejects(()=>rpc('student','rise_review_question',[question,1,'a','b','c']),/教學人員/);
await assert.rejects(()=>rpc('ta','rise_review_question',[question,1,'a','','c']),/思路分析/);
await rpc('ta','rise_review_question',[question,1,'analysis','improvement','followup']);
await rpc('student','rise_answer_question',[question,'More evidence']);
const timeline=await rpc('student','rise_question_timeline',[question]);assert(timeline.items.some(x=>x.kind==='reply'&&x.author_role==='student'&&x.version===1));
await assert.rejects(()=>rpc('other','rise_question_timeline',[question]),/無權/);
await rpc('student','rise_prepare_account_delete');
await rpc('student','rise_cancel_account_delete');
assert.equal(await as('student',async()=>(await pg.query('select rise_private.account_upload_open() as allowed')).rows[0].allowed),true);
await rpc('student','rise_prepare_account_delete');
await assert.rejects(()=>raw('student',"insert into storage.objects(bucket_id,name) values('rise-credentials',$1)",[ids.student+'/late.pdf']),/row-level security/);
await assert.rejects(()=>rpc('admin','rise_admin_set_role',[ids.student,'admin','student']),/刪除流程/);
await assert.rejects(()=>rpc('student','rise_delete_my_account'),/附件尚未/);
await assert.rejects(()=>rpc('admin','rise_admin_delete_member',[ids.student,'student']),/Storage API/);
assert.equal((await pg.query('select count(*)::int n from auth.users where id=$1',[ids.student])).rows[0].n,1);
// Simulates metadata removal AFTER the real Storage API deleted the blob, not production SQL cleanup.
await raw('student',"delete from storage.objects where bucket_id='rise-credentials' and name=$1",[path]);
await pg.query("insert into storage.objects(bucket_id,name) values('rise-work-files',$1)",[ids.student+'/work.pdf']);
await raw('student',"delete from storage.objects where bucket_id='rise-work-files' and name=$1",[ids.student+'/work.pdf']);
assert.equal((await pg.query('select count(*)::int n from storage.objects')).rows[0].n,0);
await pg.query("insert into public.rise_drive_files(id,user_id,drive_id,original_name,mime_type,bytes,status) values($1,$2,'drive1','proof.pdf','application/pdf',10,'ready')",[crypto.randomUUID(),ids.student]);
await assert.rejects(()=>rpc('student','rise_delete_my_account'),/Google Drive/);
await pg.query('delete from public.rise_drive_files where user_id=$1',[ids.student]);
// A failing cascade rolls back deletion of Auth, profile and question rows together.
await pg.exec("create table public.test_delete_block(user_id uuid references auth.users(id) on delete restrict)");await pg.query('insert into public.test_delete_block values($1)',[ids.student]);
await assert.rejects(()=>rpc('student','rise_delete_my_account'),/foreign key/);
assert.equal((await pg.query('select count(*)::int n from public.rise_questions where id=$1',[question])).rows[0].n,1);
await pg.exec('drop table public.test_delete_block');
assert.equal(await rpc('student','rise_delete_my_account'),true);
assert.equal((await pg.query('select count(*)::int n from auth.users where id=$1',[ids.student])).rows[0].n,0);
assert.equal((await pg.query('select count(*)::int n from public.rise_question_versions where question_id=$1',[question])).rows[0].n,0);
assert.equal((await pg.query('select count(*)::int n from auth.users where id=$1',[ids.other])).rows[0].n,1);
await assert.rejects(()=>rpc('other','rise_admin_update_member',[ids.admin,'bad','admin']),/僅限/);
await rpc('admin','rise_admin_update_member',[ids.other,'New name','RISE 使用者']);
assert.equal((await rpc('admin','rise_admin_members',['New name','all',0])).items[0].display_name,'New name');
await assert.rejects(()=>rpc('admin','rise_admin_delete_member',[ids.admin,'admin']),/目前登入/);
await rpc('admin','rise_admin_delete_member',[ids.other,'student']);
console.log('PASS all migrations, '+tables.length+' RLS tables, private-schema grants, no PUBLIC definer execution, credentials isolation, required feedback, timeline, self-deletion guards/cascade rollback, admin RPCs.');
await pg.close();

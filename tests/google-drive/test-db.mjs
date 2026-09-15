import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
const db=new PGlite();
await db.exec(`create role service_role bypassrls; create role anon; create role authenticated; create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,storage,public to authenticated;
grant execute on function auth.uid() to authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant select,insert,delete on storage.objects to authenticated;
create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
await db.exec(fs.readFileSync('../../backend/setup.sql','utf8'));
const migration=fs.readFileSync('../../backend/staff-upgrade.sql','utf8');await db.exec(migration);await db.exec(migration);
const driveMigration=fs.readFileSync('../../backend/google-drive.sql','utf8');await db.exec(driveMigration);await db.exec(driveMigration);
const ids=[1,2,3,4].map(n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0'));
for(const [i,id]of ids.entries())await db.query(`insert into auth.users values($1,$2,now(),$3)`,[id,`person${i}@example.org`,JSON.stringify({requested_kind:i===1?'ta':'teacher'})]);
await db.query("update public.rise_profiles set role='admin' where id=$1",[ids[0]]);
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[i]]);await db.exec('set role authenticated');}
async function denied(sql,args){try{await db.query(sql,args);throw new Error('UNEXPECTED ALLOW');}catch(e){if(e.message==='UNEXPECTED ALLOW')throw e;}}
await as(1);
await db.query("insert into storage.objects(bucket_id,name) values('rise-credentials',$1)",[ids[1]+'/proof.pdf']);
await denied("insert into storage.objects(bucket_id,name) values('rise-credentials',$1)",[ids[2]+'/proof.pdf']);
await denied("select public.rise_submit_teacher_application('s','math','r',0)",[]);
const submit="select public.rise_submit_staff_application('s','math','r',0,$1,$2) as id";
await denied(submit,['admin',JSON.stringify([{path:ids[1]+'/proof.pdf',name:'proof.pdf'}])]);
const result=await db.query(submit,['ta',JSON.stringify([{path:ids[1]+'/proof.pdf',name:'proof.pdf'}])]);const aid=result.rows[0].id;
await denied("select public.rise_review_teacher_application($1,'approved','',1)",[aid]);
await as(0);await db.query("select public.rise_review_teacher_application($1,'approved','',1)",[aid]);
await as(1);const role=(await db.query('select role from public.rise_profiles where id=auth.uid()')).rows[0].role;if(role!=='ta')throw Error(role);
await as(2);let q=(await db.query("insert into public.rise_questions(user_id,subject,title,body) values(auth.uid(),'math','Title','Body') returning id")).rows[0].id;
await as(3);if((await db.query('select * from public.rise_questions')).rows.length)throw Error('student reads peer');
await denied("select public.rise_answer_question($1,'bad')",[q]);
if((await db.query("select * from storage.objects where bucket_id='rise-credentials'")).rows.length)throw Error('peer evidence leak');
await as(1);if((await db.query('select * from public.rise_questions')).rows.length!==1)throw Error('TA cannot read');await db.query("select public.rise_answer_question($1,'Explanation')",[q]);
await as(2);await db.query("select public.rise_answer_question($1,'Follow up')",[q]);if((await db.query('select * from public.rise_answers')).rows.length!==2)throw Error('thread missing');
await db.exec('reset role');await db.query("update public.rise_profiles set role='student' where id=$1",[ids[1]]);await as(1);await denied("select public.rise_answer_question($1,'revoked')",[q]);

// Drive attachment checks use ordinary user permissions; credentials never come from the browser.
await db.exec('reset role');
const fileId='10000000-0000-0000-0000-000000000001';
await db.query("select public.rise_drive_reserve($1,$2,'drive-file-id','proof.pdf','application/pdf',123)",[ids[3],fileId]);
await as(3);
await denied("select public.rise_drive_reserve($1,$2,'forged','proof.pdf','application/pdf',123)",[ids[3],'10000000-0000-0000-0000-000000000002']);
await denied("select * from public.rise_drive_files",[]);
await denied("select public.rise_drive_prepare_delete()",[]); // active pending upload
await denied(submit,['teacher',JSON.stringify([{provider:'google-drive',path:fileId,name:'proof.pdf'}])]);
await db.exec('reset role');await db.query("update public.rise_drive_files set status='ready' where id=$1",[fileId]);
await as(2);await denied(submit,['teacher',JSON.stringify([{provider:'google-drive',path:fileId,name:'proof.pdf'}])]);
await as(3);await db.query(submit,['teacher',JSON.stringify([{provider:'google-drive',path:fileId,name:'proof.pdf'}])]);
const hasFiles=await db.query("select public.rise_drive_prepare_delete() as present");if(!hasFiles.rows[0].present)throw Error('Missing files');
await db.exec('reset role');
await denied("select public.rise_drive_reserve($1,$2,'new-drive-file','proof.pdf','application/pdf',123)",[ids[3],'10000000-0000-0000-0000-000000000002']);
await denied("delete from auth.users where id=$1",[ids[3]]); // cannot orphan files
await db.query('delete from public.rise_drive_files where user_id=$1',[ids[3]]);
await db.query('delete from auth.users where id=$1',[ids[3]]);
console.log('PASS: staff/QA regression, repeat Drive migration, forged file and cross-user submission denied, pending upload/deletion lock, orphan prevention');
await db.close();

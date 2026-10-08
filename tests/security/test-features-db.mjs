import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const pg=new PGlite();
await pg.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
create table public.rise_profiles(id uuid primary key references auth.users(id),role text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;`);
const sql=await readFile(new URL('../../backend/site-features.sql',import.meta.url),'utf8');
await pg.exec(sql);await pg.exec(sql);
const users={};for(const [i,role] of ['student','teacher','ta','admin','unverified'].entries()){
 const id='00000000-0000-4000-8000-'+String(i+1).padStart(12,'0');users[role]=id;
 await pg.query('insert into auth.users values($1,$2)',[id,role==='unverified'?null:new Date().toISOString()]);
 await pg.query('insert into rise_profiles values($1,$2)',[id,role==='unverified'?'admin':role]);
}
async function as(role,fn){await pg.query("select set_config('app.uid',$1,false)",[users[role]||'']);await pg.exec('set role '+(role?'authenticated':'anon'));try{return await fn();}finally{await pg.exec('reset role');}}
const get=role=>as(role,async()=>(await pg.query('select public.rise_site_features() data')).rows[0].data);
const set=(role,changes,version)=>as(role,async()=>(await pg.query('select public.rise_set_site_features($1,$2) data',[changes,version])).rows[0].data);
const initial=await get(null);assert.equal(initial.is_admin,false);assert.equal(Object.keys(initial.flags).length,16);assert(Object.values(initial.flags).every(Boolean));
for(const role of ['student','teacher','ta','unverified',null]){
 assert.equal((await get(role)).is_admin,false);
 await assert.rejects(()=>set(role,{competitions:false},1));
 await assert.rejects(()=>as(role,()=>pg.query('select * from rise_private.site_features')));
}
assert.equal((await get('admin')).is_admin,true);
await assert.rejects(()=>set('admin',{admin_console:false},1),/未知/);
await assert.rejects(()=>set('admin',{questions:'false'},1),/格式/);
await assert.rejects(()=>set('admin',[],1),/開關/);
await assert.rejects(()=>set('admin',{},1),/開關/);
const changed=await set('admin',{competitions:false,yearbook:false},1);assert.equal(changed.version,2);assert.equal(changed.flags.competitions,false);
await assert.rejects(()=>set('admin',{questions:false},1),/其他管理員/);
assert.equal((await get(null)).flags.questions,true);
await pg.exec(sql);assert.equal((await get(null)).flags.competitions,false); // Repeat migration must not reset switches.
assert.equal((await set('admin',{competitions:false},2)).version,2); // No-op is not a fake audit event.
const events=(await pg.query('select * from rise_private.site_feature_events')).rows;
assert.equal(events.length,1);assert.equal(events[0].actor_id,users.admin);
assert.equal((await pg.query("select relrowsecurity from pg_class where relname='site_features'")).rows[0].relrowsecurity,true);
await pg.query("update rise_profiles set role='student' where id=$1",[users.admin]);
await assert.rejects(()=>set('admin',{competitions:true},2));assert.equal((await get('admin')).is_admin,false);
await pg.close();console.log('PASS feature SQL: defaults, repeated migration preserves settings, verified-admin-only changes, private tables/audit, validation, stale-write conflict, role revocation.');

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const pg = new PGlite();
const migration = async name => pg.exec(await readFile(new URL('../../backend/'+name+'.sql',import.meta.url),'utf8'));
await pg.exec(
 "create role anon;create role authenticated;create role service_role;create schema auth;"+
 "create table auth.users(id uuid primary key,email_confirmed_at timestamptz);"+
 "create table public.rise_profiles(id uuid primary key references auth.users(id),role text,display_name text);"+
 "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;"
);
for (const name of ['feedback','feedback-autofix','feedback-controls','feedback-controls']) await migration(name);

const ids = {
 student:'00000000-0000-4000-8000-000000000001',
 admin:'00000000-0000-4000-8000-000000000002',
 unverified:'00000000-0000-4000-8000-000000000003',
 orphan:'00000000-0000-4000-8000-000000000004'
};
for (const [role,id] of Object.entries(ids)) {
 await pg.query('insert into auth.users values($1,$2)',[id,role==='unverified'?null:new Date()]);
 if (role!=='orphan') await pg.query('insert into rise_profiles values($1,$2,$3)',[id,role==='student'?role:'admin',role]);
}

async function queryAs(role,sql,args=[]) {
 await pg.query("select set_config('app.uid',$1,false)",[ids[role]||'']);
 await pg.exec('set role '+(role==='service_role'||role==='anon'?role:'authenticated'));
 try {return (await pg.query(sql,args)).rows;}
 finally {await pg.exec('reset role');}
}
const rpc = async (role,name,...args) => {
 const placeholders = args.map((_,i)=>'$'+(i+1)).join(',');
 return (await queryAs(role,'select public.'+name+'('+placeholders+') value',args))[0].value;
};
const worker = (action,payload={}) => rpc('service_role','rise_feedback_repair_worker',action,payload);
const authorize = (id,text='首頁') => rpc('admin','rise_feedback_repair_authorize',id,text);
const settings = () => rpc('admin','rise_feedback_get_repair_settings');
const toggle = enabled => rpc('admin','rise_feedback_set_repair_settings',enabled);
const state = async id => (await pg.query(
 'select f.status,a.* from rise_feedback f join rise_autofix_cases a on a.feedback_id=f.id where f.id=$1',[id]
)).rows[0];
const triage = (id,status,note='',reply='') => rpc('admin','rise_admin_triage_feedback',id,status,'normal',note,reply);
const submit = (title,page='join.html',kind='bug') => rpc('student','rise_submit_feedback',kind,page,title,
 '頁面的連結沒有反應，測試：'+title,'開啟頁面後點連結','開啟指定頁面','找不到頁面','');
const request = ({feedback_id,authorization,epoch}) => ({id:feedback_id,authorization,epoch});
const branch = 'autofix/repair-'+'a'.repeat(24);
const commit = 'b'.repeat(40);
const runUrl = 'https://github.com/youtingyeh/RISE/actions/runs/123';
const filename = 'fix-01.patch';

assert.deepEqual(await settings(),{enabled:false});
assert.equal(await rpc('student','rise_feedback_submission_ready'),true);
assert.equal(await rpc('unverified','rise_feedback_submission_ready'),false);
assert.equal(await rpc('orphan','rise_feedback_submission_ready'),false);
await assert.rejects(()=>rpc('anon','rise_feedback_submission_ready'),/permission denied/);
await assert.rejects(()=>rpc('student','rise_feedback_set_repair_settings',true),/僅已驗證的管理員/);
await assert.rejects(()=>rpc('unverified','rise_feedback_get_repair_settings'),/僅已驗證的管理員/);
await assert.rejects(()=>rpc('admin','rise_feedback_repair_worker','candidates'),/permission denied/);
for (const fn of ['rise_autofix_candidates','rise_autofix_approved','rise_autofix_awaiting_verification']) {
 await assert.rejects(()=>rpc('service_role',fn),/permission denied/);
}
await assert.rejects(()=>queryAs('service_role','select * from rise_autofix_cases'),/permission denied/);

const repair = await submit('已核准的測試回報');
const waiting = await submit('尚未核准的測試回報');
const urgent = await submit('疑似安全', 'join.html','security');
const wrongPage = await submit('其他頁面的連結','math.html');
const closed = await submit('已結案的測試回報');
await triage(closed.id,'resolved');
await assert.rejects(()=>authorize(urgent.id),/不符合/);
await assert.rejects(()=>authorize(wrongPage.id),/不符合/);
await assert.rejects(()=>authorize(closed.id),/不符合/);
await assert.rejects(()=>rpc('student','rise_feedback_repair_authorize',repair.id,'首頁'),/僅已驗證的管理員/);
await assert.rejects(()=>rpc('unverified','rise_feedback_repair_authorize',repair.id,'首頁'),/僅已驗證的管理員/);
await assert.rejects(()=>authorize(repair.id,'  '),/連結文字/);

const grant = await authorize(repair.id,' 首頁 ');
assert.equal(grant.link_text,'首頁');
assert.deepEqual(await authorize(repair.id),grant);
await assert.rejects(()=>authorize(repair.id,'其他連結'),/先撤回/);
assert.deepEqual(await worker('candidates'),[]);
assert.equal(await worker('check',{id:repair.id,authorization:grant.authorization}),false);
await assert.rejects(()=>worker('begin',{id:repair.id,branch}),/repair-disabled/);
assert.deepEqual(await toggle(true),{enabled:true});
const [first] = await worker('candidates');
assert.deepEqual(await worker('candidates'),[first]);
assert.deepEqual(Object.keys(first).sort(),['attempts','authorization','case_no','epoch','feedback_id','kind','link_text','page']);
assert.equal(first.feedback_id,repair.id);
assert.equal(first.authorization,grant.authorization);
assert.equal(first.attempts,0);
assert.equal(await worker('check',{...request(first),id:waiting.id}),false);
await assert.rejects(()=>worker('publish',request(first)),/repair-action-invalid/);
await assert.rejects(()=>worker('begin',{...request(first),branch:'not-a-repair-branch'}),/repair-branch-invalid/);
assert.equal(await worker('log',{...request(first),phase:'reproduced',result:{ok:true}}),null);
assert.equal(await worker('begin',{...request(first),branch}),1);
await assert.rejects(()=>worker('begin',{...request(first),branch}),/repair-state-inactive/);
await assert.rejects(()=>worker('finish',{...request(first),outcome:'attempt_failed'}),/repair-state-inactive/);

await toggle(false);
assert.deepEqual(await worker('candidates'),[]);
assert.equal(await worker('check',request(first)),false);
assert.equal((await state(repair.id)).attempts,1);
assert.equal((await state(repair.id)).state,'attempt_failed');
await toggle(true);
const [second] = await worker('candidates');
assert.notEqual(second.epoch,first.epoch);
assert.equal(second.authorization,first.authorization);
assert.equal(await worker('check',request(first)),false);
assert.equal(await worker('check',request(second)),true);
assert.equal(await worker('check',{...request(second),attempt:1}),false);
assert.equal(await worker('begin',{...request(second),branch}),2);
await worker('log',{...request(second),attempt:2,phase:'verified',result:{ok:true}});
assert.equal(await worker('finish',{...request(second),attempt:2,outcome:'fix_ready',payload:{branch,commit}}),'fix_ready');
assert.equal(await worker('check',{...request(second),attempt:2}),true);
const delivery = {...request(second),branch,commit,url:runUrl,filename};
await assert.rejects(()=>worker('deliver',{...delivery,url:'https://github.com/youtingyeh/RISE/pull/123'}),/repair-delivery-invalid/);
await assert.rejects(()=>worker('deliver',{...delivery,commit:'c'.repeat(40)}),/repair-delivery-invalid/);
await assert.rejects(()=>worker('deliver',{...delivery,filename:'fixture.patch'}),/repair-delivery-invalid/);
assert.equal(await worker('deliver',delivery),true);
assert.equal(await worker('deliver',delivery),true);
await assert.rejects(()=>worker('deliver',{...delivery,filename:'fix-02.patch'}),/repair-delivery-invalid/);
assert.equal((await state(repair.id)).workflow_run_url,runUrl);
assert.equal((await state(repair.id)).workflow_patch_name,filename);
await assert.rejects(()=>rpc('admin','rise_admin_autofix_decide',repair.id,'approve'),/permission denied/);
await assert.rejects(()=>rpc('service_role','rise_autofix_mark_published',repair.id,commit),/permission denied/);

await triage(repair.id,'fix_ready','review pending','we are reviewing');
const [adminRow] = (await rpc('admin','rise_admin_feedback','fix_ready'));
assert.equal(adminRow.autofix.authorization,grant.authorization);
assert.equal(adminRow.autofix.authorized_by,ids.admin);
assert.equal(adminRow.admin_note,'review pending');
assert.equal(adminRow.autofix.workflow_run_url,runUrl);
assert.equal(adminRow.autofix.workflow_patch_name,filename);
const myRow = (await queryAs('student','select * from public.rise_my_feedback()')).find(row=>row.id===repair.id);
assert.equal(myRow.status,'in_progress');
for (const column of ['authorization','authorized_by','workflow_run_url','workflow_patch_name','admin_note','triage_class']) {
 assert.equal(Object.hasOwn(myRow,column),false);
}
await triage(repair.id,'resolved','verified by human','fixed');
assert.equal(await worker('check',request(second)),false);
assert.equal((await state(repair.id)).authorization,null);
assert.equal((await state(repair.id)).status,'resolved');
await triage(repair.id,'triaged');
await assert.rejects(()=>authorize(repair.id),/目前無法再次授權/);
assert.equal((await state(repair.id)).attempts,2);

const firstGrant = await authorize(waiting.id);
let [pending] = await worker('candidates');
assert.equal(pending.feedback_id,waiting.id);
assert.equal(await worker('begin',{...request(pending),branch}),1);
assert.deepEqual(await rpc('admin','rise_feedback_repair_revoke',waiting.id),{revoked:true});
assert.equal(await worker('check',request(pending)),false);
assert.deepEqual(await rpc('admin','rise_feedback_repair_revoke',waiting.id),{revoked:false});
const regrant = await authorize(waiting.id);
assert.notEqual(regrant.authorization,firstGrant.authorization);
[pending] = await worker('candidates');
assert.equal(pending.attempts,1);
assert.equal(await worker('begin',{...request(pending),branch}),2);
await pg.query('update public.rise_autofix_cases set repair_lease_until=now()-interval \'1 minute\' where feedback_id=$1',[waiting.id]);
assert.equal(await worker('check',request(pending)),false);
assert.deepEqual(await worker('candidates'),[]);
assert.equal((await state(waiting.id)).state,'escalated');
assert.equal((await state(waiting.id)).attempts,2);
await migration('feedback-controls');
assert.deepEqual(await settings(),{enabled:true});
assert.equal((await state(waiting.id)).attempts,2);
await assert.rejects(()=>migration('feedback-autofix'),/repair controls are installed/);
await pg.exec('rollback');

await pg.close();
console.log('PASS feedback controls: default OFF, verified admin, phased worker, epoch and lease, revocation, two-attempt limit, matched artifact run, manual closure, repeatable migration.');

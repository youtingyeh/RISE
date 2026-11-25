// 排程入口。用法：node tools/autofix/run.mjs scan|publish|verify
// scan：處理候選案件（只在本機工作目錄與 autofix/ 分支內修補，不動主線）；publish：發布已核准案件；verify：發布後複驗。
import {spawnSync} from 'node:child_process';
import {supabaseStore} from './store-supabase.mjs';
import {runPending} from './runner.mjs';
import {publishApproved,verifyPublished} from './publish.mjs';
import {loadProposer} from './proposers.mjs';
const [,,cmd]=process.argv;
if(!process.env.RISE_SUPABASE_URL||!process.env.RISE_SERVICE_ROLE_KEY){console.log('尚未設定 RISE_SUPABASE_URL／RISE_SERVICE_ROLE_KEY（GitHub Secrets）：自動修正排程未啟用，略過。');process.exit(0);}
const store=supabaseStore({url:process.env.RISE_SUPABASE_URL,serviceKey:process.env.RISE_SERVICE_ROLE_KEY});
const repoDir=process.cwd(),log=m=>console.log(m);
if(cmd==='scan'){
 const res=await runPending({store,repoDir,proposer:await loadProposer(process.env.RISE_AUTOFIX_PROPOSER),log});
 console.log(JSON.stringify(res,null,1));
 if(process.env.RISE_AUTOFIX_PUSH==='1')for(const r of res.filter(x=>x.outcome==='fix_ready')){const p=spawnSync('git',['push','-q','origin',r.branch],{stdio:'inherit'});if(p.status!==0)process.exitCode=1;}
}else if(cmd==='publish')console.log(JSON.stringify(await publishApproved({store,repoDir,remote:'origin',log}),null,1));
else if(cmd==='verify')console.log(JSON.stringify(await verifyPublished({store,baseUrl:process.env.RISE_SITE_URL||'https://youtingyeh.github.io/RISE/',log}),null,1));
else{console.error('用法：node tools/autofix/run.mjs scan|publish|verify');process.exit(2);}

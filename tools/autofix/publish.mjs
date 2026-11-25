// 發布：只處理管理者已核准的案件。發布前以乾淨的主線重跑獨立檢查器與靜態檢查；
// 分支在核准後被改動、主線已前進或檢查不過，一律不發布，保留給管理者處理。
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {serve,clickCheck} from './click-test.mjs';
const git=(cwd,args,allowFail=false)=>{const r=spawnSync('git',['-c','user.name=rise-autofix','-c','user.email=autofix@invalid','-c','commit.gpgsign=false',...args],{cwd,encoding:'utf8'});if(r.status!==0&&!allowFail)throw Error('git '+args.join(' ')+' 失敗：'+r.stderr.slice(0,200));return r;};

export async function publishApproved({store,repoDir,remote=null,targetBranch='main',log=()=>{}}){
 const results=[];
 for(const a of await store.approved()){
  const blocked=reason=>{log('不發布 '+a.case_no+'：'+reason);results.push({case_no:a.case_no,published:false,reason});};
  if(remote)git(repoDir,['fetch','-q',remote,`${a.branch}:${a.branch}`],true);
  if(git(repoDir,['rev-parse','--abbrev-ref','HEAD']).stdout.trim()!==targetBranch){blocked('目前不在 '+targetBranch);continue;}
  const head=git(repoDir,['rev-parse','--verify','-q',a.branch],true).stdout.trim();
  if(!head){blocked('找不到修正分支');continue;}
  if(head!==a.commit_sha){blocked('分支在核准後被改動');continue;}
  const base=git(repoDir,['rev-parse',targetBranch]).stdout.trim();
  if(git(repoDir,['merge-base',base,head]).stdout.trim()!==base){blocked('主線已前進，需重新產生修正');continue;}
  const tmp=await mkdtemp(join(tmpdir(),'rise-publish-'));const baseDir=join(tmp,'base'),headDir=join(tmp,'head');
  try{
   git(repoDir,['worktree','add','--detach',baseDir,base]);git(repoDir,['worktree','add','--detach',headDir,head]);
   const map=JSON.parse(await readFile(join(baseDir,'config/autofix-link-targets.json'),'utf8'));
   const checker=await import(pathToFileURL(join(baseDir,'tools/autofix/verify-diff.mjs')).href);
   const verdict=await checker.verifyDiff({baseDir,repoDir,baseRef:base,headRef:head,map});
   if(!verdict.ok){blocked('發布前檢查未通過：'+verdict.problems.join('；'));continue;}
   const sc=spawnSync(process.execPath,['tools/static-check.mjs'],{cwd:headDir,encoding:'utf8'});
   if(sc.status!==0){blocked('靜態檢查未通過');continue;}
  }finally{git(repoDir,['worktree','remove','--force',baseDir],true);git(repoDir,['worktree','remove','--force',headDir],true);await rm(tmp,{recursive:true,force:true});}
  git(repoDir,['merge','--ff-only','-q',a.branch]);
  if(a.keep_regression&&a.diff_summary?.links?.length){
   const file=join(repoDir,'tests/regression/autofix-links.json');await mkdir(dirname(file),{recursive:true});
   const cur=JSON.parse(await readFile(file,'utf8').catch(()=>'{"cases":[]}'));
   for(const l of a.diff_summary.links)cur.cases.push({case_no:a.case_no,page:a.page,text:l.text,target:l.target,title:l.title});
   await writeFile(file,JSON.stringify(cur,null,1)+'\n');git(repoDir,['add',file]);git(repoDir,['commit','-q','-m','Keep '+a.case_no+' as a regression case']);
  }
  if(remote)git(repoDir,['push','-q',remote,targetBranch]);
  const sha=git(repoDir,['rev-parse','HEAD']).stdout.trim();
  await store.markPublished(a.feedback_id,sha);results.push({case_no:a.case_no,published:true,sha});log('已發布 '+a.case_no);
 }
 return results;
}
// 發布後複驗：對「實際對外的網址」重跑同一個點擊檢查，通過才結案。
export async function verifyPublished({store,baseUrl,log=()=>{}}){
 const out=[];
 for(const a of await store.awaitingVerification()){
  const links=a.diff_summary?.links||[];const checks=[];
  for(const l of links)checks.push({text:l.text,...await clickCheck({baseUrl,page:a.page,text:l.text,target:l.target,title:l.title})});
  const ok=checks.length>0&&checks.every(x=>x.ok);
  await store.markVerified(a.feedback_id,ok,{post_publish:checks.map(x=>({text:x.text,ok:x.ok,landed:x.landed,title:x.title,reason:x.reason}))});
  out.push({case_no:a.case_no,verified:ok});log((ok?'複驗通過 ':'複驗失敗 ')+a.case_no);
 }
 return out;
}

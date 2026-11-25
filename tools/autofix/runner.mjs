// 重現 → 修正 → 重驗。狀態（含嘗試次數）一律由資料庫保存與強制；本程式重啟、改日重跑都沿用同一計數。
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isAllowedPage,MAX_ATTEMPTS,MAX_BROKEN_LINKS} from './policy.mjs';
import {brokenLinks} from './link-check.mjs';
import {serve,clickCheck} from './click-test.mjs';

const git=(cwd,args,allowFail=false)=>{const r=spawnSync('git',['-c','user.name=rise-autofix','-c','user.email=autofix@invalid','-c','commit.gpgsign=false',...args],{cwd,encoding:'utf8',maxBuffer:20*1024*1024});if(r.status!==0&&!allowFail)throw Error('git '+args.join(' ')+' 失敗：'+r.stderr.slice(0,200));return r;};
const staticCheck=dir=>{const r=spawnSync(process.execPath,['tools/static-check.mjs'],{cwd:dir,encoding:'utf8',timeout:120000});return {ok:r.status===0,summary:(r.stdout+r.stderr).trim().split('\n').slice(-3).join(' | ').slice(0,300)};};
const safe=async(fn,fallback)=>{try{return await fn();}catch(e){return fallback(e);}};

async function checkClicks(dir,page,links){
 const srv=await serve(dir);
 try{const out=[];for(const l of links)out.push({text:l.text,...await clickCheck({baseUrl:srv.url,page,text:l.text,target:l.target,title:l.title})});return out;}
 finally{await srv.close();}
}

export async function runCase({store,repoDir,c,proposer,simulation=false,log=()=>{}}){
 const id=c.feedback_id,fin=(outcome,payload)=>store.finish(id,outcome,payload);
 // 只使用 page 的字面值與固定欄位；回報文字從不傳入本流程，因此不可能被當成指令。
 if(!isAllowedPage(c.page)){await fin('escalate',{reason:'page_out_of_scope'});return {case_no:c.case_no,outcome:'escalated',reason:'page_out_of_scope'};}
 const baseSha=git(repoDir,['rev-parse','HEAD']).stdout.trim();
 const tmp=await mkdtemp(join(tmpdir(),'rise-autofix-'));const baseDir=join(tmp,'base');
 git(repoDir,['worktree','add','--detach',baseDir,baseSha]);
 const branch='autofix/'+c.case_no.toLowerCase();
 try{
  const map=JSON.parse(await readFile(join(baseDir,'config/autofix-link-targets.json'),'utf8'));
  // 1. 重現（在乾淨的 base 上）
  const broken=await brokenLinks(baseDir,c.page);
  if(!broken.length){await fin('needs_info',{reason:'cannot_reproduce',before:{page:c.page,broken:[]}});return {case_no:c.case_no,outcome:'needs_info',reason:'cannot_reproduce'};}
  if(broken.length>MAX_BROKEN_LINKS){await fin('escalate',{reason:'too_many_broken_links',before:{page:c.page,count:broken.length}});return {case_no:c.case_no,outcome:'escalated',reason:'too_many_broken_links'};}
  const unmapped=broken.filter(b=>!map.byText[b.text]);
  if(unmapped.length){await fin('escalate',{reason:'ambiguous_or_unknown_target',before:{page:c.page,unmapped:unmapped.map(b=>({text:b.text,href:b.href}))}});return {case_no:c.case_no,outcome:'escalated',reason:'ambiguous_or_unknown_target'};}
  const links=broken.map(b=>({text:b.text,from:b.href,target:map.byText[b.text].target,title:map.byText[b.text].title}));
  const beforeClicks=await checkClicks(baseDir,c.page,links);
  if(beforeClicks.some(x=>x.inconclusive)){await fin('needs_info',{reason:'inconclusive_reproduction',before:{page:c.page,clicks:beforeClicks}});return {case_no:c.case_no,outcome:'needs_info',reason:'inconclusive_reproduction'};}
  if(beforeClicks.some(x=>x.ok)){await fin('needs_info',{reason:'not_reproduced_in_browser',before:{page:c.page,clicks:beforeClicks}});return {case_no:c.case_no,outcome:'needs_info',reason:'not_reproduced_in_browser'};}
  const before={page:c.page,expected:links.map(l=>({text:l.text,lands_on:l.target,title_contains:l.title})),actual:beforeClicks.map(x=>({text:x.text,landed:x.landed,title:x.title})),broken:broken.map(b=>({text:b.text,href:b.href})),static_check:staticCheck(baseDir),base_commit:baseSha};
  await store.log(id,0,'reproduced',before);
  // 2. 修正與重驗（資料庫強制最多 MAX_ATTEMPTS 次）
  let prior=null,last={case_no:c.case_no,outcome:'attempt_failed'};
  for(let round=0;round<MAX_ATTEMPTS;round++){
   let attempt;try{attempt=await store.begin(id,branch,simulation);}catch(e){return {case_no:c.case_no,outcome:'blocked',reason:String(e.message).replace(/^rise:/,'')};}
   const workDir=join(tmp,'work'+attempt);
   git(repoDir,['worktree','add','-B',branch,workDir,baseSha]);
   let failure=null,head=null,verdict=null,diffText='';
   try{
    const html=await readFile(join(workDir,c.page),'utf8');
    const proposal=await safe(()=>proposer({attempt,page:c.page,html,broken,map,prior}),e=>({error:String(e.message).slice(0,160)}));
    if(proposal.error||!proposal.files)failure={phase:'proposal',problems:[proposal.error||'提案沒有任何檔案']};
    else{
     for(const [path,content] of Object.entries(proposal.files)){
      const target=join(workDir,path);if(!target.startsWith(workDir))failure={phase:'proposal',problems:['路徑超出工作目錄']};else await writeFile(target,content);
     }
     git(workDir,['add','-A']);git(workDir,['commit','-q','-m','autofix '+c.case_no]);
     head=git(workDir,['rev-parse','HEAD']).stdout.trim();diffText=git(repoDir,['diff','--no-renames',baseSha,head]).stdout.slice(0,4000);
    }
    if(!failure){
     // 獨立檢查器：從乾淨 base 載入，因此提案無法改動檢查規則。
     const checker=await import(pathToFileURL(join(baseDir,'tools/autofix/verify-diff.mjs')).href);
     verdict=await checker.verifyDiff({baseDir,repoDir,baseRef:baseSha,headRef:head,map});
     if(!verdict.ok)failure={phase:'scope_check',problems:verdict.problems};
    }
    if(!failure){const sc=staticCheck(workDir);if(!sc.ok)failure={phase:'static_check',problems:[sc.summary]};}
    let afterClicks=[];
    if(!failure){afterClicks=await checkClicks(workDir,c.page,links);const bad=afterClicks.filter(x=>!x.ok);if(bad.length)failure={phase:'click_check',problems:bad.map(x=>`${x.text}：實際到達 ${x.landed||x.reason}（標題「${x.title||''}」）`)};}
    await store.log(id,attempt,failure?'verify_failed':'verified',failure||{clicks:afterClicks});
    if(!failure){
     await store.finish(id,'fix_ready',{before:{...before,links},after:{static_check:{ok:true},clicks:afterClicks.map(x=>({text:x.text,landed:x.landed,title:x.title,ok:x.ok}))},
      diff:{files:verdict.touched,changed_lines:verdict.changed_lines,fixes:verdict.fixes,links,patch:diffText},branch,commit:head,
      verify_command:`node tools/autofix/verify-diff.mjs . ${baseSha.slice(0,12)} ${head.slice(0,12)} && node tools/static-check.mjs`});
     return {case_no:c.case_no,outcome:'fix_ready',branch,commit:head,attempts:attempt};
    }
    prior=failure;
    const outcome=await store.finish(id,'attempt_failed',{after:{...failure,patch:diffText}});
    last={case_no:c.case_no,outcome,attempts:attempt,failure};
    git(repoDir,['worktree','remove','--force',workDir],true);git(repoDir,['branch','-D',branch],true); // 未通過的修補不留在分支上
    if(outcome==='escalated')return last;
   }finally{git(repoDir,['worktree','remove','--force',workDir],true);}
  }
  return last;
 }finally{
  git(repoDir,['worktree','remove','--force',baseDir],true);await rm(tmp,{recursive:true,force:true});git(repoDir,['worktree','prune'],true);
 }
}
export async function runPending({store,repoDir,proposer,simulation=false,log=()=>{}}){
 const out=[];for(const c of await store.candidates())out.push(await runCase({store,repoDir,c,proposer,simulation,log}));return out;
}

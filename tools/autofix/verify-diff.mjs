// 獨立的修改範圍檢查器。由「乾淨的 base 檢出」執行，讀取 base 的政策、對照表與檔案，
// 只看實際 git 差異；不讀取、也不採信 AI 的任何文字說明。任何一項不符即視為失敗。
import {spawnSync} from 'node:child_process';
import {readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isAllowedPage,whyDenied,MAX_CHANGED_LINES} from './policy.mjs';
import {internalTarget,normalizeText} from './link-check.mjs';
const git=(cwd,args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8',maxBuffer:20*1024*1024});if(r.status!==0)throw Error('git '+args.join(' ')+' 失敗：'+r.stderr.slice(0,200));return r.stdout;};
const ANCHORS=/<a\b[^>]*?\bhref="([^"]*)"[^>]*>([^<]*)<\/a>/g;
const anchors=line=>[...line.matchAll(ANCHORS)].map(m=>({href:m[1],text:normalizeText(m[2]),skeleton:m[0].replace(m[1],'\u0000')}));
const exists=async p=>{try{await access(p);return true;}catch{return false;}};

export async function verifyDiff({baseDir,repoDir,baseRef,headRef,map,pageRoot}){
 const problems=[];const touched=[];
 const rows=git(repoDir,['diff','--no-renames','--name-status',baseRef,headRef]).split('\n').filter(Boolean);
 if(!rows.length)problems.push('沒有任何修改');
 for(const row of rows){
  const [status,...rest]=row.split('\t');const path=rest.join('\t');touched.push(path);
  if(status!=='M'){problems.push(`只允許修改既有檔案，不可新增、刪除或改名：${status} ${path}`);continue;}
  const denied=whyDenied(path);if(denied)problems.push(denied);
 }
 const modes=git(repoDir,['diff','--no-renames','--summary',baseRef,headRef]).trim();
 if(/mode change|create mode|delete mode|rename/i.test(modes))problems.push('偵測到檔案模式、建立、刪除或改名變更');
 const stat=git(repoDir,['diff','--no-renames','--numstat',baseRef,headRef]).split('\n').filter(Boolean);
 let changed=0;for(const s of stat){const [a,d,f]=s.split('\t');if(a==='-'||d==='-'){problems.push('不可修改二進位檔案：'+f);continue;}changed+=Number(a)+Number(d);}
 if(changed>MAX_CHANGED_LINES)problems.push(`修改行數 ${changed} 超過上限 ${MAX_CHANGED_LINES}`);
 const checked=[];
 for(const path of touched.filter(isAllowedPage)){
  const oldText=git(repoDir,['show',`${baseRef}:${path}`]).split('\n'),newText=git(repoDir,['show',`${headRef}:${path}`]).split('\n');
  if(oldText.length!==newText.length){problems.push(`${path}：行數改變，只允許在同一行內替換連結目的地`);continue;}
  for(let i=0;i<oldText.length;i++){
   if(oldText[i]===newText[i])continue;
   const a=anchors(oldText[i]),b=anchors(newText[i]);
   if(!a.length||a.length!==b.length){problems.push(`${path}:${i+1}：變更的不是 <a href> 連結`);continue;}
   // 去掉 href 後必須完全相同：連結以外的任何字元都不能被動到。
   let rebuiltOld=oldText[i],rebuiltNew=newText[i];
   for(const x of a)rebuiltOld=rebuiltOld.replace(x.href,'\u0001');for(const x of b)rebuiltNew=rebuiltNew.replace(x.href,'\u0001');
   if(rebuiltOld!==rebuiltNew){problems.push(`${path}:${i+1}：除了 href 之外還有其他內容被修改`);continue;}
   for(let k=0;k<a.length;k++){
    if(a[k].href===b[k].href)continue;
    const oldT=internalTarget(a[k].href),newT=internalTarget(b[k].href),entry=map.byText[a[k].text];
    if(a[k].text!==b[k].text)problems.push(`${path}:${i+1}：連結文字被修改`);
    else if(!oldT)problems.push(`${path}:${i+1}：原連結不是站內連結，不在修補範圍`);
    else if(await exists(join(baseDir,oldT)))problems.push(`${path}:${i+1}：原連結目的頁存在（${oldT}），不是失效連結`);
    else if(!entry)problems.push(`${path}:${i+1}：「${a[k].text}」沒有管理者維護的對應目的頁`);
    else if(!newT||newT!==entry.target||b[k].href!==entry.target)problems.push(`${path}:${i+1}：新目的頁 ${b[k].href} 與管理者設定的 ${entry.target} 不一致`);
    else checked.push({path,line:i+1,text:a[k].text,from:a[k].href,to:b[k].href});
   }
  }
 }
 if(!problems.length&&!checked.length)problems.push('差異中找不到任何符合規則的連結修補');
 return {ok:problems.length===0,problems,touched,changed_lines:changed,fixes:checked};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const [,,repoDir,baseRef,headRef,baseDir]=process.argv;
 const map=JSON.parse(await readFile(join(baseDir||repoDir,'config/autofix-link-targets.json'),'utf8'));
 const r=await verifyDiff({baseDir:baseDir||repoDir,repoDir,baseRef,headRef,map});
 console.log(JSON.stringify(r,null,1));process.exit(r.ok?0:1);
}

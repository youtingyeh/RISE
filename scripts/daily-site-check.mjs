// 每日網站排查：讀取 sitemap 與本機 HTML 清單，檢查正式網站每個頁面能否開啟，
// 並把結果交給 rise-feedback-digest 寄出每日彙整。只用公開網址；憑證由 GitHub Secret 提供。
import {readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const site=(process.env.RISE_SITE_URL||'https://youtingyeh.github.io/RISE/').replace(/\/?$/,'/');
const supa=(process.env.RISE_SUPABASE_URL||'').replace(/\/$/,'');
const key=process.env.RISE_SUPABASE_ANON_KEY||'';
const token=process.env.RISE_DIGEST_TOKEN||'';
const pages=(await readdir(root)).filter(f=>f.endsWith('.html')).sort();
const failed=[];
async function probe(page){
 for(let attempt=0;attempt<2;attempt++){
  try{
   const r=await fetch(site+page,{redirect:'follow',signal:AbortSignal.timeout(15000),headers:{'cache-control':'no-cache'}});
   if(r.status!==200){if(attempt)failed.push({page,reason:'HTTP '+r.status});continue;}
   const html=await r.text();
   if(!/<title>[^<]+<\/title>/.test(html)){failed.push({page,reason:'缺少標題，頁面內容異常'});}
   return;
  }catch(e){if(attempt)failed.push({page,reason:'連線失敗或逾時'});}
 }
}
for(let i=0;i<pages.length;i+=6)await Promise.all(pages.slice(i,i+6).map(probe));
const summary={checked:pages.length,failed:failed.sort((a,b)=>a.page.localeCompare(b.page)),note:'僅檢查頁面能否開啟；登入後功能需人工驗收。'};
console.log(JSON.stringify(summary));
if(!supa||!token){console.log('未設定 RISE_SUPABASE_URL 或 RISE_DIGEST_TOKEN：只輸出排查結果，不寄信。');process.exit(0);}
const res=await fetch(supa+'/functions/v1/rise-feedback-digest',{method:'POST',headers:{'content-type':'application/json','x-rise-digest-token':token,...(key?{apikey:key,authorization:'Bearer '+key}:{})},body:JSON.stringify({site_check:summary}),signal:AbortSignal.timeout(60000)});
const out=await res.text();console.log('digest',res.status,out.slice(0,300));
if(!res.ok){process.exitCode=1;}

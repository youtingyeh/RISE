import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import nodemailer from 'npm:nodemailer@10.0.10';

class SafeError extends Error {}
const must=(name:string)=>{const v=Deno.env.get(name);if(!v)throw new SafeError('缺少 Edge Functions Secret：'+name+'。請到 Edge Functions → Secrets 新增。');return v;};
const checked=(r:any)=>{if(r.error){if(['PGRST202','PGRST205','42P01'].includes(r.error.code))throw new SafeError('找不到回報彙整資料表或函式，請執行 backend/feedback.sql。');throw new SafeError('回報彙整資料庫操作失敗，請查看 Edge Function Logs。');}return r.data;};
const same=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);let d=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)d|=(x[i]??0)^(y[i]??0);return d===0;};
const KIND:Record<string,string>={bug:'功能異常',security:'疑似安全問題',content:'內容修正',suggestion:'改善建議',other:'其他'};
const clean=(s:unknown,n:number)=>String(s??'').replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,n);
const taipei=(d:Date)=>d.toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
const count=(value:unknown)=>typeof value==='number' && Number.isSafeInteger(value) && value>=0 ? value : 0;
const kindLabel=(kind:unknown)=>typeof kind==='string' && Object.hasOwn(KIND,kind) ? KIND[kind] : KIND.other;
const caseNumber=(value:unknown)=>typeof value==='string' ? value.match(/^(FB-\d{8}-\d{4,18})$/)?.[1] : undefined;

function buildMail(job:any,adminUrl:string){
 // 僅從摘要擷取伺服器產生的案件編號、固定類型與數量。
 const summary=job.summary;
 const day=typeof job.day==='string' ? job.day.match(/^(\d{4}-\d{2}-\d{2})$/)?.[1] : undefined;
 const newCount=count(summary.new_count);
 const openCount=count(summary.open_total);
 const staleCount=count(summary.stale_untriaged);
 const buckets=summary.buckets ?? {};
 const lines=[
  `RISE 網站意見與修正回報彙整（${day ?? '每日'}）`,
  '',
  `新收集 ${newCount} 則｜未處理 ${count(summary.untriaged)} 則｜未結案 ${openCount} 則`,
  `待補資料 ${count(buckets.needs_info)}｜處理中 ${count(buckets.in_progress)}｜轉交管理者 ${count(buckets.escalated)}｜待驗證 ${count(buckets.awaiting_verification)}｜本期已結案 ${count(buckets.closed ?? summary.resolved_in_window)}`,
  `緊急案件未結案 ${count(summary.urgent_open)} 則｜高優先未結案 ${count(summary.high_open)} 則｜超過 3 天仍未處理 ${staleCount} 則`,
 ];
 const kindCounts=Object.entries(KIND).flatMap(([kind,label])=>{
  const total=count(summary.by_kind_open?.[kind]);
  return total ? [`${label} ${total}`] : [];
 });
 if(kindCounts.length)lines.push(`未結案類型：${kindCounts.join('、')}`);
 if(job.site_check){
  const failed=Array.isArray(job.site_check.failed) ? job.site_check.failed.length : 0;
  lines.push(`網站排查：檢查 ${count(job.site_check.checked)} 個頁面｜異常 ${failed} 個`);
 }

 lines.push('',`【新收集的回報（${newCount} 則${newCount>50?'，僅列前 50 則':''}）】`);
 if(!newCount)lines.push('本期沒有新回報。');
 for(const item of summary.new_items ?? []){
  const id=caseNumber(item.case_no);
  if(id)lines.push(`  ${id} [${kindLabel(item.kind)}]${item.urgent===true?'［緊急］':''}`);
 }

 if(summary.repeat_pages?.length){
  lines.push('','【重複回報】');
  for(const group of summary.repeat_pages){
   const ids=(group.case_nos ?? []).map(caseNumber).filter(Boolean);
   lines.push(`  ${kindLabel(group.kind)} ${count(group.count)} 則${ids.length?`（${ids.join('、')}）`:''}`);
  }
 }
 const readyIds=(summary.fix_ready ?? []).map((item:any)=>caseNumber(item.case_no)).filter(Boolean);
 if(readyIds.length)lines.push('',`待管理者處理的修正案件：${readyIds.join('、')}`);
 const openIds=(summary.oldest_open ?? []).map((item:any)=>caseNumber(item.case_no)).filter(Boolean);
 if(openIds.length)lines.push('',`最久未結案：${openIds.join('、')}`);

 lines.push('',`到管理頁處理：${adminUrl}`);
 const subject=`【RISE 回報彙整】${day ? `${day}　` : ''}新 ${newCount}／未結案 ${openCount}${staleCount?`／逾期 ${staleCount}`:''}`;
 return {subject,text:lines.join('\n')};
}

export async function handler(req:Request):Promise<Response>{
 const origin=Deno.env.get('RISE_SITE_ORIGIN') || 'https://youtingyeh.github.io';
 const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-rise-digest-token','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 // 瀏覽器呼叫（管理頁）必須來自本站；排程呼叫不帶 Origin，改用共用 token。
 if(req.headers.has('origin')&&req.headers.get('origin')!==origin)return reply({error:'不允許的網站來源。'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'請使用 POST。'},405);
 try{
  const db=createClient(must('SUPABASE_URL'),must('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
  const token=req.headers.get('x-rise-digest-token')||'';
  let scheduled=false;
  if(token){
   const expected=Deno.env.get('RISE_DIGEST_TOKEN')||'';
   if(expected.length<24||!same(token,expected))return reply({error:'排程憑證不正確。'},401);
   scheduled=true;
  }else{
   const bearer=req.headers.get('authorization')||'';
   if(!/^Bearer\s+\S+$/i.test(bearer))return reply({error:'請先登入。'},401);
   const identity=await db.auth.getUser(bearer.replace(/^Bearer\s+/i,''));
   const user=identity.data.user;
   if(identity.error||!user?.email_confirmed_at)return reply({error:'請先登入並驗證信箱。'},401);
   const profile=checked(await db.from('rise_profiles').select('role').eq('id',user.id).single());
   if(profile.role!=='admin')return reply({error:'只有管理員可以寄送回報彙整。'},403);
  }
  // 排程可附上自動排查結果；管理員手動寄送時忽略前端傳入的排查資料。
  let siteCheck:any=null;
  if(scheduled){
   const body=await req.json().catch(()=>({}));
   const c=body?.site_check;
   if(c&&typeof c==='object'&&Number.isSafeInteger(c.checked))siteCheck={checked:c.checked,failed:Array.isArray(c.failed)?c.failed.slice(0,30).map((f:any)=>({page:clean(f?.page,100),reason:clean(f?.reason,100)})):[],note:clean(c.note,200)};
  }
  const day=taipei(new Date());
  const job=checked(await db.rpc('rise_claim_feedback_digest',{p_day:day,p_site_check:siteCheck}));
  if(!job)return reply({sent:false,reason:'今日彙整已寄出，或另一個寄送正在進行；失敗的寄送會在 10 分鐘後可重試。'});
  // 排程只在有新回報時寄信；沒有新回報就釋放領取、不寄。管理員手動寄送則一律寄出。
  if(scheduled&&!(job.summary.new_count>0)){
   checked(await db.rpc('rise_release_feedback_digest',{p_day:job.day}));
   return reply({sent:false,skipped:true,reason:'今天沒有新回報，不寄信。',site_failed:(siteCheck?.failed||[]).length});
  }
  const sender=must('RISE_SMTP_USER'),password=must('RISE_SMTP_PASSWORD');
  const to=Deno.env.get('RISE_FEEDBACK_TO')||'ytyeh@g.ntu.edu.tw';
  const site=new URL(Deno.env.get('RISE_SITE_URL')||'https://youtingyeh.github.io/RISE/');
  if(site.protocol!=='https:' || site.username || site.password)throw Error('invalid site configuration');
  if(!site.pathname.endsWith('/'))site.pathname+='/';
  const mail=buildMail(job,new URL('admin-feedback.html',site).href);
  const smtp=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:sender,pass:password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true});
  let ok=false;
  try{
   const info=await smtp.sendMail({from:{name:'RISE 國立臺灣大學數思新生計畫',address:sender},to:{address:to,name:''},subject:mail.subject,text:mail.text,messageId:`<rise-feedback-${job.day}@${sender.split('@')[1]}>`});
   ok=!!info.accepted?.length;
  }catch{ok=false;}finally{smtp.close();}
  checked(await db.rpc('rise_finish_feedback_digest',{p_day:job.day,p_sent:ok}));
  if(!ok)return reply({sent:false,error:'郵件伺服器沒有接收，已排定 10 分鐘後可重試。回報資料不受影響。'},502);
  return reply({sent:true,day:job.day,new_count:job.summary.new_count,open_total:job.summary.open_total});
 }catch(error){
  return reply({error:error instanceof SafeError ? error.message : '回報彙整後端執行失敗，請查看 rise-feedback-digest 的 Logs。回報資料不受影響。'},503);
 }
}
Deno.serve(handler);

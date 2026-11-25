import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import nodemailer from 'npm:nodemailer@10.0.10';

class SafeError extends Error {}
const must=(name:string)=>{const v=Deno.env.get(name);if(!v)throw new SafeError('缺少 Edge Functions Secret：'+name+'。請到 Edge Functions → Secrets 新增。');return v;};
const checked=(r:any)=>{if(r.error){if(['PGRST202','PGRST205','42P01'].includes(r.error.code))throw new SafeError('找不到緊急通知函式，請執行 backend/feedback-autofix.sql。');throw new SafeError('緊急通知資料庫操作失敗，請查看 Edge Function Logs。');}return r.data;};
const same=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);let d=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)d|=(x[i]??0)^(y[i]??0);return d===0;};
const KIND:Record<string,string>={bug:'功能異常',security:'疑似安全問題',suggestion:'改善建議',other:'其他',content:'內容修正'};
const clean=(s:unknown,n:number)=>String(s??'').replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,n);

// 緊急通知只含案件編號與類型，不含回報內文（可能含個人資料）；內容與收件人皆由伺服器決定。
export async function handler(req:Request):Promise<Response>{
 const origin=Deno.env.get('RISE_SITE_ORIGIN') || 'https://youtingyeh.github.io';
 const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-rise-digest-token','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.headers.has('origin')&&req.headers.get('origin')!==origin)return reply({error:'不允許的網站來源。'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'請使用 POST。'},405);
 try{
  const db=createClient(must('SUPABASE_URL'),must('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
  const token=req.headers.get('x-rise-digest-token')||'';
  if(token){
   const expected=Deno.env.get('RISE_DIGEST_TOKEN')||'';
   if(expected.length<24||!same(token,expected))return reply({error:'排程憑證不正確。'},401);
  }else{
   // 會員送出回報後，由其瀏覽器觸發一次；只處理佇列中既有的通知，無法指定內容或收件人。
   const bearer=req.headers.get('authorization')||'';
   if(!/^Bearer\s+\S+$/i.test(bearer))return reply({error:'請先登入。'},401);
   const identity=await db.auth.getUser(bearer.replace(/^Bearer\s+/i,''));
   if(identity.error||!identity.data.user?.email_confirmed_at)return reply({error:'請先登入並驗證信箱。'},401);
  }
  const sender=must('RISE_SMTP_USER'),password=must('RISE_SMTP_PASSWORD');
  const to=Deno.env.get('RISE_FEEDBACK_TO')||'ytyeh@g.ntu.edu.tw';
  const site=new URL(Deno.env.get('RISE_SITE_URL')||'https://youtingyeh.github.io/RISE/');
  if(site.protocol!=='https:')throw Error('invalid site configuration');
  if(!site.pathname.endsWith('/'))site.pathname+='/';
  const adminUrl=new URL('admin-feedback.html',site).href;
  const smtp=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:sender,pass:password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true});
  let sent=0,failed=0;
  try{
   for(let n=0;n<3;n++){
    const jobs=checked(await db.rpc('rise_claim_feedback_alert'));const job=jobs?.[0];if(!job)break;
    let ok=false;
    try{
     const info=await smtp.sendMail({from:{name:'RISE 國立臺灣大學數思新生計畫',address:sender},to:{address:to,name:''},
      subject:`【RISE 緊急回報】${clean(job.case_no,30)} ${KIND[job.kind]||''}`,messageId:`<rise-alert-${job.id}@${sender.split('@')[1]}>`,
      text:`有一則需要優先處理的回報（疑似涉及安全、登入、角色權限、個資或資料遺失）。\n\n案件編號：${clean(job.case_no,30)}\n類型：${KIND[job.kind]||job.kind}\n收到時間：${new Date(job.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}（臺北時間）\n\n為保護隱私，本信不含回報內容。請登入管理頁查看並處理：\n${adminUrl}\n\n此案件不會進入自動修正流程。`});
     ok=!!info.accepted?.length;
    }catch{ok=false;}
    checked(await db.rpc('rise_finish_feedback_alert',{p_id:job.id,p_sent:ok}));
    if(ok)sent++;else{failed++;break;}
   }
  }finally{smtp.close();}
  return reply({sent,failed});
 }catch(error){
  return reply({error:error instanceof SafeError ? error.message : '緊急通知後端執行失敗，請查看 rise-feedback-alert 的 Logs。回報資料不受影響，管理頁仍會標示待優先處理。'},503);
 }
}
Deno.serve(handler);

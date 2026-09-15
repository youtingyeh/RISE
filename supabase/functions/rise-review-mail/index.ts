import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import nodemailer from 'npm:nodemailer@10.0.10';

class SafeError extends Error {}
const must=(name:string)=>{const v=Deno.env.get(name);if(!v)throw new SafeError('缺少 Edge Functions Secret：'+name+'。請到 Edge Functions → Secrets 新增。');return v;};
const checked=(r:any)=>{if(r.error){if(['PGRST202','PGRST205','42P01'].includes(r.error.code))throw new SafeError('找不到通知信資料表或函式，請執行 backend/review-mail.sql。');throw new SafeError('通知信資料庫操作失敗，請查看 Edge Function Logs。');}return r.data;};
export async function handler(req:Request):Promise<Response>{
 const origin=Deno.env.get('RISE_SITE_ORIGIN') || 'https://youtingyeh.github.io';
 const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.headers.has('origin')&&req.headers.get('origin')!==origin)return reply({error:'不允許的網站來源。'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'請使用 POST。'},405);
 try{
  const bearer=req.headers.get('authorization')||'';
  if(!/^Bearer\s+\S+$/i.test(bearer))return reply({error:'請先登入。'},401);
  const db=createClient(must('SUPABASE_URL'),must('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
  const identity=await db.auth.getUser(bearer.replace(/^Bearer\s+/i,''));
  const user=identity.data.user;
  if(identity.error||!user?.email_confirmed_at)return reply({error:'請先登入並驗證信箱。'},401);
  const profile=checked(await db.from('rise_profiles').select('role').eq('id',user.id).single());
  if(profile.role!=='admin')return reply({error:'只有管理員可以寄送審核通知。'},403);
  // 寄件帳密只由 Edge Function Secrets 讀取；不接受前端指定收件人或信件內容。
  const sender=must('RISE_SMTP_USER');
  const password=must('RISE_SMTP_PASSWORD');
  const site=new URL(Deno.env.get('RISE_SITE_URL')||'https://youtingyeh.github.io/RISE/');
  if(site.protocol!=='https:')throw Error('invalid site configuration');
  if(!site.pathname.endsWith('/'))site.pathname+='/';
  const account=new URL('account.html',site).href;
  const smtp=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,
   auth:{user:sender,pass:password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,
   disableFileAccess:true,disableUrlAccess:true});
  let sent=0,failed=0;
  try{
   for(let n=0;n<3;n++){
    const jobs=checked(await db.rpc('rise_claim_review_mail'));
    const job=jobs?.[0];if(!job)break;
    try{
     const recipient=await db.auth.admin.getUserById(job.user_id);
     if(recipient.error||!recipient.data.user?.email||!recipient.data.user.email_confirmed_at)throw Error('recipient unavailable');
     const label=({approved:'已核准',returned:'請補充資料',rejected:'未核准'} as Record<string,string>)[job.decision];
     const role=job.requested_role==='ta'?'助教':'教師';
     const info=await smtp.sendMail({from:{name:'RISE 國立臺灣大學數思新生計畫',address:sender},
      to:{address:recipient.data.user.email,name:''},
      subject:`【RISE 數思新生計畫】${role}資格申請${label}`,
      messageId:`<rise-review-${job.id}@${sender.split('@')[1]}>`,
      text:`您好：\n\n您的${role}資格申請審核結果：${label}。\n\n審核意見：\n${job.note||'無其他補充意見。'}\n\n請登入會員中心查看最新狀態${job.decision==='returned'?'，並依意見補件後重新送審':''}：\n${account}\n\n案件編號：${job.application_id}\n審核版本：${job.version}\n\nRISE 國立臺灣大學數思新生計畫\n此為系統通知，最新申請狀態以會員中心為準。`});
     if(!info.accepted?.length)throw Error('mail not accepted');
     checked(await db.from('rise_review_mail').update({state:'sent',sent_at:new Date().toISOString()}).eq('id',job.id).eq('attempts',job.attempts));
     sent++;
    }catch{
     failed++;
     // SMTP 接收後若回應遺失，重試仍可能重複寄送；固定 Message-ID 方便追蹤。
     checked(await db.from('rise_review_mail').update({state:'pending',available_at:new Date(Date.now()+600000).toISOString()}).eq('id',job.id).eq('attempts',job.attempts));
     break;
    }
   }
  }finally{smtp.close();}
  const remaining=await db.from('rise_review_mail').select('id',{count:'exact',head:true}).neq('state','sent');
  if(remaining.error)throw Error('count failed');
  return reply({sent,failed,remaining:remaining.count||0});
 }catch(error){
  return reply({error:error instanceof SafeError ? error.message : '通知信後端執行失敗，請查看 rise-review-mail 的 Logs。審核結果不受影響。'},503);
 }
}
Deno.serve(handler);

// 正式環境的狀態儲存：以 service_role 呼叫資料庫函式。金鑰只來自環境變數（GitHub Secret），不寫入儲存庫。
export function supabaseStore({url,serviceKey,fetchImpl=fetch}){
 if(!url||!serviceKey)throw Error('缺少 RISE_SUPABASE_URL 或 RISE_SERVICE_ROLE_KEY');
 const rpc=async(fn,args={})=>{
  const r=await fetchImpl(url.replace(/\/$/,'')+'/rest/v1/rpc/'+fn,{method:'POST',headers:{apikey:serviceKey,authorization:'Bearer '+serviceKey,'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(30000)});
  const body=await r.json().catch(()=>null);
  if(!r.ok)throw Error(body?.message||('RPC '+fn+' 失敗 '+r.status));
  return body;
 };
 return {
  candidates:()=>rpc('rise_autofix_candidates'),
  begin:(id,branch,sim)=>rpc('rise_autofix_begin_attempt',{p_feedback:id,p_branch:branch,p_simulation:!!sim}),
  log:(id,attempt,phase,result)=>rpc('rise_autofix_log',{p_feedback:id,p_attempt:attempt,p_phase:phase,p_result:result}),
  finish:(id,outcome,payload)=>rpc('rise_autofix_finish',{p_feedback:id,p_outcome:outcome,p_payload:payload}),
  approved:()=>rpc('rise_autofix_approved'),
  markPublished:(id,sha)=>rpc('rise_autofix_mark_published',{p_feedback:id,p_sha:sha}),
  awaitingVerification:()=>rpc('rise_autofix_awaiting_verification'),
  markVerified:(id,ok,result)=>rpc('rise_autofix_mark_verified',{p_feedback:id,p_ok:ok,p_result:result})
 };
}

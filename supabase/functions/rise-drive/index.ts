// Deploy as `rise-drive`. verify_jwt=false; this handler validates EVERY request with auth.getUser.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const MAX = 5 * 1024 * 1024;
const TYPES: Record<string, string> = {'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class Problem extends Error { constructor(public status: number, message: string) { super(message); } }
function must(name: string) { const value = Deno.env.get(name); if (!value) throw new Problem(503, '後端設定不完整：' + name); return value; }
function dbResult(result: {data: any; error: any}) {
  if (result.error) {
    const message = String(result.error.message || '');
    throw new Problem(400, message.startsWith('rise:') ? message.slice(5) : '資料庫操作失敗，請確認已執行 google-drive.sql。');
  }
  return result.data;
}
async function accessToken() {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', signal:AbortSignal.timeout(15000),
    body:new URLSearchParams({client_id:must('GOOGLE_DRIVE_CLIENT_ID'),client_secret:must('GOOGLE_DRIVE_CLIENT_SECRET'),refresh_token:must('GOOGLE_DRIVE_REFRESH_TOKEN'),grant_type:'refresh_token'})
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Problem(503, data.error==='invalid_grant' ? 'Google 授權已失效，請管理員重新授權並更新 Refresh token。' : 'Google 授權失敗，請管理員檢查三項 Google Drive Secrets。');
  return String(data.access_token);
}
async function google(token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers); headers.set('Authorization', 'Bearer ' + token);
  return await fetch('https://www.googleapis.com/' + path, {...init, headers, signal:AbortSignal.timeout(20000)});
}
async function googleOK(response: Response) {
  if (!response.ok) {
    throw new Problem(502, response.status===404 ? 'Google Drive 檔案不存在，或目前授權無法存取。' : response.status===403 ? 'Google Drive 拒絕操作，請檢查容量、資料夾權限或校方政策。' : 'Google Drive 暫時無法完成操作，請稍後再試。');
  }
  return response;
}
async function newDriveId(token: string) {
  const data = await (await googleOK(await google(token, 'drive/v3/files/generateIds?count=1&space=drive&type=files'))).json();
  if (!data.ids?.[0]) throw new Problem(502,'Google 未回傳檔案編號。');
  return String(data.ids[0]);
}
async function limitedBody(req: Request, limit: number) {
  if (Number(req.headers.get('content-length')) > limit) throw new Problem(413,'附件超過大小限制。');
  const reader=req.body?.getReader(); if(!reader) throw new Problem(400,'缺少內容。');
  const chunks: BlobPart[]=[]; let length=0;
  while(true) { const part=await reader.read(); if(part.done)break; length+=part.value.length;
    if(length>limit){await reader.cancel();throw new Problem(413,'附件超過大小限制。');} chunks.push(new Uint8Array(part.value)); }
  return new Blob(chunks);
}
function validSignature(bytes: Uint8Array, type: string) {
  const ascii=(a:number,b:number)=>new TextDecoder().decode(bytes.slice(a,b));
  return type==='application/pdf' ? ascii(0,5)==='%PDF-' : type==='image/jpeg' ? bytes[0]===255&&bytes[1]===216&&bytes[2]===255 : type==='image/png' ? [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) : type==='image/webp' && ascii(0,4)==='RIFF' && ascii(8,12)==='WEBP';
}

export async function handler(req: Request): Promise<Response> {
  const origin=Deno.env.get('RISE_SITE_ORIGIN') || 'https://youtingyeh.github.io';
  const headers=new Headers({'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'});
  const json=(data: unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:new Headers([...headers.entries(),['Content-Type','application/json; charset=utf-8']])});
  if(req.headers.has('origin')&&req.headers.get('origin')!==origin)return json({error:'不允許的網站來源。'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return json({error:'請使用 POST。'},405);
  try {
    const auth=req.headers.get('authorization') || '';
    if(!/^Bearer\s+\S+$/i.test(auth))throw new Problem(401,'請先登入 RISE。');
    const url=must('SUPABASE_URL');
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
    const anonKey=Deno.env.get('SUPABASE_ANON_KEY') || JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}').default;
    if(!serviceKey || !anonKey)throw new Problem(503,'Supabase 後端金鑰尚未設定。');
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const signed=createClient(url,anonKey,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
    const identity=await admin.auth.getUser(auth.replace(/^Bearer\s+/i,''));
    const user=identity.data?.user;
    if(identity.error||!user||!user.email_confirmed_at)throw new Problem(401,'請先登入並驗證信箱。');
    const profile=dbResult(await admin.from('rise_profiles').select('role').eq('id',user.id).single());
    const action=new URL(req.url).searchParams.get('action');
    if(action==='initialize') {
      if(profile.role!=='admin')throw new Problem(403,'只有管理員可設定儲存空間。');
      const token=await accessToken();
      let settings=dbResult(await admin.from('rise_drive_settings').select('*').eq('id',true).maybeSingle());
      if(!settings) {
        const folder=await newDriveId(token);
        dbResult(await admin.from('rise_drive_settings').upsert({id:true,folder_id:folder,enabled:false},{onConflict:'id',ignoreDuplicates:true}));
        settings=dbResult(await admin.from('rise_drive_settings').select('*').eq('id',true).single());
      }
      let folder=await google(token,'drive/v3/files/'+encodeURIComponent(settings.folder_id)+'?fields=id,mimeType,trashed');
      if(folder.status===404 && !settings.enabled) {
        const created=await google(token,'drive/v3/files?fields=id', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:settings.folder_id,name:'RISE 資格證明（系統專用）',mimeType:'application/vnd.google-apps.folder'})});
        if(created.status!==409)await googleOK(created);
        folder=await google(token,'drive/v3/files/'+encodeURIComponent(settings.folder_id)+'?fields=id,mimeType,trashed');
      }
      const meta=await (await googleOK(folder)).json();
      if(meta.trashed||meta.mimeType!=='application/vnd.google-apps.folder')throw new Problem(409,'專用資料夾已移至垃圾桶或類型不正確。');
      dbResult(await admin.from('rise_drive_settings').update({enabled:true}).eq('id',true));
      return json({message:'Google Drive 已啟用，新附件將存入專用資料夾。',folderURL:'https://drive.google.com/drive/folders/'+settings.folder_id});
    }
    if(action==='upload') {
      if(profile.role!=='student')throw new Problem(403,'目前帳號不需上傳資格申請。');
      const settings=dbResult(await admin.from('rise_drive_settings').select('*').eq('id',true).maybeSingle());
      if(!settings?.enabled)throw new Problem(409,'管理員尚未啟用 Google Drive。');
      const raw=await limitedBody(req,MAX+65536);
      const form=await new Response(raw,{headers:{'Content-Type':req.headers.get('content-type')||''}}).formData();
      const file=form.get('file');
      if(!(file instanceof File)||!TYPES[file.type]||!file.size||file.size>MAX||file.name.length>255)throw new Problem(400,'請上傳 PDF、JPG、PNG 或 WebP，每份不超過 5 MB。');
      if(!validSignature(new Uint8Array(await file.slice(0,16).arrayBuffer()),file.type))throw new Problem(400,'檔案內容與類型不符，請重新匯出圖片或 PDF。');
      const token=await accessToken(), driveId=await newDriveId(token), id=crypto.randomUUID();
      dbResult(await admin.rpc('rise_drive_reserve',{p_user:user.id,p_id:id,p_drive_id:driveId,p_name:file.name,p_mime:file.type,p_bytes:file.size}));
      // 先登記固定 ID。即使上傳回應遺失，也保留清除所需資訊。
      const boundary='rise_'+crypto.randomUUID();
      const metadata={id:driveId,name:id+'.'+TYPES[file.type],parents:[settings.folder_id],appProperties:{riseOwner:user.id,riseAttachment:id}};
      const body=new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',JSON.stringify(metadata),'\r\n--'+boundary+'\r\nContent-Type: '+file.type+'\r\n\r\n',file,'\r\n--'+boundary+'--\r\n']);
      await googleOK(await google(token,'upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body}));
      dbResult(await admin.from('rise_drive_files').update({status:'ready'}).eq('id',id));
      return json({provider:'google-drive',path:id,name:file.name});
    }
    if(action==='download') {
      const args=JSON.parse(await (await limitedBody(req,4096)).text());
      if(!UUID.test(args.id||''))throw new Problem(400,'附件編號不正確。');
      const record=dbResult(await admin.from('rise_drive_files').select('*').eq('id',args.id).maybeSingle());
      if(!record||(record.user_id!==user.id&&profile.role!=='admin'))throw new Problem(404,'找不到附件或沒有存取權限。');
      if(record.status!=='ready')throw new Problem(409,'附件尚未完成上傳。');
      const token=await accessToken();
      const download=await googleOK(await google(token,'drive/v3/files/'+encodeURIComponent(record.drive_id)+'?alt=media'));
      headers.set('Content-Type','application/octet-stream');
      headers.set('Content-Disposition',"attachment; filename=\"proof\"; filename*=UTF-8''"+encodeURIComponent(record.original_name).replace(/'/g,'%27'));
      return new Response(download.body,{headers});
    }
    if(action==='purge-mine') {
      if(profile.role==='admin')throw new Problem(403,'管理員帳號不能自行刪除。');
      dbResult(await signed.rpc('rise_drive_prepare_delete'));
      const files=dbResult(await admin.from('rise_drive_files').select('id,drive_id').eq('user_id',user.id).limit(10));
      if(files.length){
        const token=await accessToken();
        for(const file of files){
          const result=await google(token,'drive/v3/files/'+encodeURIComponent(file.drive_id),{method:'DELETE'});
          if(result.status!==404)await googleOK(result);
          dbResult(await admin.from('rise_drive_files').delete().eq('id',file.id).eq('user_id',user.id));
        }
      }
      return json({removed:files.length,more:files.length===10});
    }
    throw new Problem(400,'未知操作。');
  } catch(error) {
    if(error instanceof Problem)return json({error:error.message},error.status);
    if(error instanceof Error && /timeout|abort/i.test(error.name))return json({error:'連線逾時，請稍後重試；若剛上傳附件，請先確認申請狀態。'},504);
    return json({error:'附件服務未完成操作，請確認函式部署與設定。'},500);
  }
}
Deno.serve(handler);

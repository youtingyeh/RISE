import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,normalize,extname} from 'node:path';
import {createRequire} from 'node:module';
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
export function serve(root){
 const server=createServer(async(req,res)=>{
  try{
   let p=decodeURIComponent(new URL(req.url,'http://x').pathname);if(p.endsWith('/'))p+='index.html';
   const file=normalize(join(root,p));if(!file.startsWith(root))throw Error('outside');
   const body=await readFile(file);res.writeHead(200,{'content-type':TYPES[extname(file)]||'application/octet-stream'});res.end(body);
  }catch{res.writeHead(404,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><title>404 找不到頁面</title><h1>404</h1>');}
 });
 return new Promise(r=>server.listen(0,'127.0.0.1',()=>r({server,url:'http://127.0.0.1:'+server.address().port+'/',close:()=>new Promise(x=>server.close(x))})));
}
// 實際點擊連結，確認到達指定目的頁且標題含預期文字。不信任任何文字說明，只看瀏覽器實際結果。
export async function clickCheck({baseUrl,page,text,target,title}){
 let chromium;try{({chromium}=await import('playwright').catch(()=>createRequire(import.meta.url)('playwright')));}catch{return {ok:false,inconclusive:true,reason:'playwright 未安裝，無法判定'};}
 const browser=await chromium.launch();
 try{
  const ctx=await browser.newContext({viewport:{width:1366,height:900}});const pg=await ctx.newPage();
  const base=new URL(baseUrl);
  await pg.route('**/*',r=>new URL(r.request().url()).origin===base.origin?r.continue():r.abort());
  await pg.goto(new URL(page,baseUrl).href,{waitUntil:'load'});await pg.waitForTimeout(400);
  const all=await pg.locator('a:visible').evaluateAll((els,t)=>els.filter(e=>e.textContent.replace(/\s+/g,' ').trim()===t).length,text);
  if(all===0)return {ok:false,inconclusive:true,reason:'頁面上找不到可見的連結文字：'+text};
  const el=pg.locator('a:visible').filter({hasText:new RegExp('^\\s*'+text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*$')}).first();
  await Promise.all([pg.waitForLoadState('load').catch(()=>{}),el.click()]);await pg.waitForTimeout(400);
  const landed=new URL(pg.url());const t=await pg.title();
  const pathOk=landed.pathname.endsWith('/'+target)||landed.pathname===('/'+target);
  const titleOk=t.includes(title);
  return {ok:pathOk&&titleOk,landed:landed.pathname,title:t,expected:{target,title}};
 }catch(e){return {ok:false,inconclusive:true,reason:'瀏覽器檢查失敗：'+String(e.message).slice(0,120)};}
 finally{await browser.close();}
}

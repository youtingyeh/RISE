'use strict';
window.RISE_VIDEO_MANAGER=async function({client,user,profile,root,report}){
 if(profile.role!=='admin'||!user.email_confirmed_at)return;
 const box=document.createElement('section');box.className='auth-card';box.id='video-management';
 root.prepend(box);
 const fields=[['title','影片標題',160],['youtubeId','YouTube 網址或影片 ID',300],['summary','影片簡介',10000],['speaker','講者',160],['level','程度',160],['duration','片長（例如 12:30）',80],['question','觀看前引導問題',4000],['reflection','觀看後反思',4000]];
 box.innerHTML='<h2>影音探索管理</h2><p>新增或更新 YouTube 影片，勾選發布後會顯示在影音探索。取消發布即可下架。</p><a href="explore.html">查看影音探索 →</a><p id="vm-status" role="status"></p><form id="vm-form"><label>學科<select name="subject"><option value="math">數學</option><option value="physics">物理</option><option value="chemistry">化學</option></select></label>'+fields.map(([key,label,max])=>'<div class="auth-field"><label for="vm-'+key+'">'+label+'</label>'+(max>=4000?'<textarea rows="3"':'<input type="text"')+' id="vm-'+key+'" name="'+key+'" maxlength="'+max+'" '+(['title','youtubeId'].includes(key)?'required':'')+'>'+(max>=4000?'</textarea>':'')+'</div>').join('')+'<label>顯示順序<input name="sort_order" type="number" min="-2147483648" max="2147483647" value="0" required></label><label><input name="published" type="checkbox">發布至影音探索</label><div class="auth-actions"><button type="submit">儲存影片</button><button type="button" id="vm-new">新增另一部影片</button></div></form><h3>已建立的影片</h3><button type="button" id="vm-refresh">重新整理</button><div id="vm-list"></div><div class="auth-actions"><button id="vm-prev" type="button">上一頁</button><button id="vm-next" type="button">下一頁</button></div>';
 const form=box.querySelector('form'),status=box.querySelector('#vm-status');
 let editing=null,busy=false,offset=0,seq=0;
 const checked=r=>{if(r.error)throw r.error;return r.data;};
 const fail=e=>{status.textContent=['42P01','PGRST205','PGRST204'].includes(e.code)?'影片管理尚未啟用：請在 Supabase SQL Editor 執行 backend/video-management.sql。':e.code==='42501'?'目前帳號沒有影片管理權限。':e.message||'儲存失敗，請重試。';};
 async function list(){
  const request=++seq;
  try{
   const rows=checked(await client.from('rise_explore_videos').select('*').order('sort_order').order('id').range(offset,offset+20));
   if(request!==seq)return;
   const target=box.querySelector('#vm-list');target.replaceChildren();
   for(const row of rows.slice(0,20)){
    const item=document.createElement('p'),button=document.createElement('button');
    button.type='button';button.textContent='編輯：'+row.title+'（'+(row.published?'已發布':'未發布')+'）';
    button.onclick=()=>{if(busy)return;editing=row.id;for(const key of ['subject','sort_order',...fields.map(f=>f[0])])form.elements.namedItem(key).value=row[key]??'';form.elements.published.checked=row.published;status.textContent='正在編輯：'+row.title;form.scrollIntoView({block:'start',behavior:'smooth'});};
    item.append(button);target.append(item);
   }
   if(!rows.length)target.textContent='目前沒有影片。';
   box.querySelector('#vm-prev').disabled=offset===0;box.querySelector('#vm-next').disabled=rows.length<=20;
  }catch(e){fail(e);}
 }
 form.onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const data=Object.fromEntries(new FormData(form));
  for(const [key] of fields)data[key]=String(data[key]||'').trim();
  try{
   data.youtubeId=window.RISE_PARSE_YOUTUBE(data.youtubeId);
   if(!data.title)throw Error('請填寫影片標題。');
   data.published=form.elements.published.checked;data.sort_order=Number(data.sort_order);
   if(!Number.isInteger(data.sort_order)||Math.abs(data.sort_order)>2147483647)throw Error('顯示順序必須是有效整數。');
   busy=true;for(const input of form.elements)input.disabled=true;
   status.textContent='正在儲存…';
   const result=editing?await client.from('rise_explore_videos').update(data).eq('id',editing).select('id'):await client.from('rise_explore_videos').insert(data).select('id');
   const saved=checked(result);if(!saved?.length)throw Error('未更新任何影片，請重新確認管理員資格。');
   editing=saved[0].id;status.textContent=data.published?'影片已發布，可到影音探索查看。':'影片已儲存，未發布的影片不會顯示給學生。';
   await list();
  }catch(e){fail(e);}finally{busy=false;for(const input of form.elements)input.disabled=false;}
 };
 box.querySelector('#vm-new').onclick=()=>{if(busy)return;editing=null;form.reset();status.textContent='新增影片';};
 box.querySelector('#vm-refresh').onclick=list;
 box.querySelector('#vm-prev').onclick=()=>{if(busy)return;offset=Math.max(0,offset-20);list();};
 box.querySelector('#vm-next').onclick=()=>{if(busy)return;offset+=20;list();};
 await list();
};
window.RISE_PARSE_YOUTUBE=function(raw){
 let id=raw.trim();
 if(!/^[A-Za-z0-9_-]{11}$/.test(id)){
  let url;try{url=new URL(id);}catch{throw Error('請填寫有效的 YouTube 網址或 11 字元影片 ID。');}
  if(url.protocol!=='https:'||!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(url.hostname))throw Error('僅接受 HTTPS YouTube 影片網址。');
  id=url.hostname==='youtu.be'?url.pathname.slice(1):url.pathname==='/watch'?url.searchParams.get('v'): /^\/(shorts|embed|live)\//.test(url.pathname)?url.pathname.split('/')[2]:'';
 }
 if(!/^[A-Za-z0-9_-]{11}$/.test(id||''))throw Error('YouTube 影片 ID 不正確。');
 return id;
};

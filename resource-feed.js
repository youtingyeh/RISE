(async()=>{
 'use strict';
 const host=document.querySelector('[data-resource-feed]');if(!host)return;
 const subjects={all:'全部學科',math:'數學',physics:'物理',chemistry:'化學',multiple:'跨學科'};
 const kinds={all:'全部資源',article:'閱讀文章',video:'影片學習',material:'教材練習'};
 const params=new URLSearchParams(location.search);
 let subject=host.dataset.subject||params.get('subject')||'all';if(!subjects[subject])subject='all';
 let kind='all',offset=0,request=0;
 function load(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.append(s);});}
 host.innerHTML='<p role="status">正在讀取已發布教材…</p>';
 try{
  if(!window.RISE_AUTH_CONFIG)await load('auth-config.js');
  if(!window.supabase)await load('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js');
  const cfg=window.RISE_AUTH_CONFIG,db=window.supabase.createClient(cfg.url,cfg.publishableKey);
  const learning=host.dataset.resourceFeed==='learning';
  host.innerHTML=`<div class="resource-feed-controls"><label>選擇學科 <select id="feed-subject"></select></label><label>${learning?'學習方式':'資源類型'} <select id="feed-kind"></select></label><button type="button" id="feed-refresh" class="button secondary">重新整理教材</button></div><p id="feed-status" role="status" aria-live="polite"></p><div id="feed-list" class="card-grid"></div><div class="actions"><button type="button" id="feed-prev" class="button secondary">上一頁</button><button type="button" id="feed-next" class="button secondary">下一頁</button><a href="resources.html" class="text-link">前往完整教學資源庫 →</a></div>`;
  const $=s=>host.querySelector(s);
  for(const [value,label]of Object.entries(subjects))$('#feed-subject').add(new Option(label,value));
  for(const [value,label]of Object.entries(kinds))$('#feed-kind').add(new Option(label,value));
  $('#feed-subject').value=subject;$('#feed-kind').value=kind;
  async function draw(){
   const seq=++request;$('#feed-status').textContent='正在讀取…';$('#feed-prev').disabled=true;$('#feed-next').disabled=true;
   try{
    let query=db.from('rise_teaching_resources').select('id,title,summary,subject,kind,updated_at').eq('status','published').order('updated_at',{ascending:false}).order('id');
    if(subject!=='all')query=query.eq('subject',subject);
    if(kind!=='all')query=query.eq('kind',kind);
    const result=await query.range(offset,offset+12);if(seq!==request)return;if(result.error)throw result.error;
    const rows=result.data;$('#feed-list').replaceChildren();
    for(const r of rows.slice(0,12)){
     const card=document.createElement('article');card.className='member '+r.subject;
     const badge=document.createElement('p');badge.className='eyebrow';badge.textContent=(subjects[r.subject]||'跨學科')+' · '+(kinds[r.kind]||'資源');
     const title=document.createElement('h3');title.textContent=r.title;
     const summary=document.createElement('p');summary.textContent=r.summary;
     const link=document.createElement('a');link.className='button secondary';link.href='resources.html?id='+encodeURIComponent(r.id);link.textContent='開啟教材';card.append(badge,title,summary,link);$('#feed-list').append(card);
    }
    $('#feed-status').textContent=rows.length?`第 ${offset/12+1} 頁 · ${subjects[subject]}／${kinds[kind]}，依最近更新排列。`:'此分類尚無已發布教材，請切換學科或資源類型。';
    $('#feed-prev').disabled=offset===0;$('#feed-next').disabled=rows.length<=12;
   }catch(e){if(seq!==request)return;$('#feed-list').replaceChildren();$('#feed-status').textContent=['PGRST205','42P01'].includes(e.code)?'教材庫尚未啟用，請管理員執行 teaching-resources.sql。':'暫時無法讀取教材，請按重新整理再試。';}
  }
  $('#feed-subject').onchange=()=>{subject=$('#feed-subject').value;offset=0;draw();};
  $('#feed-kind').onchange=()=>{kind=$('#feed-kind').value;offset=0;draw();};
  document.querySelectorAll('[data-learning-kind]').forEach(b=>b.onclick=()=>{kind=b.dataset.learningKind;$('#feed-kind').value=kind;offset=0;draw();host.scrollIntoView({behavior:'smooth',block:'start'});});
  $('#feed-prev').onclick=()=>{offset=Math.max(0,offset-12);draw();};$('#feed-next').onclick=()=>{offset+=12;draw();};$('#feed-refresh').onclick=draw;
  await draw();
 }catch{host.textContent='教材連線暫時無法載入，請重新整理頁面。';}
})();

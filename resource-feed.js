(async()=>{
 'use strict';
 const host=document.querySelector('[data-resource-feed]');if(!host)return;
 const subjects={all:'全部學科',math:'數學',physics:'物理',chemistry:'化學',multiple:'跨學科'};
 const kinds={all:'全部類型',article:'文章',video:'影片',material:'教材'};
 const destination=host.dataset.resourceFeed==='learning'?'learning':'science';
 const noun=destination==='learning'?'學習單元':'探索主題';
 let subject=host.dataset.subject||new URLSearchParams(location.search).get('subject')||'all';if(!subjects[subject])subject='all';
 let kind='all',offset=0,request=0,detailRequest=0;
 function load(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.append(s);});}
 host.innerHTML='<p role="status">正在載入…</p>';
 try{
  if(!window.RISE_AUTH_CONFIG)await load('auth-config.js');
  if(!window.supabase)await load('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js');
  const cfg=window.RISE_AUTH_CONFIG,db=window.supabase.createClient(cfg.url,cfg.publishableKey),$=s=>host.querySelector(s);
  host.innerHTML=`<div class="resource-feed-controls"><label>學科 <select id="feed-subject"></select></label><label>內容類型 <select id="feed-kind"></select></label><button type="button" id="feed-refresh" class="button secondary">重新整理</button></div><p id="feed-status" role="status" aria-live="polite"></p><div id="feed-list" class="card-grid"></div><section id="feed-detail" class="note" hidden></section><div class="actions"><button type="button" id="feed-prev" class="button secondary">上一頁</button><button type="button" id="feed-next" class="button secondary">下一頁</button><a class="text-link" href="resources.html?destination=${destination}">前往此區教學資源 →</a></div>`;
  for(const [v,label]of Object.entries(subjects))$('#feed-subject').add(new Option(label,v));
  for(const [v,label]of Object.entries(kinds))$('#feed-kind').add(new Option(label,v));$('#feed-subject').value=subject;
  function failure(e){return ['PGRST202','PGRST205','42P01'].includes(e.code)?'主題與單元功能尚未啟用，請管理員執行 resource-placement.sql。':'暫時無法載入，請重新整理再試。';}
  async function openGroup(group,page=0){
   const seq=++detailRequest,box=$('#feed-detail');box.hidden=false;box.textContent='正在讀取單元內容…';
   try{
    const result=await db.rpc('rise_resource_group_items',{p_owner:group.owner_id,p_destination:destination,p_collection:group.collection,p_subject:group.subject,p_kind:kind,p_offset:page*12});if(seq!==detailRequest)return;if(result.error)throw result.error;
    const rows=result.data;box.replaceChildren();const heading=document.createElement('h3');heading.textContent=group.collection;
    const close=document.createElement('button');close.type='button';close.className='button secondary';close.textContent='收起';close.onclick=()=>{++detailRequest;box.replaceChildren();box.hidden=true;};box.append(heading,close);
    const list=document.createElement('ol');list.start=page*12+1;
    for(const r of rows.slice(0,12)){
     const item=document.createElement('li'),a=document.createElement('a'),summary=document.createElement('p');a.href='resources.html?id='+encodeURIComponent(r.id);a.textContent=(kinds[r.kind]||'教材')+'｜'+r.title;summary.textContent=r.summary;item.append(a,summary);list.append(item);
    }
    box.append(list);if(!rows.length){const p=document.createElement('p');p.textContent='此單元目前沒有符合條件的已發布內容。';box.append(p);}
    const prev=document.createElement('button'),next=document.createElement('button');prev.type=next.type='button';prev.className=next.className='button secondary';prev.textContent='上一頁內容';next.textContent='下一頁內容';prev.disabled=page===0;next.disabled=rows.length<=12;prev.onclick=()=>openGroup(group,page-1);next.onclick=()=>openGroup(group,page+1);box.append(prev,' ',next);box.scrollIntoView({behavior:'smooth',block:'nearest'});
   }catch(e){if(seq===detailRequest)box.textContent=failure(e);}
  }
  async function draw(){
   const seq=++request;++detailRequest;$('#feed-detail').hidden=true;$('#feed-detail').replaceChildren();$('#feed-status').textContent='正在讀取…';$('#feed-prev').disabled=$('#feed-next').disabled=true;
   try{
    const result=await db.rpc('rise_resource_groups',{p_destination:destination,p_subject:subject,p_kind:kind,p_offset:offset});if(seq!==request)return;if(result.error)throw result.error;
    const rows=result.data;$('#feed-list').replaceChildren();
    for(const group of rows.slice(0,12)){
     const card=document.createElement('article');card.className='member '+group.subject;
     const badge=document.createElement('p');badge.className='eyebrow';badge.textContent=subjects[group.subject]+' · '+noun;
     const title=document.createElement('h3');title.textContent=group.collection;
     const count=document.createElement('p');count.textContent=`${group.item_count} 份符合條件的內容`;
     const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent='展開'+noun;button.onclick=()=>openGroup(group);card.append(badge,title,count,button);$('#feed-list').append(card);
    }
    $('#feed-status').textContent=rows.length?`第 ${offset/12+1} 頁 · 依教師設定的順序呈現${noun}。`:`尚無符合條件的已發布${noun}。`;
    $('#feed-prev').disabled=offset===0;$('#feed-next').disabled=rows.length<=12;
   }catch(e){if(seq!==request)return;$('#feed-list').replaceChildren();$('#feed-status').textContent=failure(e);}
  }
  $('#feed-subject').onchange=()=>{subject=$('#feed-subject').value;offset=0;draw();};$('#feed-kind').onchange=()=>{kind=$('#feed-kind').value;offset=0;draw();};
  document.querySelectorAll('[data-learning-kind]').forEach(b=>b.onclick=()=>{kind=b.dataset.learningKind;$('#feed-kind').value=kind;offset=0;draw();host.scrollIntoView({behavior:'smooth',block:'start'});});
  $('#feed-prev').onclick=()=>{offset=Math.max(0,offset-12);draw();};$('#feed-next').onclick=()=>{offset+=12;draw();};$('#feed-refresh').onclick=draw;await draw();
 }catch{host.textContent='教材連線暫時無法載入，請重新整理。';}
})();

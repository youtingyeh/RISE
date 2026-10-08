'use strict';
window.RISE_ADMIN_FEATURES=async function({root,user,profile}){
 if(!root||profile.role!=='admin'||!user.email_confirmed_at)return;
 const api=window.RISE_FEATURES;if(!api){root.textContent='開放設定未載入，請重新整理。';return;}
 let busy=false,notice='';
 const basic=new Set(['science','videos','questions','schedule']);
 const node=(tag,text,parent)=>{const e=document.createElement(tag);e.textContent=text;parent.append(e);return e;};
 function render(){
  const s=api.state,focus=document.activeElement?.id;root.replaceChildren();
  node('h2','網站功能開放設定',root);
  node('p','關閉會隱藏導覽與功能入口，直接開啟該頁會顯示籌備中。管理員仍能預覽與準備內容；不會刪除資料，也不會改變會員角色。',root);
  const note=node('p',notice,root);note.className='site-feature-status';note.setAttribute('role','status');
  const actions=node('div','',root);actions.className='site-feature-actions';
  const reload=node('button','重新讀取設定',actions);reload.type='button';reload.disabled=busy;reload.onclick=()=>api.refresh();
  if(s.status!=='ready'||!s.admin){
   node('p',s.status==='missing'?'尚未安裝開放設定。請在 Supabase SQL Editor 執行 backend/site-features.sql；目前維持原有功能。':s.status==='error'?'設定讀取失敗，請確認登入狀態與網路後重試。':'正在確認管理員與開放設定…',root);
   return;
  }
  async function save(changes,expected){
   if(busy)return;busy=true;notice='正在儲存…';render();
   try{await api.save(changes,expected);notice='已儲存。新開啟的頁面會讀取新設定；已開啟頁面最遲約 1 分鐘內更新，或切回該分頁更新。';}
   catch(e){notice=e.code==='40001'?'其他管理員已修改設定。本次沒有覆蓋，已重新讀取，請確認後重試。':e.code==='42501'?'沒有修改權限，請重新確認管理員身分。':'儲存結果尚未確認，已嘗試重新讀取；請確認開關狀態後再操作。';await api.refresh();}
   finally{busy=false;render();}
  }
  const simple=node('button','套用精簡模式',actions);simple.type='button';simple.disabled=busy;
  simple.onclick=()=>{if(confirm('精簡模式只開放科學探索、影音探索、學生提問及重要日程，其餘可切換區域將關閉。首頁、關於計畫、核心團隊、會員中心與管理工具不受影響。資料不會刪除。確定套用？'))save(Object.fromEntries(api.catalog.map(([k])=>[k,basic.has(k)])),s.version);};
  const all=node('button','全部開放',actions);all.type='button';all.disabled=busy;
  all.onclick=()=>{if(confirm('確定開放全部功能入口？尚無內容的區域也會顯示。'))save(Object.fromEntries(api.catalog.map(([k])=>[k,true])),s.version);};
  node('p','目前開放 '+api.catalog.filter(([k])=>s.flags[k]).length+'／'+api.catalog.length+' 個區域。個別開關按下即儲存。',root);
  const list=node('div','',root);list.className='site-feature-list';
  for(const [key,title,help] of api.catalog){
   const row=node('div','',list);row.className='site-feature-row';const copy=node('div','',row);node('h3',title,copy);node('p',help,copy);
   const button=node('button',s.flags[key]?'已開放':'未開放',row);button.id='site-toggle-'+key;button.type='button';button.setAttribute('role','switch');button.setAttribute('aria-checked',String(s.flags[key]));button.setAttribute('aria-label',title);button.disabled=busy;
   button.onclick=()=>save({[key]:!s.flags[key]},s.version);
  }
  if(focus?.startsWith('site-toggle-'))document.getElementById(focus)?.focus();
 }
 const listener=()=>{if(root.isConnected)render();else window.removeEventListener('rise-features-change',listener);};
 window.addEventListener('rise-features-change',listener);render();await api.refresh();
};

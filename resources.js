(() => {
  'use strict';
  const cfg=window.RISE_AUTH_CONFIG||{},root=document.querySelector('#auth-root'),status=document.querySelector('#auth-status');
  let db,user,profile,editing=null,files=[],pendingId=null,dirty=false,offset=0,mode='published',busy=false;
  let destination='science',selected=[];
  const types={'pdf':'application/pdf','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png','webp':'image/webp','mp4':'video/mp4','webm':'video/webm'};
  const labels={math:'數學',physics:'物理',chemistry:'化學',multiple:'跨學科',article:'文章',material:'教材',video:'影片',draft:'草稿',published:'已發布'};
  const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const canEdit=()=>!!user?.email_confirmed_at&&['teacher','admin'].includes(profile?.role);
  const owns=r=>canEdit()&&(r.owner_id===user.id||profile.role==='admin');
  function checked(r){if(r.error)throw r.error;return r.data;}
  function tell(message,error=false){status.textContent=message;status.style.color=error?'#a51c30':'';}
  function errorMessage(e){if(['PGRST202','PGRST205','42P01','42703'].includes(e.code))return '教材分類尚未完成設定。請確認已安裝 teaching-resources.sql，再執行 backend/resource-placement.sql。';const text=String(e.message||e);return text.startsWith('rise:')?text.slice(5):'操作未完成，請確認網路、登入狀態及後端設定後重試。';}
  function yt(value){if(!value.trim())return '';let url;try{url=new URL(value.trim());}catch{throw Error('rise:請貼上完整 YouTube 網址。');}const host=url.hostname.toLowerCase();let id='';if(!['https:','http:'].includes(url.protocol))throw Error('rise:YouTube 網址不正確。');if(host==='youtu.be')id=url.pathname.slice(1).split('/')[0];else if(['youtube.com','www.youtube.com','m.youtube.com'].includes(host))id=url.searchParams.get('v')||url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1]||'';if(!/^[\w-]{11}$/.test(id))throw Error('rise:無法辨識 YouTube 影片，請確認連結。');return id;}
  function protectedLogin(){return `<a href="login.html?next=${encodeURIComponent('resources.html'+location.search)}">登入後觀看影片或下載教材</a>`;}
  async function list(){
    const box=$('#resource-list');box.textContent='讀取中…';
    let query=db.from('rise_teaching_resources').select('*').eq('destination',destination).order('group_order').order('collection').order('item_order').order('created_at').order('id');
    if(mode==='published')query=query.eq('status','published');
    else if(profile.role!=='admin')query=query.eq('owner_id',user.id);
    const rows=checked(await query.range(offset,offset+12));box.replaceChildren();
    if(!rows.length)box.textContent=mode==='published'?'尚無已發布資源。':'尚未建立內容，請按「新增資源」。';
    for(const r of rows.slice(0,12)){
      const card=document.createElement('article');card.className='auth-card';
      card.innerHTML=`<p class="eyebrow">科學探索· ${esc(r.collection)} · ${esc(labels[r.subject])} · ${esc(labels[r.kind])} · ${esc(labels[r.status])}</p><h2>${esc(r.title)}</h2><p>${esc(r.summary)}</p><p class="auth-help">更新：${esc(new Date(r.updated_at).toLocaleDateString('zh-TW'))}</p>`;
      const open=document.createElement('button');open.type='button';open.textContent='閱讀／查看資源';open.onclick=()=>view(r).catch(e=>tell(errorMessage(e),true));card.append(open);
      if(owns(r)&&mode==='manage'){
        const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=selected.some(x=>x.id===r.id);
        check.onchange=()=>{if(busy){check.checked=!check.checked;return;}if(check.checked){if(selected.length>=100){check.checked=false;tell('一次最多整理100份教材。',true);return;}selected.push(r);}else selected=selected.filter(x=>x.id!==r.id);$('#res-organize').textContent='整理所選教材（'+selected.length+'）';};label.append(check,' 選取整理');card.prepend(label);
      }
      if(owns(r)){const edit=document.createElement('button');edit.type='button';edit.className='secondary';edit.textContent='編輯';edit.onclick=()=>editor(r);card.append(' ',edit);}
      box.append(card);
    }
    $('#res-prev').disabled=offset===0;$('#res-next').disabled=rows.length<=12;
  }
  async function view(r){
    if(user?.email_confirmed_at){try{checked(await db.rpc('rise_record_resource_visit',{p_resource_id:r.id}));}catch{tell('資源瀏覽紀錄暫時無法儲存。',true);}}
    const url=new URL(location.href);url.searchParams.set('id',r.id);history.replaceState(null,'',url);
    const box=$('#resource-detail');box.hidden=false;box.replaceChildren();
    const title=document.createElement('h2');title.textContent=r.title;
    const close=document.createElement('button');close.type='button';close.className='secondary';close.textContent='關閉閱讀';close.onclick=()=>{box.replaceChildren();box.hidden=true;const u=new URL(location.href);u.searchParams.delete('id');history.replaceState(null,'',u);};
    const body=document.createElement('div');body.className='resource-article';body.textContent=r.body;box.append(close,title,body);
    if(!user?.email_confirmed_at&&(r.youtube_id||r.files.length)){const p=document.createElement('p');p.innerHTML=protectedLogin();box.append(p);}
    if(user?.email_confirmed_at){
      if(r.youtube_id){const frame=document.createElement('iframe');frame.src='https://www.youtube-nocookie.com/embed/'+r.youtube_id;frame.title=r.title;frame.className='resource-video';frame.allow='fullscreen; picture-in-picture';frame.referrerPolicy='strict-origin-when-cross-origin';frame.allowFullscreen=true;box.append(frame);}
      for(const f of r.files){
        const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=(f.type.startsWith('video/')?'播放：':'下載：')+f.name;
        button.onclick=async()=>{button.disabled=true;try{
          // 每次取得短期網址均經 Storage RLS；不儲存永久公開連結。
          const signed=checked(await db.storage.from('rise-teaching-files').createSignedUrl(f.path,300,{download:!f.type.startsWith('video/')?f.name:undefined}));
          if(f.type.startsWith('video/')){const v=document.createElement('video');v.controls=true;v.preload='metadata';v.src=signed.signedUrl;v.className='resource-video';box.append(v);v.scrollIntoView({block:'nearest'});}
          else{const a=document.createElement('a');a.href=signed.signedUrl;a.rel='noopener';a.target='_blank';a.click();}
        }catch(e){tell(errorMessage(e),true);}finally{button.disabled=false;}};
        const p=document.createElement('p');p.append(button);box.append(p);
      }
    }
    box.scrollIntoView({block:'start',behavior:'smooth'});
  }
  function organizer(){
    if(!canEdit()||busy)return;
    if(!selected.length){tell('請先切到「管理草稿與已發布內容」，勾選要整理的教材。');return;}
    if(dirty&&!confirm('放棄尚未儲存的編輯，改為整理版面？'))return;
    dirty=false;$('#resource-editor').hidden=true;$('#resource-editor').replaceChildren();
    const box=$('#resource-organizer');box.hidden=false;
    box.innerHTML=`<h2>整理教材版面</h2><p>將所選教材歸入同一主題／單元，按上下按鈕調整順序。此操作不會改變草稿或發布狀態。</p><form id="organize-form"><div class="resource-fields"><label>發布區域<select id="organize-destination"><option value="science">科學探索</option></select></label><label>主題／單元名稱<input id="organize-collection" required maxlength="100" value="${esc(selected[0].collection||'')}"></label><label>主題／單元排序<input id="organize-order" type="number" min="0" max="999999" step="1" value="${selected[0].group_order||0}"></label></div><p class="auth-help">每位教師、每個學科的單元會分開顯示。要調整整個單元，請選取其中全部教材。</p><ol id="organize-list"></ol><button type="submit">套用歸類與順序</button> <button type="button" id="organize-close" class="secondary">關閉</button><p id="organize-status" role="status"></p></form>`;
    $('#organize-destination').value=selected[0].destination||destination;
    function draw(){const list=$('#organize-list');list.replaceChildren();selected.forEach((r,index)=>{const row=document.createElement('li');row.className='resource-organize-row';const title=document.createElement('span');title.textContent=r.title+' · '+labels[r.subject];row.append(title);
      for(const [label,delta]of [['上移',-1],['下移',1]]){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;b.setAttribute('aria-label',label+'：'+r.title);b.disabled=index+delta<0||index+delta>=selected.length;b.onclick=()=>{[selected[index],selected[index+delta]]=[selected[index+delta],selected[index]];draw();};row.append(b);}list.append(row);});}
    draw();$('#organize-close').onclick=()=>{box.hidden=true;};
    $('#organize-form').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;const controls=[...box.querySelectorAll('input,select,button')];controls.forEach(c=>c.disabled=true);const note=$('#organize-status');
      try{checked(await db.rpc('rise_organize_resources',{p_changes:selected.map((r,index)=>({id:r.id,version:r.version,position:index+1})),p_destination:$('#organize-destination').value,p_collection:$('#organize-collection').value.trim(),p_group_order:Number($('#organize-order').value)}));selected=[];$('#res-organize').textContent='整理所選教材（0）';note.textContent='歸類與順序已更新。';box.hidden=true;tell(note.textContent);await list();}
      catch(error){note.textContent=errorMessage(error);}
      finally{busy=false;controls.forEach(c=>c.disabled=false);}
    };box.scrollIntoView({block:'start',behavior:'smooth'});
  }
  function editor(r=null){
    if(!canEdit()||(r&&!owns(r)))return;
    if(busy)return;
    if(dirty&&!confirm('放棄目前尚未儲存的編輯？'))return;
    editing=r;files=(r?.files||[]).map(f=>({...f}));pendingId=r?.id||crypto.randomUUID();dirty=false;
    const box=$('#resource-editor');box.hidden=false;$('#resource-organizer').hidden=true;
    box.innerHTML=`<h2>${r?'編輯資源':'新增資源'}</h2><form id="res-form">
      <div class="resource-fields"><div class="auth-field"><label for="res-destination">發布區域</label><select id="res-destination"><option value="science">科學探索（主題）</option></select></div>
      <div class="auth-field"><label for="res-collection">主題／單元名稱</label><input id="res-collection" required maxlength="100" placeholder="例如：牛頓運動定律" value="${esc(r?.collection||'')}"><p class="auth-help">同一學科、同一名稱的教材會收在同一張單元卡片內。</p></div></div>
      <div class="resource-fields"><div class="auth-field"><label for="res-group-order">主題／單元排序</label><input id="res-group-order" type="number" min="0" max="999999" step="1" value="${r?.group_order||0}"></div><div class="auth-field"><label for="res-item-order">單元內教材排序</label><input id="res-item-order" type="number" min="0" max="999999" step="1" value="${r?.item_order||0}"></div></div><p class="auth-help">數字越小越前。也可儲存後選取多份教材，使用上下按鈕整理順序。</p>
      <div class="auth-field"><label for="res-title">標題</label><input id="res-title" required maxlength="160" value="${esc(r?.title)}"></div>
      <div class="resource-fields"><div class="auth-field"><label for="res-subject">學科</label><select id="res-subject">${['math','physics','chemistry','multiple'].map(k=>`<option value="${k}">${labels[k]}</option>`).join('')}</select></div>
      <div class="auth-field"><label for="res-kind">類型</label><select id="res-kind">${['article','material','video'].map(k=>`<option value="${k}">${labels[k]}</option>`).join('')}</select></div></div>
      <div class="auth-field"><label for="res-summary">簡介（最多500字）</label><textarea id="res-summary" maxlength="500" rows="3">${esc(r?.summary)}</textarea></div>
      <div class="auth-field"><label for="res-body">文章／教材說明</label><textarea id="res-body" maxlength="50000" rows="15">${esc(r?.body)}</textarea><p class="auth-help">可直接撰寫文字與段落，換行會保留；不接受 HTML 程式碼。</p></div>
      <div class="auth-field"><label for="res-youtube">YouTube 影片網址（選填）</label><input id="res-youtube" type="url" placeholder="https://www.youtube.com/watch?v=…" value="${r?.youtube_id?'https://www.youtube.com/watch?v='+esc(r.youtube_id):''}"></div>
      <div class="auth-field"><label for="res-upload">上傳教材／影片</label><input id="res-upload" type="file" multiple accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png,.webp,.mp4,.webm"><p class="auth-help">最多5個附件，每個50 MB。支援 PDF、Word、PowerPoint、圖片、MP4、WebM。大型影片請使用 YouTube 連結。請確認有權公開教材。</p><div id="res-files"></div></div>
      <div class="auth-actions"><button type="submit" name="action" value="draft">儲存草稿${r?.status==='published'?'／下架':''}</button><button type="submit" name="action" value="published">${r?.status==='published'?'更新發布內容':'發布'}</button><button type="button" id="res-preview" class="secondary">預覽文字</button><button type="button" id="res-cancel" class="secondary">關閉編輯</button></div>
      <p id="res-save-status" role="status" aria-live="polite"></p><div id="res-text-preview" class="resource-article" hidden></div></form>`;
    $('#res-destination').value='science';
    $('#res-subject').value=r?.subject||'math';$('#res-kind').value=r?.kind||'article';
    $('#res-form').oninput=()=>dirty=true;
    $('#res-preview').onclick=()=>{const p=$('#res-text-preview');p.hidden=false;p.textContent=$('#res-title').value+'\n\n'+$('#res-summary').value+'\n\n'+$('#res-body').value;};
    $('#res-cancel').onclick=()=>{if(!dirty||confirm('放棄尚未儲存的編輯？')){box.hidden=true;box.replaceChildren();dirty=false;}};
    function drawFiles(){const target=$('#res-files');target.replaceChildren();files.forEach((f,i)=>{const row=document.createElement('p');row.textContent=f.name+' ';const remove=document.createElement('button');remove.type='button';remove.textContent='移除此附件';remove.className='secondary';remove.onclick=()=>{files.splice(i,1);dirty=true;drawFiles();};row.append(remove);target.append(row);});}
    drawFiles();
    $('#res-form').onsubmit=async event=>{
      event.preventDefault();if(busy)return;busy=true;
      const form=event.target,requestedStatus=event.submitter?.value||'draft',note=$('#res-save-status');
      const chosen=[...$('#res-upload').files];const controls=[...form.querySelectorAll('input,select,textarea,button')];controls.forEach(c=>c.disabled=true);
      let saved=null;
      try{
        const youtube_id=yt($('#res-youtube').value);
        if(files.length+chosen.length>5)throw Error('rise:最多五個附件，請先移除部分附件。');
        for(const file of chosen){const ext=file.name.split('.').pop().toLowerCase();if(!types[ext]||!file.size||file.size>52428800||file.name.length>255)throw Error('rise:附件格式不支援、名稱過長或超過50 MB。');}
        for(let i=0;i<chosen.length;i++){
          const file=chosen[i],ext=file.name.split('.').pop().toLowerCase(),path=user.id+'/'+crypto.randomUUID()+'.'+ext;
          note.textContent=`上傳第 ${i+1}／${chosen.length} 個附件中，請勿關閉頁面…`;
          checked(await db.storage.from('rise-teaching-files').upload(path,file,{contentType:types[ext],upsert:false}));files.push({path,name:file.name,type:types[ext]});dirty=true;
        }
        const doc={destination:$('#res-destination').value,collection:$('#res-collection').value.trim(),group_order:Number($('#res-group-order').value),item_order:Number($('#res-item-order').value),title:$('#res-title').value.trim(),summary:$('#res-summary').value.trim(),body:$('#res-body').value,subject:$('#res-subject').value,kind:$('#res-kind').value,status:requestedStatus,youtube_id,files};
        note.textContent='儲存中…';
        saved=checked(await db.rpc('rise_save_resource',{p_id:pendingId,p_expected_version:editing?.version||0,p_document:doc}));
        editing=saved;dirty=false;note.textContent=requestedStatus==='published'?'內容已發布。':'已儲存為草稿，公開列表不會顯示。';
        tell(note.textContent);await list();
      }catch(e){note.textContent=errorMessage(e)+' 已成功上傳的附件會保留；未成功上傳的檔案請重新選取。若提示版本衝突，請關閉並重新開啟資源確認最新內容。';}
      finally{busy=false;controls.forEach(c=>c.disabled=false);$('#res-upload').value='';drawFiles();}
    };
    box.scrollIntoView({block:'start',behavior:'smooth'});
  }
  async function start(){
    try{
      db=window.supabase.createClient(cfg.url,cfg.publishableKey);
      const identity=await db.auth.getUser();user=identity.data?.user;
      if(user)profile=checked(await db.from('rise_profiles').select('role').eq('id',user.id).single());
      const nav=document.querySelector('.auth-nav');
      if(nav){nav.innerHTML=user?'<a href="account.html">我的帳號</a><button type="button" id="resource-logout">登出</button>':'<a href="register.html">註冊</a><a href="login.html?next=resources.html">登入</a>';if(user)$('#resource-logout').onclick=async()=>{if(dirty&&!confirm('尚有未儲存內容，確定登出？'))return;await db.auth.signOut();location.reload();};}
      db.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')location.reload();});
      root.innerHTML=`${canEdit()?'<section class="auth-card"><h2>資源管理</h2><p>教師可管理自己建立的資源；管理員可管理全部內容。</p><div class="auth-actions"><button id="res-new">新增資源</button><button id="res-mode" class="secondary">管理草稿與已發布內容</button><button id="res-organize" class="secondary">整理所選教材（0）</button></div></section>':''}<div class="resource-destinations" aria-label="教學資源區域"><button type="button" id="res-science">科學探索區</div><section id="resource-organizer" class="auth-card" hidden></section><section id="resource-editor" class="auth-card" hidden></section><section id="resource-detail" class="auth-card" hidden></section><h2 id="resource-list-title">已發布資源</h2><div id="resource-list" class="resource-grid"></div><div class="auth-actions"><button id="res-prev">上一頁</button><button id="res-next">下一頁</button></div>`;
      if(canEdit()){$('#res-new').onclick=()=>editor();$('#res-organize').onclick=organizer;$('#res-mode').onclick=()=>{if(busy)return;mode=mode==='published'?'manage':'published';offset=0;$('#resource-list-title').textContent=mode==='published'?'已發布資源':profile.role==='admin'?'全部資源（含草稿）':'我的資源（含草稿）';$('#res-mode').textContent=mode==='published'?'管理草稿與已發布內容':'返回公開列表';list().catch(e=>tell(errorMessage(e),true));};}
      function setDestination(value){if(busy)return;destination=value;offset=0;$('#res-science').setAttribute('aria-pressed',String(value==='science'));$('#res-learning').setAttribute('aria-pressed',String(value==='learning'));list().catch(e=>tell(errorMessage(e),true));}
      $('#res-science').onclick=()=>setDestination('science');
      $('#res-science').setAttribute('aria-pressed',String(destination==='science'));$('#res-learning').setAttribute('aria-pressed',String(destination==='learning'));
      $('#res-prev').onclick=()=>{offset=Math.max(0,offset-12);list().catch(e=>tell(errorMessage(e),true));};$('#res-next').onclick=()=>{offset+=12;list().catch(e=>tell(errorMessage(e),true));};
      window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
      await list();
      const resourceId=new URLSearchParams(location.search).get('id');
      if(resourceId){
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resourceId))throw Error('rise:教材連結不正確。');
        const resource=checked(await db.from('rise_teaching_resources').select('*').eq('id',resourceId).maybeSingle());
        if(resource)await view(resource);else tell('此教材已下架、尚未發布，或你沒有閱讀權限。',true);
      }
    }catch(e){tell(errorMessage(e),true);}
  }
  start();
})();



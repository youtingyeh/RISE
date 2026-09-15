'use strict';
window.RISE_DISCUSSIONS = async function({client,user,profile,root,report}) {
 const teacher=['teacher','admin'].includes(profile.role)&&new URLSearchParams(location.search).get('view')==='teacher';
 const canAnswer=['student','ta'].includes(profile.role);
 const heading=document.querySelector('.auth-heading');
 if(heading){heading.querySelector('h1').textContent=teacher?'討論題管理':'討論題公告欄';const intro=heading.querySelector('h1 + p');if(intro)intro.textContent=teacher?'發布討論題，查看學生回答。':'瀏覽教師公告，選擇感興趣的題目後閱讀並回答。';}
 const $=s=>root.querySelector(s);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const checked=r=>{if(r.error)throw r.error;return r.data;};
 const fail=e=>report(['42P01','PGRST205'].includes(e.code)?'討論功能尚未啟用，請管理員執行 backend/discussions.sql。':e.code==='23505'?'你已提交過這題的回答，請重新整理查看。':'操作未完成，請確認登入狀態、權限與網路後重試。',true);
 let page=0,sequence=0,detailSequence=0;
 root.innerHTML=`${teacher?'<section class="auth-card"><h2>發布討論題</h2><p>發布後，已登入的學生可閱讀並回答。</p><form id="discussion-publish"><div class="auth-field"><label for="discussion-title">題目</label><input id="discussion-title" required maxlength="160"></div><div class="auth-field"><label for="discussion-body">討論內容與回答引導</label><textarea id="discussion-body" required maxlength="10000" rows="6"></textarea></div><button type="submit">發布討論題</button></form></section>':''}<section class="auth-card"><h2>最新討論公告</h2><p>點選公告查看完整題目與回答區。每題可提交一份回答，僅供本人、教師與管理員查看。</p><div id="discussion-list" class="discussion-board"></div><div class="auth-actions"><button id="discussion-prev">上一頁</button><button id="discussion-next">下一頁</button><button id="discussion-refresh">重新整理</button></div></section><section id="discussion-detail" class="auth-card" hidden></section>`;
 async function open(topic,answerPage=0){
  const seq=++detailSequence,box=$('#discussion-detail');box.hidden=false;box.textContent='正在讀取回答…';
  try{
   const fresh=checked(await client.from('rise_discussion_topics').select('*').eq('id',topic.id).single());
 const answerQuery =
  client
    .from('rise_discussion_answers')
    .select('*')
    .eq('topic_id', topic.id);
   const answers=checked(await answerQuery.order('created_at').order('id').range(answerPage*20,answerPage*20+20));
   if(seq!==detailSequence)return;topic=fresh;
   box.innerHTML=`<h2>${esc(topic.title)}</h2><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(topic.body)}</p><p>${topic.closed?'已結束回答':'開放回答中'}</p><h3>${teacher?'學生回答':'我的回答'}</h3><div id="discussion-answers"></div>`;
   const list=$('#discussion-answers');
   for(const a of answers.slice(0,20)){
    const article=document.createElement('article');article.className='auth-record';
    article.innerHTML=`<p>${esc(new Date(a.created_at).toLocaleString('zh-TW'))}${teacher?' · 回答者編號 '+esc(a.user_id):''}</p><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(a.body)}</p>`;list.append(article);
   }
   if(!answers.length)list.textContent=teacher?'尚無學生回答。':'你尚未提交回答。';
   if(teacher){
    const prev=document.createElement('button'),next=document.createElement('button');prev.textContent='上一頁回答';next.textContent='下一頁回答';prev.disabled=answerPage===0;next.disabled=answers.length<=20;prev.onclick=()=>open(topic,answerPage-1);next.onclick=()=>open(topic,answerPage+1);box.append(prev,' ',next);
   }
   if(!teacher&&!topic.closed){
    const form=document.createElement('form');form.innerHTML='<div class="auth-field"><label for="discussion-answer">我的回答</label><textarea id="discussion-answer" required maxlength="10000" rows="6"></textarea></div><button type="submit">提交回答</button>';
    form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button'),body=form.querySelector('textarea').value.trim();if(button.disabled||!body)return;button.disabled=true;try{checked(await client.from('rise_discussion_answers').insert({topic_id:topic.id,body}));report('回答已提交。');await open(topic);}catch(err){fail(err);}finally{button.disabled=false;}};box.append(form);
   }
   if(teacher&&(topic.author_id===user.id||profile.role==='admin')){
    const toggle=document.createElement('button');toggle.textContent=topic.closed?'重新開放回答':'結束回答';
    toggle.onclick=async()=>{toggle.disabled=true;try{const updated=checked(await client.from('rise_discussion_topics').update({closed:!topic.closed}).eq('id',topic.id).select().single());report(updated.closed?'已結束回答。':'已重新開放回答。');await open(updated);}catch(e){fail(e);}finally{toggle.disabled=false;}};box.append(' ',toggle);
   }
   box.scrollIntoView({block:'start',behavior:'smooth'});
  }catch(e){if(seq===detailSequence){box.textContent='回答讀取失敗，請重新開啟討論題。';fail(e);}}
 }
 async function draw(){
  const seq=++sequence;++detailSequence;$('#discussion-detail').hidden=true;$('#discussion-detail').replaceChildren();$('#discussion-list').textContent='正在載入…';$('#discussion-prev').disabled=$('#discussion-next').disabled=true;
  try{
   const rows=checked(await client.from('rise_discussion_topics').select('*').order('created_at',{ascending:false}).order('id').range(page*12,page*12+12));if(seq!==sequence)return;
   $('#discussion-list').replaceChildren();
   for(const topic of rows.slice(0,12)){
    const card=document.createElement('article');card.className='discussion-announcement';card.innerHTML=`<div class="discussion-meta"><time datetime="${esc(topic.created_at)}">${esc(new Date(topic.created_at).toLocaleDateString('zh-TW'))}</time><span class="discussion-badge ${topic.closed?'is-closed':''}">${topic.closed?'已結束回答':'開放回答中'}</span></div><h3>${esc(topic.title)}</h3><p class="discussion-excerpt">${esc(topic.body.slice(0,140))}${topic.body.length>140?'…':''}</p>`;
    const button=document.createElement('button');button.textContent=teacher?'查看題目與學生回答':'閱讀公告 →';button.onclick=()=>open(topic);card.append(button);$('#discussion-list').append(card);
   }
   if(!rows.length)$('#discussion-list').textContent='目前沒有討論題公告。';$('#discussion-prev').disabled=page===0;$('#discussion-next').disabled=rows.length<=12;
  }catch(e){if(seq===sequence){$('#discussion-list').textContent='目前無法讀取討論題。';fail(e);}}
 }
 if(teacher)$('#discussion-publish').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button'),title=$('#discussion-title').value.trim(),body=$('#discussion-body').value.trim();if(button.disabled||!title||!body)return;button.disabled=true;try{checked(await client.from('rise_discussion_topics').insert({title,body}));form.reset();report('討論題已發布，學生可從學生專區的「討論題公告」進入回答。');page=0;await draw();}catch(err){fail(err);}finally{button.disabled=false;}};
 $('#discussion-prev').onclick=()=>{page=Math.max(0,page-1);draw();};$('#discussion-next').onclick=()=>{page++;draw();};$('#discussion-refresh').onclick=draw;
 client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||(session?.user&&session.user.id!==user.id)){++sequence;++detailSequence;root.replaceChildren();report('帳號已變更，請重新整理並登入。',true);}});
 await draw();
};

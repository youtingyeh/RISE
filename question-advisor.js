'use strict';
window.RISE_QUESTION_ADVISOR = function ({client, form, config}) {
  if (!form || form.querySelector('[data-advisor]')) return;
  const fields = ['subject','title','body','background','question','motivation','assumptions','evidence','impact','revision'];
  const read = () => Object.fromEntries(fields.map(key => [key, form.querySelector('#q-'+key)?.value.trim() || '']));
  const box = document.createElement('section');
  box.className = 'auth-card'; box.dataset.advisor = '';
  box.innerHTML = '<h3>AI 問題顧問（試用）</h3><p>先寫下問題，再檢查假設、概念是否重複或混淆，以及問題與證據的關聯。AI 提供修改方向，不代替教師判斷，也不會自動送出問題。</p><p>按下分析會將本表的文字傳送至 OpenAI；不傳送附件、帳號姓名或信箱。請先移除文字中的個人資料。建議可能有誤，請自行確認。</p><button type="button" data-analyze>請 AI 檢查我的提問</button><p data-status role="status" aria-live="polite"></p><div data-result></div>';
  form.querySelector('button[type="submit"]').before(box);
  const button = box.querySelector('[data-analyze]'), status = box.querySelector('[data-status]'), result = box.querySelector('[data-result]');
  let version = 0, controller = null, reviewed = null;
  function invalidate() {
    const wasPending = Boolean(controller);
    version++; controller?.abort(); controller = null; button.disabled = false;
    if (reviewed) status.textContent = '內容已修改，請重新分析。下方為修改前的建議。';
    else if (wasPending) status.textContent = '內容已修改，已取消這次分析。可再次分析或直接送出問題。';
    result.querySelectorAll('button').forEach(b => b.disabled = true);
  }
  form.addEventListener('input', invalidate);
  form.addEventListener('change', invalidate);
  form.addEventListener('reset', () => { invalidate(); reviewed=null; result.replaceChildren(); status.textContent=''; });
  client.auth.onAuthStateChange?.((event) => {
    if (event === 'SIGNED_OUT') { invalidate(); reviewed=null; result.replaceChildren(); status.textContent='請先登入後再使用 AI 顧問。'; }
  });
  function paragraph(parent, tag, text) { const node=document.createElement(tag); node.textContent=text; node.style.whiteSpace='pre-wrap'; parent.append(node); return node; }
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    const draft = read(), snapshot = JSON.stringify(draft);
    if (!draft.title || !draft.body) { status.textContent='請先填寫問題標題與問題內容。'; return; }
    if (Object.values(draft).join('').length > 12000) { status.textContent='分析文字過長，請縮短至 12000 字以內。'; return; }
    const current=++version;
    controller=new AbortController(); const requestController=controller;
    const timer=setTimeout(()=>requestController.abort(),55000);
    button.disabled=true; result.replaceChildren(); reviewed=null; status.textContent='AI 正在檢查你的提問…';
    try {
      const session=await client.auth.getSession();
      if (session.error || !session.data.session?.access_token) throw Error('請重新登入後再使用 AI 顧問。');
      const response=await fetch(config.url.replace(/\/$/,'')+'/functions/v1/rise-question-advisor', {
        method:'POST', headers:{'Content-Type':'application/json',apikey:config.publishableKey,Authorization:'Bearer '+session.data.session.access_token},
        body:JSON.stringify({draft}), signal:requestController.signal
      });
      const data=await response.json().catch(()=>({}));
      if (!response.ok) throw Error(response.status===404 || data.code==='not_configured' ? 'AI 顧問尚未啟用，請管理員完成後端設定。你仍可直接送出問題。' : typeof data.error==='string' ? data.error : 'AI 顧問暫時無法使用，你仍可直接送出問題。');
      if (current!==version || JSON.stringify(read())!==snapshot) { if(current===version)status.textContent='內容已修改，請重新分析。'; return; }
      const advice=data.advice;
      if (!advice || !['assumptions','concepts','relations','next_steps'].every(k=>Array.isArray(advice[k])&&advice[k].every(x=>typeof x==='string')) || typeof advice.revised_question!=='string' || typeof advice.summary!=='string') throw Error('AI 回覆格式不完整，請稍後重試。');
      reviewed=snapshot;
      paragraph(result,'p',advice.summary);
      for (const [key,label] of [['assumptions','假設檢查'],['concepts','概念重複與混淆'],['relations','關聯強度與理由'],['next_steps','下一步可以怎麼問']]) {
        paragraph(result,'h4',label); const list=document.createElement('ul'); result.append(list);
        for(const item of advice[key]) paragraph(list,'li',item);
      }
      paragraph(result,'h4','改寫參考（不會自動套用）'); paragraph(result,'p',advice.revised_question);
      const adopt=paragraph(result,'button','將改寫參考放入「我真正想問什麼？」'); adopt.type='button';
      adopt.addEventListener('click',()=>{
        if(JSON.stringify(read())!==snapshot){status.textContent='內容已修改，請重新分析後再套用。';return;}
        const target=form.querySelector('#q-question');
        if(!target || !window.confirm('要以 AI 改寫取代「我真正想問什麼？」欄位嗎？其他欄位會保留。'))return;
        target.value=advice.revised_question; target.dispatchEvent(new Event('input',{bubbles:true})); target.focus();
      });
      status.textContent='分析完成。請自行確認建議，再修改或直接送出問題。';
    } catch(error) {
      if(current===version) status.textContent=error.name==='AbortError'?'分析逾時，請稍後重試；你仍可直接送出問題。':error instanceof TypeError?'AI 顧問尚未部署或目前無法連線。你仍可直接送出問題。':error.message;
    } finally { clearTimeout(timer); if(current===version){button.disabled=false;controller=null;} }
  });
};

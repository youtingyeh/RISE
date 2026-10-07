'use strict';
window.RISE_QUESTION_HISTORY=async function({client,user,profile,question:q,root,report,reload}){
 const r=await client.from('rise_question_versions').select('*').eq('question_id',q.id).order('version',{ascending:false});if(r.error){if(['PGRST205','42P01'].includes(r.error.code))throw Error('rise:提問歷程與三要素批閱尚未啟用，請管理員執行 backend/program-upgrade.sql。');throw r.error;}
 const versions=r.data||[],latest=versions[0];if(!latest)throw Error('rise:請管理員執行 backend/program/01-question-history.sql。');
 const el=(tag,text,parent=root)=>{const n=document.createElement(tag);n.textContent=text;parent.append(n);return n;};
 let hasTimeline=false,offset=0;
 const timeline=el('section','');timeline.setAttribute('aria-label','思考歷程與回覆');
 el('h4','思考歷程：修改、再提交與延伸討論',timeline);
 const events=el('div','',timeline),more=el('button','載入更多歷程',timeline);more.type='button';more.hidden=true;
 async function loadTimeline(){
  more.disabled=true;
  try{
   const result=await client.rpc('rise_question_timeline',{p_question_id:q.id,p_offset:offset});
   if(result.error)throw result.error;
   if(!Array.isArray(result.data?.items))throw Error('rise:歷程資料格式不正確。');
   hasTimeline=true;
   for(const item of result.data.items.slice(0,100)){
    const card=el('article','',events);card.className='auth-record';
    const version=item.version?'第 '+item.version+' 版':'舊回覆（未記錄版本）';
    el('h5',(item.kind==='version'?'提交／修訂':'回覆')+' · '+version+' · '+new Date(item.created_at).toLocaleString('zh-TW'),card);
    if(item.kind==='version'){el('strong',item.title,card);el('p',item.body,card).style.whiteSpace='pre-wrap';if(item.change_note)el('p','修改說明：'+item.change_note,card);}
    else{el('strong',item.author_name||'使用者',card);if(item.analysis&&item.improvement&&item.followup){for(const [key,label] of [['analysis','思路分析'],['improvement','改進建議'],['followup','延伸提問']]){el('h6',label,card);el('p',item[key],card).style.whiteSpace='pre-wrap';}}else el('p',item.body,card).style.whiteSpace='pre-wrap';}
   }
   offset+=Math.min(result.data.items.length,100);more.hidden=result.data.items.length<=100;
  }finally{more.disabled=false;}
 }
 try{await loadTimeline();}catch(error){
  if(!['PGRST202','42883'].includes(error.code))throw error;
  timeline.remove();
  el('p','整合歷程尚待後端更新，目前顯示既有版本與回覆。');
  el('h4','提問版本歷程');for(const v of versions){const card=el('section','');card.className='auth-record';el('h5','第 '+v.version+' 版 · '+new Date(v.created_at).toLocaleString('zh-TW'),card);el('strong',v.title,card);el('p',v.body,card).style.whiteSpace='pre-wrap';if(v.change_note)el('p','修改說明：'+v.change_note,card);}
 }
 more.onclick=()=>loadTimeline().catch(error=>report(String(error.message||error).replace(/^rise:/,''),true));
 const staff=['ta','teacher','admin'].includes(profile.role),own=q.user_id===user.id;
 if(!staff&&!own)return {timeline:hasTimeline};
 if(staff){
  const ai=el('section','');ai.className='auth-record';el('h4','AI 學習分析標籤（待教師確認）',ai);
  const load=el('button','查看此提問已分享的 AI 標籤',ai);load.type='button';const out=el('div','',ai);
  load.onclick=async()=>{load.disabled=true;try{const x=await client.rpc('rise_question_ai_context',{p_question_id:q.id});if(x.error)throw x.error;out.replaceChildren();const items=Array.isArray(x.data)?x.data:[];if(!items.length){el('p','此提問沒有學生分享的 AI 分析。',out);}for(const item of items){const card=el('div','第 '+item.version+' 版 · 模型 '+item.model, out);for(const tag of item.tags||[]){const names={calculation_slip:'運算疏忽',logic_gap:'邏輯斷層',concept_misuse:'概念誤用'};el('p',(names[tag.code]||tag.code)+'（模型信心 '+Math.round(Number(tag.confidence||0)*100)+'%）：'+tag.reason,card);}}}catch(err){report(String(err.message||err).replace(/^rise:/,''),true);}finally{load.disabled=false;}};
 }
 const form=el('form','');el('h4',staff?'三要素批閱（第 '+latest.version+' 版）':'修訂並重新提交',form);
 const specs=staff?[['analysis','思路分析',''],['improvement','改進建議',''],['followup','延伸提問','']]:[['title','問題標題',latest.title],['body','完整問題與思考過程',latest.body],['change_note','這次修改了什麼？','']];
 for(const [key,label,value] of specs){const l=el('label',label,form);l.style.display='block';const input=el('textarea','',l);input.name=key;input.value=value;input.required=true;input.maxLength=staff?3000:key==='title'?160:key==='change_note'?2000:10000;input.rows=key==='body'?7:3;}
 el('p','每次提交保留完整版本。原有圖片繼續附於此提問。',form);const save=el('button',staff?'提交三要素批閱':'送出新版本',form);save.type='submit';
 form.onsubmit=async e=>{e.preventDefault();if(save.disabled)return;save.disabled=true;try{const val=k=>form.querySelector('[name="'+k+'"]').value.trim();const args=staff?{p_id:q.id,p_version:latest.version,p_analysis:val('analysis'),p_improvement:val('improvement'),p_followup:val('followup')}:{p_id:q.id,p_version:latest.version,p_title:val('title'),p_body:val('body'),p_change_note:val('change_note')};const res=await client.rpc(staff?'rise_review_question':'rise_revise_question',args);if(res.error)throw res.error;report('已保存。');try{await reload();}catch{report('已保存，但畫面更新失敗，請重新整理；不必重複提交。',true);}}catch(err){report(String(err.message||err).replace(/^rise:/,''),true);}finally{save.disabled=false;}};
 return {timeline:hasTimeline};
};

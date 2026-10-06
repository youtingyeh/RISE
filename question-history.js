'use strict';
window.RISE_QUESTION_HISTORY=async function({client,user,profile,question:q,root,report,reload}){
 const r=await client.from('rise_question_versions').select('*').eq('question_id',q.id).order('version',{ascending:false});if(r.error){if(['PGRST205','42P01'].includes(r.error.code))throw Error('rise:提問歷程與三要素批閱尚未啟用，請管理員執行 backend/program-upgrade.sql。');throw r.error;}
 const versions=r.data||[],latest=versions[0];if(!latest)throw Error('rise:請管理員執行 backend/program/01-question-history.sql。');
 const el=(tag,text,parent=root)=>{const n=document.createElement(tag);n.textContent=text;parent.append(n);return n;};
 el('h4','提問版本歷程');for(const v of versions){const card=el('section','');card.className='auth-record';el('h5','第 '+v.version+' 版 · '+new Date(v.created_at).toLocaleString('zh-TW'),card);el('strong',v.title,card);el('p',v.body,card).style.whiteSpace='pre-wrap';if(v.change_note)el('p','修改說明：'+v.change_note,card);}
 const staff=['ta','teacher','admin'].includes(profile.role),own=q.user_id===user.id;
 if(!staff&&!own)return;
 if(staff){
  const ai=el('section','');ai.className='auth-record';el('h4','AI 學習分析標籤（待教師確認）',ai);
  const load=el('button','查看此提問已分享的 AI 標籤',ai);load.type='button';const out=el('div','',ai);
  load.onclick=async()=>{load.disabled=true;try{const x=await client.rpc('rise_question_ai_context',{p_question_id:q.id});if(x.error)throw x.error;out.replaceChildren();const items=Array.isArray(x.data)?x.data:[];if(!items.length){el('p','此提問沒有學生分享的 AI 分析。',out);}for(const item of items){const card=el('div','第 '+item.version+' 版 · 模型 '+item.model, out);for(const tag of item.tags||[]){const names={calculation_slip:'運算疏忽',logic_gap:'邏輯斷層',concept_misuse:'概念誤用'};el('p',(names[tag.code]||tag.code)+'（模型信心 '+Math.round(Number(tag.confidence||0)*100)+'%）：'+tag.reason,card);}}}catch(err){report(String(err.message||err).replace(/^rise:/,''),true);}finally{load.disabled=false;}};
 }
 const form=el('form','');el('h4',staff?'三要素批閱（第 '+latest.version+' 版）':'修訂並重新提交',form);
 const specs=staff?[['analysis','思路分析',''],['improvement','改進建議',''],['followup','延伸提問','']]:[['title','問題標題',latest.title],['body','完整問題與思考過程',latest.body],['change_note','這次修改了什麼？','']];
 for(const [key,label,value] of specs){const l=el('label',label,form);l.style.display='block';const input=el('textarea','',l);input.name=key;input.value=value;input.required=true;input.maxLength=staff?3000:key==='title'?160:key==='change_note'?2000:10000;input.rows=key==='body'?7:3;}
 el('p','每次提交保留完整版本。原有圖片繼續附於此提問。',form);const save=el('button',staff?'提交三要素批閱':'送出新版本',form);save.type='submit';
 form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{const val=k=>form.querySelector('[name="'+k+'"]').value.trim();const args=staff?{p_id:q.id,p_version:latest.version,p_analysis:val('analysis'),p_improvement:val('improvement'),p_followup:val('followup')}:{p_id:q.id,p_version:latest.version,p_title:val('title'),p_body:val('body'),p_change_note:val('change_note')};const res=await client.rpc(staff?'rise_review_question':'rise_revise_question',args);if(res.error)throw res.error;report('已保存。');await reload();}catch(err){report(String(err.message||err).replace(/^rise:/,''),true);}finally{save.disabled=false;}};
};

'use strict';
// Public RPCs return published, consented fields only; this panel has no editor controls.
window.RISE_PUBLIC_RESOURCES=async function({client,root}){
 if(!root)return;
 const node=(tag,text,parent=root)=>{const e=document.createElement(tag);e.textContent=text;parent.append(e);return e;};
 const render=async(action,title,destination)=>{
  const section=node('section','');section.className='auth-card';node('h3',title,section);
  try{
   const result=await client.rpc('rise_program_api',{p_action:action,p_data:{}});
   if(result.error)throw result.error;
   if(!Array.isArray(result.data))throw Error('Invalid public data');
   if(!result.data.length)node('p','目前尚未有正式發布的內容。',section);
   for(const item of result.data.slice(0,3)){
    const card=node('article','',section);card.className='auth-record';node('h4',(item.year?item.year+' · ':'')+item.title,card);
    node('p',String(item.body||'').slice(0,240),card);
    if(action==='oer_public')node('p','來源／作者：'+item.attribution+' · 授權：'+item.license,card);
    else node('p',item.competition+' · '+item.award+' · '+item.division+'／'+item.field,card);
   }
  }catch{node('p','公開成果暫時無法載入，請稍後重試。',section);}
  const link=node('a','查看完整內容 →',section);link.href=destination;
 };
 root.replaceChildren();await Promise.all([render('oer_public','數思年鑑：對談影音、文字稿與學者解答','yearbook.html'),render('awards_public','競賽得獎作品','competition-gallery.html')]);
};

/* Shared public footer for rendered and account pages. Role and feature gates still apply. */
(() => {
  'use strict';
  const info=window.RISE_SITE_INFO;
  if(!info)return;
  function text(tag,value,cls){const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;}
  function link(href,label){const a=text('a',label);a.href=href;return a;}
  function sync(){
    document.querySelectorAll('footer.site-footer:not([data-shared-footer])').forEach(footer=>{
      footer.dataset.sharedFooter='true';
      const grid=text('div','','container footer-grid'),identity=document.createElement('div');
      const brand=link('index.html',info.name);brand.className='footer-brand';identity.append(brand,text('p','《'+info.title+'》'),text('p',info.subtitle),text('p',info.organizer+' · '+info.center,'small'),text('p',info.englishName,'small'));
      const nav=document.createElement('nav');nav.className='footer-nav';nav.setAttribute('aria-label','頁尾導覽');
      [['about.html','關於計畫'],['join.html','加入我們'],['science.html','科學探索'],['explore.html','影音探索'],['schedule.html','重要日程'],['account.html','會員中心'],['privacy.html','個資告知']].forEach(([href,label])=>nav.append(link(href,label)));
      const contact=text('p','聯絡信箱：');contact.append(link('mailto:'+info.contactEmail,info.contactEmail));identity.append(contact);
      grid.append(identity,nav);footer.replaceChildren(grid);
      const bottom=text('div','數學 · 物理 · 化學','container footer-bottom');footer.append(bottom);
    });
    document.querySelectorAll('[data-site-contact]').forEach(el=>{if(el.textContent!==info.contactEmail)el.textContent=info.contactEmail;if(el.tagName==='A')el.setAttribute('href','mailto:'+info.contactEmail);});
  }
  sync();new MutationObserver(sync).observe(document.documentElement,{childList:true,subtree:true});
})();

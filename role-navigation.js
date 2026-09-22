(() => {
  'use strict';
  // Hide privileged navigation until a verified user and database role are known.
  let role='guest',client=null,generation=0;
  const allowedGroup=index=>index===0 || role==='admin' || (index===1&&role==='ta') || (index===2&&role==='teacher');
  function setRole(value){const next=['student','ta','teacher','admin'].includes(value)?value:'guest';if(role!==next){role=next;scan();}}
  async function refreshRole(){
    const seq=++generation;setRole('guest');
    try{
      const identity=await client.auth.getUser();
      const user=identity.data?.user;
      if(identity.error||!user?.email_confirmed_at)return;
      const result=await client.from('rise_profiles').select('role').eq('id',user.id).single();
      if(seq===generation&&!result.error)setRole(result.data?.role);
    }catch{if(seq===generation)setRole('guest');}
  }
  function connect(){
    const next=window.RISE_NAV_CLIENT;if(!next||client===next)return;
    client=next;refreshRole();
    client.auth.onAuthStateChange(event=>{
      ++generation;setRole('guest');
      if(event!=='SIGNED_OUT')setTimeout(refreshRole,0);
    });
  }
  window.addEventListener('rise-nav-client',connect);
  window.addEventListener('pageshow',()=>{if(client)refreshRole();});
  window.addEventListener('focus',()=>{if(client)refreshRole();});
  const groups = [
    ['學生專區', [['science.html','科學探索'],['explore.html','影音探索'],['questions.html','我的提問'],['assignments.html','我的作業'],['competitions.html','提問競賽'],['learning-report.html','學習紀錄'],['discussions.html','討論題公告']]],
    ['助教專區', [['support.html','助教工作台'],['staff-questions.html','待答工作台'],['assignments.html','作業批閱'],['ta-training.html','培訓與認證'],['competitions.html','提問競賽'],['learning-report.html','學習成效']]],
    ['教師專區', [['support.html','教師工作台'],['staff-questions.html','待答工作台'],['assignments.html','作業與批閱'],['ta-training.html','培訓課程'],['competitions.html','競賽與評審'],['learning-report.html','學習成效'],['discussions.html?view=teacher','討論題公告'],['resources.html?destination=science','科學探索教材管理']]]
  ];
  function mount(nav) {
    if (nav.dataset.roleNavigation===role) return;
    nav.dataset.roleNavigation = role;
    nav.classList.add('rise-role-nav');
    nav.replaceChildren();
    const current = location.pathname.split('/').pop() || 'index.html';
    function link(href, label) {
      const a = document.createElement('a'); a.href = href; a.textContent = label;
      if (href === current) a.setAttribute('aria-current', 'page');
      return a;
    }
    nav.append(link('index.html','首頁'), link('about.html','關於計畫'));
    const controls = [];
    groups.forEach(([label, items], index) => {
      if(!allowedGroup(index))return;
      const group = document.createElement('div'); group.className = 'rise-nav-group';
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      const panel = document.createElement('div'); panel.className = 'rise-nav-panel'; panel.id = 'rise-nav-panel-' + index;
      panel.hidden = true; button.setAttribute('aria-expanded','false'); button.setAttribute('aria-controls',panel.id);
      items.forEach(([href,text]) => panel.append(link(href,text)));
      const setOpen = open => { panel.hidden = !open; button.setAttribute('aria-expanded',String(open)); };
      const open = () => { controls.forEach(c=>c(false)); setOpen(true); };
      controls.push(setOpen);
      button.addEventListener('click',()=>panel.hidden ? open() : setOpen(false));
      group.addEventListener('pointerenter',e=>{ if(e.pointerType === 'mouse') open(); });
      group.addEventListener('pointerleave',()=>{ if(!group.contains(document.activeElement)) setOpen(false); });
      group.addEventListener('focusout',e=>{ if(!group.contains(e.relatedTarget)) setOpen(false); });
      group.addEventListener('keydown', e => {
        if(e.key === 'Escape') { e.preventDefault(); setOpen(false); button.focus(); }
        if(e.target === button && ['ArrowDown','ArrowUp'].includes(e.key)) {
          e.preventDefault(); open(); (e.key === 'ArrowDown' ? panel.firstElementChild : panel.lastElementChild).focus();
        }
      });
      group.append(button,panel); nav.append(group);
    });
    nav.append(link('team.html','核心團隊'),link('schedule.html','重要日程'),link('account.html','會員中心'));
    nav.riseCloseMenus=()=>controls.forEach(c=>c(false));
  }
  const scan = () => {
    document.querySelectorAll('header nav[aria-label="主要導覽"]').forEach(mount);
    // Also cover older footer/sidebar links, without hiding student material detail links.
    document.querySelectorAll('a[href]').forEach(a=>{
      const u=new URL(a.getAttribute('href'),location.href),p=u.pathname.split('/').pop();
      let roles=null;
      if(['support.html','staff-questions.html','ta-training.html'].includes(p))roles=['ta','teacher','admin'];
      if((p==='resources.html'&&!u.searchParams.has('id'))||(p==='discussions.html'&&u.searchParams.get('view')==='teacher'))roles=['teacher','admin'];
      if(['admin-courses.html','admin-console.html','admin-videos.html','admin-review.html'].includes(p))roles=['admin'];
      if(roles)a.hidden=!roles.includes(role);
    });
  };
  document.addEventListener('click',e=>document.querySelectorAll('header nav[aria-label="主要導覽"]').forEach(nav=>{if(!nav.contains(e.target))nav.riseCloseMenus?.();}));
  scan();connect();new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();


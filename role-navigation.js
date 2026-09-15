(() => {
  'use strict';
  const groups = [
    ['學生專區', [['science.html','科學探索'],['explore.html','影音探索'],['inquiry.html','提問工作台'],['questions.html','我的問題']]],
    ['助教專區', [['support.html','助教工作台'],['staff-questions.html','待答工作台'],['questions.html','我的提問']]],
    ['教師專區', [['support.html','教師工作台'],['staff-questions.html','待答工作台'],['questions.html','我的提問'],['resources.html','學習路徑與科學探索教材管理']]]
  ];
  function mount(nav) {
    if (nav.dataset.roleNavigation) return;
    nav.dataset.roleNavigation = 'true';
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
    document.addEventListener('click',e=>{ if(!nav.contains(e.target)) controls.forEach(c=>c(false)); });
  }
  const scan = () => document.querySelectorAll('header nav[aria-label="主要導覽"]').forEach(mount);
  scan(); new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();

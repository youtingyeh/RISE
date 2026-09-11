/* 登入閘門、個人觀看紀錄。由 script.js 在受保護頁面載入。 */
(() => {
  'use strict';
  const base = new URL('./', document.currentScript.src);
  const load = (path) => new Promise((resolve,reject) => {
    const s=document.createElement('script');
    const timer=setTimeout(()=>reject(Error('載入逾時，請重新整理。')),15000);
    s.src=new URL(path,base).href;
    s.onload=()=>{clearTimeout(timer);resolve();};
    s.onerror=()=>{clearTimeout(timer);reject(Error('無法載入 '+path));};
    document.head.append(s);
  });
  const loginURL=()=>new URL('login.html?next='+encodeURIComponent(location.pathname+location.search),base).href;
  let client,user,blocked=false;
  function leave() {
    if(blocked)return;blocked=true;
    window.dispatchEvent(new Event('rise-session-ended'));
    const app=document.getElementById('app');
    if(app)app.replaceChildren();
    location.replace(loginURL());
  }
  const ready=(async()=>{
    if(!window.RISE_AUTH_CONFIG)await load('auth-config.js');
    const c=window.RISE_AUTH_CONFIG||{};
    if(!c.url||!c.publishableKey)throw Error('登入服務尚未設定，暫時無法進入學習功能。');
    if(!window.supabase)await load('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js');
    client=window.supabase.createClient(c.url,c.publishableKey);
    const result=await client.auth.getUser();
    user=result.data?.user;
    if(!user){if(result.error&&result.error.name!=='AuthSessionMissingError'&&!/session|jwt|token/i.test(result.error.message))throw Error('無法確認登入狀態，請檢查網路並重試。');leave();return false;}
    if(!user.email_confirmed_at){leave();return false;}
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT'||(session?.user&&session.user.id!==user.id))leave();
    });
    // 從上一頁快取返回時也重新確認身分，防止登出後恢復舊頁。
    window.addEventListener('pageshow',async e=>{
      if(!e.persisted)return;
      const r=await client.auth.getUser();if(r.error||r.data?.user?.id!==user.id)leave();
    });
    return true;
  })();
  async function recent(videoId) {
    const r=await client.from('rise_watch_history').select('*').eq('user_id',user.id).eq('video_id',videoId).maybeSingle();
    if(r.error)throw r.error;return r.data;
  }
  // 只有播放器實際前進才累加秒數；跳章節、拖曳、暫停不計為已觀看。
  function tracker(video,adapter,onStatus) {
    const sessionId=crypto.randomUUID();
    let watched=0,sequence=0,started=false,ended=false,stopped=false;
    let position=0,duration=0,lastTime=performance.now(),lastPosition=0,wasPlaying=false;
    let sending=false,queued=false;
    const number=x=>Number.isFinite(Number(x))?Math.max(0,Math.min(604800,Number(x))):0;
    function sample() {
      if(stopped||blocked)return;
      const now=performance.now(),dt=(now-lastTime)/1000;
      const state=adapter();
      position=number(state.position);duration=number(state.duration);
      const playing=Boolean(state.playing)&&!document.hidden;
      const delta=position-lastPosition,rate=Number(state.rate)||1;
      if(playing||wasPlaying)started=true;
      if(wasPlaying&&dt>0&&dt<3&&delta>0&&delta<=dt*Math.max(rate,1)+0.8)watched+=Math.min(dt,delta/rate);
      wasPlaying=playing;lastPosition=position;lastTime=now;
    }
    async function save() {
      if(stopped||blocked)return;
      sample();if(!started)return;
      if(sending){queued=true;return;}
      sending=true;
      try{
        const identity=await client.auth.getUser();
        if(identity.error||identity.data?.user?.id!==user.id){leave();return;}
        const r=await client.rpc('rise_save_watch',{
          p_session_id:sessionId,p_video_id:String(video.id),p_title:String(video.title||'課程影片').slice(0,300),
          p_position:position,p_duration:duration,p_watched:Math.min(604800,watched),p_sequence:++sequence,p_ended:ended
        });
        if(r.error)throw r.error;
        onStatus('觀看紀錄已同步至帳號。');
      }catch(e){onStatus('觀看紀錄尚未同步，請檢查網路或稍後按「儲存觀看紀錄」。');}
      finally{sending=false;if(queued){queued=false;save();}}
    }
    const tick=setInterval(sample,1000),flush=setInterval(save,15000);
    const onHidden=()=>{if(document.hidden)save();};
    document.addEventListener('visibilitychange',onHidden);
    window.addEventListener('pagehide',save);
    function stop(){stopped=true;clearInterval(tick);clearInterval(flush);document.removeEventListener('visibilitychange',onHidden);window.removeEventListener('pagehide',save);}
    window.addEventListener('rise-session-ended',stop,{once:true});
    return {save,change(){sample();},finish(){ended=true;started=true;save();},stop};
  }
  window.RISE_LEARNING={ready,get user(){return user;},get client(){return client;},recent,tracker};
})();

'use strict';
window.RISE_ADMIN_CONSOLE = async function({client,user,profile,root,report}) {
 if(profile.role!=='admin'||!user.email_confirmed_at){root.textContent='此頁僅限管理員使用。';return;}
 const labels={student:'學生',ta:'助教',teacher:'教師',admin:'管理員',missing:'資料待補齊'};
 const $=s=>root.querySelector(s),checked=r=>{if(r.error)throw r.error;return r.data;};
 const date=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'尚無紀錄';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const failure=e=>{if(e.code==='42501'){clear();return;}report(['PGRST202','PGRST205','42P01'].includes(e.code)?'管理系統尚未啟用，請在 Supabase SQL Editor 執行 backend/admin-console.sql。':String(e.message||'').startsWith('rise:')?e.message.slice(5):'讀取或儲存失敗，請確認管理員資格與網路後重試。',true);};
 let offset=0,request=0,statsRequest=0,alive=true,busy=false;
 root.innerHTML=`<section class="auth-card"><h2>管理工具</h2><div class="auth-actions"><a class="auth-button" href="admin-review.html">教師與助教資格審核</a><a class="auth-button" href="resources.html?destination=science">科學探索教材管理</a><a class="auth-button" href="discussions.html?view=teacher">討論題管理</a></div></section>
 <section class="auth-card"><h2>會員與活躍度概況</h2><button id="admin-stats-refresh" type="button">更新統計</button><p id="admin-metric-status" role="status"></p><div id="admin-metrics" class="admin-metrics"></div><div id="admin-roles" class="auth-help"></div><p id="admin-activity-note" class="auth-help"></p><details><summary>查看近 30 天每日趨勢</summary><div class="admin-table-wrap"><table><caption>每日活躍會員與新註冊人數（台灣時間）</caption><thead><tr><th scope="col">日期</th><th scope="col">活躍會員</th><th scope="col">新註冊</th></tr></thead><tbody id="admin-daily"></tbody></table></div></details></section>
 <section class="auth-card"><h2>已註冊會員管理</h2><p>搜尋會員、確認驗證狀態及調整角色。角色變更會保留後端操作紀錄。</p><form id="admin-search" class="admin-filters"><label>姓名或信箱<input id="admin-query" type="search" maxlength="200" placeholder="輸入姓名或信箱"></label><label>角色<select id="admin-role-filter"><option value="all">全部角色</option>${Object.entries(labels).map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label><button type="submit">搜尋／重新整理</button></form><p id="admin-members-status" role="status"></p><div class="admin-table-wrap"><table><caption>註冊會員清單</caption><thead><tr><th scope="col">姓名／信箱</th><th scope="col">角色</th><th scope="col">信箱驗證</th><th scope="col">註冊時間</th><th scope="col">最近登入／活動</th><th scope="col">管理</th></tr></thead><tbody id="admin-members"></tbody></table></div><div class="auth-actions"><button id="admin-prev" type="button">上一頁</button><button id="admin-next" type="button">下一頁</button></div></section>
 <dialog id="admin-role-dialog" aria-labelledby="admin-role-title"><form id="admin-role-form"><h2 id="admin-role-title">調整會員角色</h2><p id="admin-role-member"></p><label>新角色<select id="admin-new-role">${Object.entries(labels).filter(([v])=>v!=='missing').map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label><p>管理員可以查看會員資料、統計與調整權限。請確認授予的角色。</p><div class="auth-actions"><button type="submit" id="admin-role-save">確認變更</button><button type="button" id="admin-role-cancel">取消</button></div></form></dialog>`;
 async function stats(){
  const seq=++statsRequest;$('#admin-metric-status').textContent='正在讀取統計…';$('#admin-metrics').replaceChildren();$('#admin-daily').replaceChildren();
  try{const s=checked(await client.rpc('rise_admin_statistics'));if(!alive||seq!==statsRequest)return;
   const metrics=[['已註冊',s.total],['已驗證',s.verified],['近 7 天新註冊',s.new_7],['今日活躍',s.active_today],['近 7 天活躍',s.active_7],['近 30 天活躍',s.active_30]];
   $('#admin-metrics').innerHTML=metrics.map(([label,n])=>`<div class="admin-metric"><span>${label}</span><strong>${Number(n)||0}</strong></div>`).join('');
   $('#admin-roles').textContent=Object.entries(labels).map(([key,label])=>label+'：'+(Number(s.roles?.[key])||0)).join(' ／ ');
   const started=new Date(s.started_at).toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
   $('#admin-activity-note').textContent='活躍＝當日以已驗證帳號開啟網站頁面的不同會員數，包含管理員。統計採台灣時間；活動紀錄從 '+date(s.started_at)+' 開始，啟用前的活動無法回補。註冊數依目前仍存在的帳號計算。';
   for(const day of s.daily){const tr=document.createElement('tr');for(const val of [day.date,day.date<started?'未追蹤':String(day.active),String(day.registrations)]){const td=document.createElement('td');td.textContent=val;tr.append(td);}$('#admin-daily').append(tr);}
   $('#admin-metric-status').textContent='更新時間：'+date(new Date());
  }catch(e){if(alive&&seq===statsRequest){$('#admin-metric-status').textContent='統計尚未載入。';failure(e);}}
 }
 let selected=null;
 async function members(){
  const seq=++request;$('#admin-members').replaceChildren();$('#admin-members-status').textContent='正在讀取會員…';$('#admin-prev').disabled=$('#admin-next').disabled=true;
  try{const result=checked(await client.rpc('rise_admin_members',{p_search:$('#admin-query').value.trim(),p_role:$('#admin-role-filter').value,p_offset:offset}));if(!alive||seq!==request)return;
   for(const row of result.items){const tr=document.createElement('tr');tr.innerHTML=`<td><strong>${esc(row.display_name)}</strong><br>${esc(row.email||'無信箱')}</td><td>${esc(labels[row.role]||labels.missing)}</td><td>${row.email_confirmed_at?'已驗證':'尚未驗證'}</td><td>${esc(date(row.created_at))}</td><td>登入：${esc(date(row.last_sign_in_at))}<br>活動：${esc(date(row.last_active_at))}</td><td></td>`;
    const button=document.createElement('button');button.type='button';button.textContent=row.id===user.id?'目前帳號':'調整角色';button.disabled=row.id===user.id||!row.role;button.onclick=()=>{selected=row;$('#admin-role-member').textContent=row.display_name+'（'+row.email+'），目前：'+labels[row.role];$('#admin-new-role').value=row.role;$('#admin-role-dialog').showModal();};tr.lastElementChild.append(button);$('#admin-members').append(tr);}
   $('#admin-members-status').textContent=result.total?`共 ${result.total} 位會員 · 第 ${offset/25+1} 頁`:'沒有符合條件的會員。';$('#admin-prev').disabled=offset===0;$('#admin-next').disabled=offset+25>=result.total;
  }catch(e){if(alive&&seq===request){$('#admin-members-status').textContent='會員清單尚未載入。';failure(e);}}
 }
 $('#admin-role-cancel').onclick=()=>{if(!busy)$('#admin-role-dialog').close();};
 $('#admin-role-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 $('#admin-role-form').onsubmit=async e=>{e.preventDefault();if(busy||!selected)return;busy=true;$('#admin-role-save').disabled=true;$('#admin-role-cancel').disabled=true;try{checked(await client.rpc('rise_admin_set_role',{p_user_id:selected.id,p_role:$('#admin-new-role').value,p_expected_role:selected.role}));if(!alive)return;$('#admin-role-dialog').close();report('角色已更新。');await Promise.all([members(),stats()]);}catch(err){if(alive){$('#admin-role-dialog').close();failure(err);}}finally{busy=false;if(alive){$('#admin-role-save').disabled=false;$('#admin-role-cancel').disabled=false;}}};
 $('#admin-search').onsubmit=e=>{e.preventDefault();offset=0;members();};$('#admin-prev').onclick=()=>{offset=Math.max(0,offset-25);members();};$('#admin-next').onclick=()=>{offset+=25;members();};$('#admin-stats-refresh').onclick=stats;
 function clear(){alive=false;++request;++statsRequest;const dialog=$('#admin-role-dialog');if(dialog?.open)dialog.close();root.replaceChildren();report('管理員工作階段已結束，請重新登入。',true);}
 client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||(session?.user&&session.user.id!==user.id))clear();});
 window.addEventListener('pageshow',e=>{if(e.persisted){clear();location.reload();}});
 await Promise.all([stats(),members()]);
};

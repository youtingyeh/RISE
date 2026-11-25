// 自動修正的可修改範圍與上限。這些常數由管理者維護；自動修正流程不得修改本檔、檢查器或對照表。
// 預設拒絕：不在 ALLOWED_PAGES 內的任何路徑都不可修改（登入、角色權限、個資、資料庫、金鑰、部署設定、
// 測試標準與自動修正規則自然都在範圍外，下方 PROTECTED_HINTS 僅用於產生清楚的拒絕原因）。
export const ALLOWED_PAGES=Object.freeze(['join.html','schedule.html']);
export const MAX_ATTEMPTS=2;
export const MAX_CHANGED_LINES=6;
export const MAX_BROKEN_LINKS=3;
export const PROTECTED_HINTS=Object.freeze([
 [/^(auth|account|login|register|reset-password|forgot-password|verify-email|teacher-apply|role-navigation|account-nav|site-features|admin-)/,'登入、角色權限或管理功能'],
 [/^(backend|supabase)\//,'資料庫或後端程式'],[/\.sql$/,'資料庫'],
 [/^(\.github|scripts)\//,'部署與排程設定'],[/^(tests|tools|config)\//,'測試標準、檢查器或自動修正規則'],
 [/(^|\/)\.env|secret|credential|auth-config\.js/i,'金鑰或憑證'],[/^privacy\.html$/,'個資告知']
]);
export function isAllowedPage(page){return typeof page==='string'&&ALLOWED_PAGES.includes(page);}
export function whyDenied(path){
 if(ALLOWED_PAGES.includes(path))return null;
 const hit=PROTECTED_HINTS.find(([re])=>re.test(path));
 return hit?`受保護範圍（${hit[1]}）：${path}`:`不在可修改範圍：${path}`;
}

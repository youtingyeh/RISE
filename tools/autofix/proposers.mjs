// 修補提案者。預設為確定性提案：依管理者對照表把失效連結換成唯一對應的目的頁。
// 可用環境變數 RISE_AUTOFIX_PROPOSER 指向另一個模組（例如接 AI 模型）。提案只是「想改的檔案內容」，
// 是否可接受完全由獨立檢查器與測試決定；提案者說明文字不會被讀取。
const ANCHOR=/<a\b[^>]*?\bhref="([^"]*)"[^>]*>([^<]*)<\/a>/g;
export async function deterministicLinkProposer({page,html,broken,map}){
 const wanted=new Map(broken.map(b=>[b.href+'\u0000'+b.text,map.byText[b.text]?.target]));
 const next=html.replace(ANCHOR,(m,href,text)=>{const t=wanted.get(href+'\u0000'+text.replace(/\s+/g,' ').trim());return t?m.replace(`href="${href}"`,`href="${t}"`):m;});
 return {files:{[page]:next}};
}
export async function loadProposer(spec){
 if(!spec)return deterministicLinkProposer;
 const mod=await import(spec);if(typeof mod.default!=='function')throw Error('提案者模組必須 export default function');return mod.default;
}

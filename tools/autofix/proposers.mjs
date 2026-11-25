// 依管理者維護的連結對照表產生修補，由獨立檢查器確認實際差異。
const ANCHOR=/(<a\b[^>]*?\shref=")([^"]*)("[^>]*>([^<]*)<\/a>)/g;
export async function deterministicLinkProposer({page,html,broken,map}){
 const wanted=new Map(broken.map(b=>[b.href+'\u0000'+b.text,map.byText[b.text]?.target]));
 const next=html.replace(ANCHOR,(m,prefix,href,suffix,text)=>{const t=wanted.get(href+'\u0000'+text.replace(/\s+/g,' ').trim());return t?prefix+t+suffix:m;});
 return {files:{[page]:next}};
}

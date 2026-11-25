import {readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
const ANCHOR=/<a\b[^>]*?\bhref="([^"]*)"[^>]*>([^<]*)<\/a>/g;
export const normalizeText=t=>t.replace(/\s+/g,' ').trim();
export function internalTarget(href){
 if(!href||/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href))return null;
 const path=href.split('#')[0].split('?')[0];
 return path||null;
}
export function parseLinks(html){
 const links=[];let m;ANCHOR.lastIndex=0;
 while((m=ANCHOR.exec(html)))links.push({href:m[1],text:normalizeText(m[2]),line:html.slice(0,m.index).split('\n').length});
 return links;
}
const exists=async p=>{try{await access(p);return true;}catch{return false;}};
// 靜態重現：站內連結指向不存在的檔案。只讀取程式庫內的檔案。
export async function brokenLinks(root,page){
 const html=await readFile(join(root,page),'utf8');const broken=[];
 for(const l of parseLinks(html)){const t=internalTarget(l.href);if(t&&!(await exists(join(root,t))))broken.push({...l,target_missing:t});}
 return broken;
}

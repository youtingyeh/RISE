// 回歸測試：檢查自動修正對照表與實際頁面一致，且可修改頁面存在。
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {ALLOWED_PAGES} from '../../tools/autofix/policy.mjs';
const root=join(import.meta.dirname,'../..');
const map=JSON.parse(await readFile(join(root,'config/autofix-link-targets.json'),'utf8'));
for(const [text,{target,title}] of Object.entries(map.byText)){
 const html=await readFile(join(root,target),'utf8').catch(()=>null);
 assert(html,`對照表目的頁不存在：${text} → ${target}`);
 assert((html.match(/<title>([^<]*)<\/title>/)?.[1]||'').includes(title),`對照表標題與頁面不符：${text} → ${target}`);
}
for(const page of ALLOWED_PAGES)assert(await readFile(join(root,page),'utf8'),'可修改頁面不存在：'+page);
console.log(`PASS autofix regression: ${Object.keys(map.byText).length} map targets match real pages.`);

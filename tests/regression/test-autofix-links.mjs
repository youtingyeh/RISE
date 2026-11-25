// 回歸測試：管理者保留的連結修正不得再被改壞；並檢查自動修正對照表本身與實際頁面一致。
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {parseLinks,internalTarget} from '../../tools/autofix/link-check.mjs';
import {ALLOWED_PAGES} from '../../tools/autofix/policy.mjs';
const root=join(import.meta.dirname,'../..');
const map=JSON.parse(await readFile(join(root,'config/autofix-link-targets.json'),'utf8'));
for(const [text,{target,title}] of Object.entries(map.byText)){
 const html=await readFile(join(root,target),'utf8').catch(()=>null);
 assert(html,`對照表目的頁不存在：${text} → ${target}`);
 assert((html.match(/<title>([^<]*)<\/title>/)?.[1]||'').includes(title),`對照表標題與頁面不符：${text} → ${target}`);
}
for(const page of ALLOWED_PAGES)assert(await readFile(join(root,page),'utf8'),'可修改頁面不存在：'+page);
const cases=JSON.parse(await readFile(join(root,'tests/regression/autofix-links.json'),'utf8')).cases;
for(const c of cases){
 const links=parseLinks(await readFile(join(root,c.page),'utf8')).filter(l=>l.text===c.text);
 assert(links.length&&links.every(l=>internalTarget(l.href)===c.target),`${c.case_no}：${c.page} 的「${c.text}」應指向 ${c.target}`);
}
console.log(`PASS autofix regression: ${Object.keys(map.byText).length} map targets match real pages, ${cases.length} kept cases hold.`);

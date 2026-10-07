import {readdir} from 'node:fs/promises';
import {join,dirname,relative,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
async function list(dir){const entries=await readdir(dir,{withFileTypes:true});const items=[];for(const e of entries)if(e.name!=='node_modules')items.push(...(e.isDirectory()?await list(join(dir,e.name)):[join(dir,e.name)]));return items;}
let failed=0,count=0;
for(const path of (await list(join(root,'tests'))).filter(p=>p.endsWith('.mjs')).sort()){
 count++;console.log('\nTEST '+relative(root,path));
 const r=spawnSync(process.execPath,[path],{cwd:dirname(path),stdio:'inherit',timeout:120000});
 if(r.status!==0){failed++;console.error('FAIL '+relative(root,path));}
}
console.log(`\n${count-failed}/${count} test scripts passed`);if(failed)process.exit(1);

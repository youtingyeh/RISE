// Run from a local clone: node tools/restore-visual-style.mjs --restore
// Refuses to overwrite later modifications. Does not access Supabase or user data.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const backup=JSON.parse(await readFile(resolve(root,'backups/visual-20260917.json'),'utf8'));
const hash=s=>createHash('sha256').update(s.trimEnd()).digest('hex');
if(!process.argv.includes('--restore')){
 console.log('Dry run. Restores only the '+Object.keys(backup.files).length+' frontend files changed by the redesign.');
 console.log('No database changes. Use --restore after reviewing backups/RESTORE-VISUAL.md.');
 process.exit(0);
}
for(const [path,item] of Object.entries(backup.files)){
 if(!/^[a-z0-9-]+\.(html|js)$/.test(path))throw Error('Unexpected backup path: '+path);
 const current=await readFile(resolve(root,path),'utf8');
 if(![item.redesignHash,hash(item.original)].includes(hash(current)))throw Error('Later edits detected in '+path+'. Nothing restored; merge the style changes manually.');
}
for(const [path,item] of Object.entries(backup.files))await writeFile(resolve(root,path),item.original);
console.log('Restored the prior frontend. theme-rise.css is left unused, not deleted. Review git diff, then commit/push to publish.');

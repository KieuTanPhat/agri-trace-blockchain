import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(dir),baseline=JSON.parse(fs.readFileSync(path.join(dir,'ui-baseline.json'),'utf8').replace(/^\uFEFF/,''));
for(const [file,hash] of Object.entries(baseline)){const actual=createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex').toUpperCase();if(actual!==hash)throw Error('Giao diện gốc bị thay đổi: '+file);}
for(const file of ['server.mjs','client.mjs',...fs.readdirSync(path.join(dir,'lib')).filter(f=>f.endsWith('.mjs')).map(f=>'lib/'+f)])execFileSync(process.execPath,['--check',path.join(dir,file)]);
console.log(JSON.stringify({build:'PASS',originalUiFilesUnchanged:Object.keys(baseline).length,syntax:'PASS'},null,2));

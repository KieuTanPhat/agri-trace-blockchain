import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { walkFiles, sha256 } from './audit-baseline.mjs';

const normalize=p=>p.replaceAll('\\','/');
const gitBlob=b=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const isCode=p=>/\.(?:tsx?|jsx?|mjs|css)$/.test(p);
const isCanonical=p=>/^apps\/web\/src\/app\/.*(?:page|layout|loading|error|not-found)\.tsx$/.test(p);
const isNew=p=>/^apps\/web\/src\/(?:components|features|lib)\/ledger\//.test(p);
function imports(source,path,ts) {
  if(path.endsWith('.css')) return [...source.matchAll(/(?:@import\s+(?:url\()?|url\()\s*["']([^"']+)["']/g)].map(m=>m[1]);
  const result=[];
  const file=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,path.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const visit=node=>{
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))result.push(node.moduleSpecifier.text);
    if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(file)==='require')&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))result.push(node.arguments[0].text);
    ts.forEachChild(node,visit);
  };
  visit(file);return result;
}
export function checkUiOrigin({repoRoot,inventoryPath,phase='migration'}) {
  const inventory=JSON.parse(readFileSync(inventoryPath,'utf8'));
  const retained=new Set((inventory.retainedHeadless??[]).map(f=>f.path));
  const legacy=new Map(inventory.legacyUi.filter(f=>!retained.has(f.path)).map(f=>[f.path,f.gitBlob]));
  const legacyBlobs=new Set(legacy.values());
  const approved=new Map(inventory.uiSource.files.map(f=>[f.path,f.sha256]));
  const provenance=new Map((inventory.provenance??[]).map(f=>[f.target,f]));
  const errors=[],seen=new Set();
  const fail=(code,file,detail)=>errors.push({code,file,detail});
  const ts=createRequire(import.meta.url)('typescript');
  const candidates=walkFiles(repoRoot,'apps/web/src').filter(isCode);
  const roots=phase==='final'?candidates:candidates.filter(isNew);
  const resolveImport=(from,id)=>{
    let path;
    if(id.startsWith('@/'))path='apps/web/src/'+id.slice(2);
    else if(id.startsWith('.'))path=normalize(relative(repoRoot,resolve(repoRoot,dirname(from),id)));
    else return null;
    for(const ext of ['', '.ts','.tsx','.js','.jsx','.mjs','.css','/index.ts','/index.tsx']) if(existsSync(join(repoRoot,path+ext)))return path+ext;
    return path;
  };
  const visit=path=>{
    if(seen.has(path)||!existsSync(join(repoRoot,path))||!isCode(path))return;
    seen.add(path);
    const data=readFileSync(join(repoRoot,path)),content=data.toString('utf8'),entry=provenance.get(path);
    const approvedCopy=entry&&entry.sourceSha256===approved.get(entry.source)&&entry.targetSha256===sha256(data)&&entry.sourceSha256===sha256(data);
    if((legacyBlobs.has(gitBlob(data))||legacyBlobs.has(gitBlob(Buffer.from(content.replaceAll('\r\n','\n')))))&&!approvedCopy)fail('LEGACY_UI_COPY',path,'Content matches a baseline UI blob');
    const approvedReplacement=entry&&entry.sourceSha256===approved.get(entry.source)&&entry.targetSha256===sha256(data);
    if(phase==='final'&&legacy.has(path)&&!isCanonical(path)&&!(path==='apps/web/src/app/globals.css'&&approvedReplacement))fail('LEGACY_UI_REMAINS',path,'Legacy presentation path must be removed');
    for(const id of imports(content,path,ts)) {
      const modulePath=id.startsWith('@/')?'src/'+id.slice(2):id;
      const excluded=inventory.uiSource.excludedFromRuntime??[];
      if(excluded.some(p=>p.endsWith('/')?modulePath.startsWith(p):modulePath===p||modulePath===p.replace(/\.(tsx?|jsx?)$/,''))||/(?:^|\/)(?:preview-panel|mock)(?:\/|$|\.)/.test(modulePath)) {
        fail('PREVIEW_RUNTIME_IMPORT',path,`Forbidden runtime module: ${id}`);continue;
      }
      const target=resolveImport(path,id);
      if(!target)continue;
      if(target.startsWith('../')){fail('OUTSIDE_RUNTIME_IMPORT',path,'Import escapes repository');continue;}
      if(legacy.has(target)&&!isCanonical(target))fail('LEGACY_UI_IMPORT',path,`Imports baseline presentation: ${target}`);
      visit(target);
    }
  };
  roots.forEach(visit);
  return {errors};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),arg=n=>args[args.indexOf(n)+1];
  const result=checkUiOrigin({repoRoot:process.cwd(),inventoryPath:arg('--inventory'),phase:arg('--phase')??'migration'});
  console.log(JSON.stringify(result,null,2));if(result.errors.length)process.exitCode=1;
}

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const excluded = /^(?:node_modules|\.next|\.git|\.codegraph|\.superpowers|dist|build|coverage|__tests__|__fixtures__|tests?|test-results|playwright-report|artifacts)$/i;
export const permittedInput = (p) => !p.split(/[\\/]/).some(s => excluded.test(s))
  && !/(?:^|\/)[^/]*\.env(?:\.[^/]*)?$|\.(?:spec|test)\.[^/]+$|\.(?:log|trace|pem|key|p12|pfx|map)$/i.test(p);
export const sha256 = (content) => createHash('sha256').update(content).digest('hex');
export function walkFiles(root, prefix = '') {
  const result = [];
  const folder = join(root, prefix);
  if (!existsSync(folder)) return result;
  for (const item of readdirSync(folder, {withFileTypes:true})) {
    const p = [prefix,item.name].filter(Boolean).join('/');
    if (!permittedInput(p) || item.isSymbolicLink()) continue;
    if (item.isDirectory()) result.push(...walkFiles(root,p));
    else if(item.isFile()) result.push(p);
  }
  return result.sort();
}
export function discoverPreviewInputs({sourceRoot,inventory}) {
  const config=inventory.uiSource.discovery;
  const paths=new Set();
  for(const root of config.includeRoots) for(const file of walkFiles(sourceRoot, root.replace(/\/$/,''))) paths.add(file);
  for(const file of [...(config.displayHelpers??[]),...inventory.uiSource.files.map(f=>f.path)]) {
    if(permittedInput(file) && existsSync(join(sourceRoot,file))) paths.add(file);
  }
  return [...paths].sort();
}
export function auditPreviewInputs({sourceRoot,inventory}) {
  const known=new Map(inventory.uiSource.files.map(f=>[f.path,f.sha256]));
  const found=discoverPreviewInputs({sourceRoot,inventory});
  const current=new Set(found);
  return {
    added:found.filter(p=>!known.has(p)),
    changed:found.filter(p=>known.has(p)&&sha256(readFileSync(join(sourceRoot,p)))!==known.get(p)),
    missing:[...known.keys()].filter(p=>permittedInput(p)&&!current.has(p)).sort(),
  };
}
// The audit emits contract metadata only. Never emit JSX, CSS, labels or render function source.
export function extractContractMetadata(source,path) {
  const ts=createRequire(import.meta.url)('typescript');
  const file=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const requests=[],dependencies=[];
  const safeText=node=>node&&!/[<>]/.test(node.getText(file))?node.getText(file):undefined;
  const visit=node=>{
    if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier))dependencies.push(node.moduleSpecifier.text);
    if(ts.isCallExpression(node)&&/^(?:request|ledgerRequest|apiRequest|publicRequest|useWorkspaceData|(?:[\w.]+\.)?run)$/.test(node.expression.getText(file))) {
      const argument=node.arguments[0];
      const pathText=argument&&(ts.isStringLiteral(argument)?argument.text:safeText(argument));
      if(pathText&&/^['"`]?\//.test(pathText)) {
        const command=/(?:^|\.)run$/.test(node.expression.getText(file));
        let method=command?'POST':'GET',payloadFields=[];
        if(command){
          if(node.arguments[2]&&ts.isStringLiteral(node.arguments[2]))method=node.arguments[2].text;
          if(node.arguments[1]&&ts.isObjectLiteralExpression(node.arguments[1]))payloadFields=node.arguments[1].properties.map(p=>p.name?.getText(file)).filter(Boolean).sort();
        }
        const options=node.arguments[1];
        if(!command&&options&&ts.isObjectLiteralExpression(options))for(const field of options.properties) {
          if(!ts.isPropertyAssignment(field))continue;
          const name=field.name.getText(file).replace(/["']/g,'');
          if(name==='method'&&ts.isStringLiteral(field.initializer))method=field.initializer.text;
          if(name==='body') {
            const body=field.initializer;
            const object=ts.isCallExpression(body)?body.arguments[0]:body;
            if(object&&ts.isObjectLiteralExpression(object))payloadFields=object.properties.map(p=>p.name?.getText(file)).filter(Boolean).sort();
            else if(object)payloadFields=[`$${safeText(object)??'variable'}`];
          }
        }
        requests.push({path:pathText,method,responseType:node.typeArguments?.[0]?.getText(file)??'unknown',payloadFields});
      }
    }
    if((ts.isJsxSelfClosingElement(node)||ts.isJsxOpeningElement(node))&&node.tagName.getText(file)==='DataForm') {
      const attributes=node.attributes.properties;
      const value=name=>{
        const attribute=attributes.find(p=>ts.isJsxAttribute(p)&&p.name.getText(file)===name);
        return attribute?.initializer&&(ts.isJsxExpression(attribute.initializer)?attribute.initializer.expression:attribute.initializer);
      };
      const pathNode=value('path'),fields=value('fields');
      const pathText=pathNode&&(ts.isStringLiteral(pathNode)?pathNode.text:safeText(pathNode));
      if(pathText&&/^['"`]?\//.test(pathText)) {
        const payloadFields=[];
        if(fields&&ts.isArrayLiteralExpression(fields))for(const field of fields.elements)if(ts.isObjectLiteralExpression(field)) {
          const name=field.properties.find(p=>p.name?.getText(file)==='name');
          if(name&&ts.isPropertyAssignment(name)&&ts.isStringLiteral(name.initializer))payloadFields.push(name.initializer.text);
        }
        const methodNode=value('method');
        requests.push({path:pathText,method:methodNode&&ts.isStringLiteral(methodNode)?methodNode.text:'POST',responseType:'unknown',payloadFields:payloadFields.sort()});
      }
    }
    ts.forEachChild(node,visit);
  };
  visit(file);
  return {requests,dependencies:[...new Set(dependencies)].sort()};
}
export function auditRouteContracts({repoRoot,routes}) {
  const ts=createRequire(import.meta.url)('typescript');
  const program=ts.createProgram(routes.map(r=>join(repoRoot,r.sourceFile)),{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
    jsx:ts.JsxEmit.Preserve,baseUrl:join(repoRoot,'apps/web'),paths:{'@/*':['src/*']},skipLibCheck:true,noEmit:true,
  });
  const checker=program.getTypeChecker();
  return routes.map(row=>{
    const seen=new Set(),files=new Set(),requests=new Map();
    const follow=node=>{
      let symbol=checker.getSymbolAtLocation(node);
      if(symbol?.flags&ts.SymbolFlags.Alias)symbol=checker.getAliasedSymbol(symbol);
      for(const declaration of symbol?.declarations??[])if(ts.isFunctionDeclaration(declaration)||ts.isVariableDeclaration(declaration)||ts.isPropertyAssignment(declaration)||ts.isMethodDeclaration(declaration))visit(declaration);
    };
    const visit=node=>{
      const file=node.getSourceFile();
      const path=relative(repoRoot,file.fileName).replaceAll('\\','/');
      if(!path.startsWith('apps/web/src/')||file.isDeclarationFile||path.includes('/generated/'))return;
      const key=path+':'+node.pos+':'+node.end;
      if(seen.has(key))return;seen.add(key);files.add(path);
      if(ts.isImportDeclaration(node))return;
      if((ts.isCallExpression(node)&&/^(?:request|ledgerRequest|apiRequest|publicRequest|useWorkspaceData|(?:[\w.]+\.)?run)$/.test(node.expression.getText(file)))||((ts.isJsxSelfClosingElement(node)||ts.isJsxOpeningElement(node))&&node.tagName.getText(file)==='DataForm')) {
        const metadata=extractContractMetadata(node.getText(file),path);
        for(const request of metadata.requests)requests.set(request.method+' '+request.path,{...request,source:path});
      }
      if(ts.isIdentifier(node)&&!(ts.isPropertyAccessExpression(node.parent)&&node.parent.expression===node))follow(node);
      ts.forEachChild(node,visit);
    };
    const file=program.getSourceFile(join(repoRoot,row.sourceFile));
    if(!file)throw new Error(`Missing baseline route: ${row.sourceFile}`);
    visit(file);
    return {route:row.route,sourceFile:row.sourceFile,requests:[...requests.values()].sort((a,b)=>(a.method+a.path).localeCompare(b.method+b.path)),retainedLogic:[...files].filter(p=>p.includes('/lib/')).sort()};
  });
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), option=(n)=>args[args.indexOf(n)+1];
  const sourceRoot=option('--preview'),inventoryPath=option('--inventory');
  if(!sourceRoot||!inventoryPath) throw new Error('Required: --preview <root> --inventory <file> [--check]');
  const inventory=JSON.parse(readFileSync(inventoryPath,'utf8'));
  const result=auditPreviewInputs({sourceRoot,inventory});
  console.log(JSON.stringify(result,null,2));
  if(args.includes('--check')&&Object.values(result).some(a=>a.length))process.exitCode=1;
}

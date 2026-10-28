import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
import {spawnSync}from'node:child_process';
import {test}from'node:test';

test('web uses the approved native Next/React generation without the Next 15 WASM dependency',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.dependencies.next,'16.4.2');
  assert.equal(pkg.dependencies.react,'19.3.0');
  assert.equal(pkg.dependencies['react-dom'],'19.3.0');
  assert.equal(pkg.dependencies['@next/swc-wasm-nodejs'],undefined);
});
for(const [flag,value]of [['NEXT_PUBLIC_MOCK_API','true'],['NEXT_PUBLIC_USE_MOCK_API','true'],['NEXT_PUBLIC_API_MODE','mock']])test(`production refuses ${flag}=${value} before starting Next`,async()=>{
  // Replace only the external process launch; run the real executable/guard.
  const url=new URL('./run-next.mjs',import.meta.url).href;
  const script=`import {createRequire,syncBuiltinESMExports} from 'node:module';
    const cp=createRequire(import.meta.url)('node:child_process');
    cp.spawn=()=>({on(){process.stdout.write('NEXT_LAUNCH_ATTEMPT');process.exit(0)}});
    syncBuiltinESMExports();process.argv=[process.execPath,${JSON.stringify(new URL('./run-next.mjs',import.meta.url).pathname)},'build'];
    await import(${JSON.stringify(url)});`;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8',env:{...process.env,NEXT_PUBLIC_MOCK_API:'false',NEXT_PUBLIC_USE_MOCK_API:'false',NEXT_PUBLIC_API_MODE:'api',[flag]:value}});
  assert.equal(child.status,1,'mock production build must fail before Next launch');
  assert.match(child.stderr,/mock/i);
  assert.equal(child.stdout.includes('NEXT_LAUNCH_ATTEMPT'),false);
});

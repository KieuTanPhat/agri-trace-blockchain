const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {mkdtempSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const legacy=require('minimatch');

test('legacy lint API uses patched upstream engine without a second matcher',()=>{
 const engine=createRequire(require.resolve('./minimatch-legacy/index.cjs'));
 const upstream=engine('minimatch-engine');
 assert.equal(legacy.Minimatch,upstream.Minimatch);
 assert.equal(engine('minimatch-engine/package.json').version,'11.0.3');
 for(const [path,pattern,options,expected] of [
  ['src/test.ts','**/*.ts',{},true],['src/test.js','**/*.ts',{},false],
  ['.hidden','*',{},false],['.hidden','*',{dot:true},true],
  ['A.TS','*.ts',{nocase:true},true],['src/a.ts','*.ts',{matchBase:true},true],
  ['src/a.ts','src/*.{ts,tsx}',{},true],['src/a.tsx','src/*.{ts,tsx}',{},true],
  ['a.js','!*.ts',{},true],['a.ts','!*.ts',{},false],
  ['ab.ts','a?(b).ts',{},true],['a.ts','[ab].ts',{},true],
 ])assert.equal(legacy(path,pattern,options),expected,JSON.stringify({path,pattern,options}));
 assert.deepEqual(legacy.match(['a.ts','b.js'],'*.ts'),['a.ts']);
 assert.deepEqual(legacy.braceExpand('{a,b}.ts'),['a.ts','b.ts']);
 assert.equal(new legacy.Minimatch('*.TS',{nocase:true}).match('a.ts'),true);
 assert.equal(legacy.defaults({dot:true})('.hidden','*'),true);
 assert.equal(legacy.defaults({nocase:true}).defaults({dot:true}).makeRe('*.TS').test('.a.ts'),true);
 assert.equal(legacy.makeRe('*.ts').test('a.ts'),true);
 assert.equal(legacy.makeRe('*.ts').test('a.js'),false);
 assert.equal(legacy.makeRe('*.ts') instanceof RegExp,false);
 assert.equal(legacy.filter('*.ts')('a.ts'),true);
 assert.throws(()=>legacy('x',null));
});

test('ESLint and import/react plugins resolve the callable legacy API',()=>{
 for(const pkg of ['eslint','eslint-plugin-import','eslint-plugin-react','@eslint/config-array']){
  const r=createRequire(require.resolve(pkg));
  const m=r('minimatch');assert.equal(typeof m,'function',pkg);
  assert.equal(m('src/test.ts','**/*.ts'),true,pkg);
 }
});

test('patched Glob preserves sync/async traversal and honors an already aborted signal',async()=>{
 const glob=require('glob');assert.equal(require('glob/package.json').version,'14.0.3');
 const dir=mkdtempSync(join(tmpdir(),'agritrace-glob-test-'));
 try{
  writeFileSync(join(dir,'a.ts'),'');writeFileSync(join(dir,'b.js'),'');
  assert.deepEqual(glob.globSync('*.ts',{cwd:dir}),['a.ts']);
  assert.deepEqual(await glob.glob('*.ts',{cwd:dir}),['a.ts']);
  const reason=new Error('fixture cancellation'),controller=new AbortController();controller.abort(reason);
  await assert.rejects(glob.glob('**/*',{cwd:dir,signal:controller.signal}),error=>error===reason);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('real ESLint import rule still rejects forbidden internal imports',async()=>{
 const {ESLint}=require('eslint');
 const lint=new ESLint({overrideConfigFile:true,overrideConfig:[{
  plugins:{import:require('eslint-plugin-import')},
  rules:{'import/no-internal-modules':['error',{forbid:['**/private/**']}]},
 }]});
 const [blocked]=await lint.lintText("import x from './private/internal.js';",{filePath:'compat-fixture.js'});
 assert.equal(blocked.messages.filter(m=>m.ruleId==='import/no-internal-modules').length,1);
 const [allowed]=await lint.lintText("import x from './public/api.js';",{filePath:'compat-fixture.js'});
 assert.equal(allowed.errorCount,0);
});

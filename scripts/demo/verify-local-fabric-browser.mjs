import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import sharp from 'sharp';
import jsQR from 'jsqr';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../../apps/api/dist/generated/prisma/client.js';

const target=JSON.parse(await readFile(process.env.AGRITRACE_LOCAL_FABRIC_RECEIPT,'utf8'));
assert.equal(target.mode,'application');assert.equal(target.production,false);assert.equal(target.publicOrigin,'http://localhost:3000');
const run=process.env.AGRITRACE_LOCAL_FABRIC_RUN,directory=join(run,'ui');await mkdir(directory,{recursive:true});
const accounts=JSON.parse(await readFile(join(run,'accounts.json'),'utf8')).users;
const progress=JSON.parse(await readFile(join(run,'progress.json'),'utf8'));
assert.equal(progress.generation,target.generation);
const connection=new URL(`postgresql://127.0.0.1:${target.pgPort}/agri_trace?schema=public`);connection.username=process.env.POSTGRES_USER;connection.password=process.env.POSTGRES_PASSWORD;
const db=new PrismaClient({adapter:new PrismaPg({connectionString:connection.href})});
const browser=await chromium.launch({headless:true});
const phase=process.argv.includes('--qr-only')?'qr':process.argv.includes('--business-only')?'business':process.argv.includes('--public-only')?'public':'all';
const report={generation:target.generation,phase,startedAt:new Date().toISOString(),pages:[],roles:[],errors:[],allChecksPassed:false};
const refreshRequests=[];
async function paceNavigation(){
  const cutoff=Date.now()-61000;while(refreshRequests[0]<cutoff)refreshRequests.shift();
  if(refreshRequests.length>=14)await delay(Math.min(59000,Math.max(1000,refreshRequests[0]+61000-Date.now())));
}
async function session(key) {
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'vi-VN'}),page=await context.newPage();
  const state={key,context,page,authenticated:false,apiFailures:[],pageErrors:[]};
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/auth/refresh')refreshRequests.push(Date.now());});
  page.on('pageerror',e=>state.pageErrors.push(e.message));
  page.on('response',r=>{
    const url=new URL(r.url());if(url.origin!==`http://localhost:${target.apiPort}`||r.status()<400)return;
    if(!state.authenticated&&url.pathname==='/api/auth/refresh'&&r.status()===401)return;
    state.apiFailures.push({path:url.pathname,status:r.status()});
  });
  if(key) {
    const account=accounts.find(a=>a.key===key);assert.ok(account);
    await paceNavigation();await page.goto(target.publicOrigin+'/login');
    await page.getByRole('textbox',{name:'Email',exact:true}).fill(account.email);
    await page.getByRole('textbox',{name:'Mật khẩu',exact:true}).fill(account.password);
    await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
    await page.waitForURL(u=>!u.pathname.includes('/login'),{timeout:60000});
    state.authenticated=true;report.roles.push(key);
  }
  return state;
}
async function inspect(state,path,label,width=1440,{table=false,photos=false,expected=[]}={}) {
  const {page}=state,start=state.apiFailures.length;
  await paceNavigation();
  await page.setViewportSize({width,height:1000});
  const response=await page.goto(target.publicOrigin+path);assert.equal(response.status(),200,`${label}: HTTP page status`);
  await page.waitForLoadState('networkidle',{timeout:45000});
  await page.waitForFunction(()=>{
    const root=document.querySelector('main')??document.body;
    return root.innerText.trim().length>30&&!/Đang kiểm tra phiên đăng nhập/.test(root.innerText);
  },null,{timeout:30000});
  await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=innerHeight*.8){scrollTo(0,y);await new Promise(r=>setTimeout(r,70));}scrollTo(0,0);});
  await page.waitForLoadState('networkidle',{timeout:45000});
  const text=await page.locator('body').innerText();
  assert.ok(!/Application error|Chưa xác minh được quyền truy cập|404: This page could not be found|\bDEMO\b/i.test(text),`${label}: error or unwanted dataset label`);
  for(const value of expected)assert.ok(text.includes(value),`${label}: missing expected dataset content`);
  assert.equal(state.pageErrors.length,0,`${label}: browser exception`);
  assert.deepEqual(state.apiFailures.slice(start),[],`${label}: failed API requests`);
  if(table&&width>=1000)assert.ok(await page.locator('table tbody tr').count()>0,`${label}: missing data rows`);
  const images=await page.locator('img').evaluateAll(items=>items.map(i=>({src:i.currentSrc||i.src,alt:i.alt,complete:i.complete,width:i.naturalWidth,height:i.naturalHeight})));
  assert.equal(images.filter(i=>i.complete&&i.width===0).length,0,`${label}: broken image`);
  if(photos)assert.ok(images.filter(i=>i.width>150&&i.alt!=='AgriTrace').length>0,`${label}: no dataset photo`);
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
  assert.ok(dimensions.document<=dimensions.viewport+2,`${label}: document overflows at ${width}px`);
  const file=join(directory,`${label}-${width}.png`);await page.screenshot({path:file,fullPage:true});
  report.pages.push({role:state.key??'public',path,label,width,screenshot:file,headings:await page.locator('h1,h2').allTextContents(),images:images.length,dimensions});
  console.log(`PASS browser ${state.key??'public'} ${width}px ${path}`);
}
try {
  if(['all','business'].includes(phase)) {
    const farm=await session('O01');
    for(const [path,label,options]of [
      ['/enterprise/profile','farm-profile',{}],['/enterprise/products','farm-products',{table:true}],
      ['/production-cycles','farm-cycles',{table:true}],['/lots','farm-lots',{table:true}],['/distribution','farm-distribution',{}],
      ['/enterprise/inventory','farm-inventory',{}],['/enterprise/qr','farm-qr',{}],['/enterprise/members','farm-members',{expected:[accounts.find(a=>a.key==='O01Manager').fullName]}],['/supply-chains','farm-chains',{}]])
      await inspect(farm,path,label,1440,options);
    const product=progress.steps.resources.products.find(p=>p.owner==='O01');
    await inspect(farm,'/enterprise/products/'+product.id,'farm-product-detail',1440,{photos:true});
    const active=progress.steps.production.cycles.find(c=>c.owner==='O01'&&c.desiredState==='GROWING');
    await inspect(farm,'/production-cycles/'+active.id,'active-cycle',390);
    await inspect(farm,'/distribution','distribution-narrow',320);
    await farm.context.close();
    for(const [key,pages]of [
      ['O06',[['/enterprise/processing','processor-runs'],['/enterprise/inventory','processor-stock']]],
      ['O03',[['/enterprise/vehicles','carrier-vehicles'],['/distribution','carrier-distribution']]],
      ['O02',[['/enterprise/inventory','distributor-stock']]],['O07',[['/enterprise/inventory','retailer-stock'],['/enterprise/qr','retailer-qr']]],
      ['O01Staff1',[['/production-cycles','staff-cycles']]],['O13',[['/production-cycles','auditor-cycles']]],
      ['O13Staff1',[['/production-cycles','reviewer-cycles'],['/compliance','reviewer-compliance']]],
      ['admin',[['/admin','platform-dashboard'],['/admin/enterprises','platform-enterprises'],['/admin/lots','platform-lots'],['/admin/ledger','platform-ledger'],['/admin/cases','platform-cases']]],
      ['operator',[['/admin/operations','operator-health']]],['cases',[['/admin/cases','case-list']]],['privacy',[['/admin/privacy','privacy-requests']]],
      ['O17',[['/enterprise/profile','enrollment-pending']]],['O18',[['/enterprise/profile','enrollment-rejected']]],
    ]) {
      const state=await session(key);for(const [path,label]of pages)await inspect(state,path,label);await state.context.close();
    }
  }
  if(['all','public'].includes(phase)) {
    const publicSession=await session(null);
    await inspect(publicSession,'/','public-home',390);await inspect(publicSession,'/scan','public-scanner',768);
    const processed=await db.lot.findFirstOrThrow({where:{processingRunId:{not:null}}});
    const samples=[['processed',processed.id]];
    for(const state of ['HARVESTED','IN_TRANSPORT','ARRIVED','RETAIL_RECEIVED','FOR_SALE','SOLD','REJECTED','DAMAGED','EXPIRED']) {
      const lot=await db.lot.findFirst({where:{currentState:state,harvestId:{not:null}}});if(lot)samples.push([state.toLowerCase(),lot.id]);
    }
    const recall=await db.traceNotice.findFirst({where:{kind:'RECALL'}});if(recall)samples.push(['recall',recall.lotId]);
    for(const [label,id]of samples) {
      const qr=await db.traceQr.findUniqueOrThrow({where:{lotId:id}});
      await inspect(publicSession,new URL(qr.traceUrl).pathname,'trace-'+label,390,{photos:true});
      if(['processed','harvested'].includes(label))await inspect(publicSession,new URL(qr.traceUrl).pathname,'trace-'+label,1440,{photos:true});
    }
    await publicSession.context.close();
  }
  if(['all','qr'].includes(phase)) {
    report.qrImages=[];
    for(const key of ['O01','O06']){
      const state=await session(key);await inspect(state,'/enterprise/qr','rendered-qr-'+key);
      const nodes=state.page.locator('svg[role="img"][aria-label="Mã QR truy xuất"]');
      assert.ok(await nodes.count()>0,'Rendered warehouse QR is missing');
      for(let i=0;i<Math.min(3,await nodes.count());i++){
        let svg=await nodes.nth(i).evaluate(node=>node.outerHTML);
        if(!svg.includes('xmlns='))svg=svg.replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" ');
        const {data,info}=await sharp(Buffer.from(svg)).resize(600,600,{kernel:'nearest'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        const result=jsQR(new Uint8ClampedArray(data),info.width,info.height);assert.ok(result,'Rendered QR could not be decoded');
        const url=new URL(result.data);assert.equal(url.origin,target.publicOrigin);assert.ok(url.pathname.startsWith('/trace/'));
        const qr=await db.traceQr.findUniqueOrThrow({where:{traceToken:decodeURIComponent(url.pathname.split('/').at(-1))}});
        assert.equal(qr.traceUrl,result.data);
        await writeFile(join(directory,`rendered-${key}-${i}.svg`),svg);
        report.qrImages.push({role:key,lotId:qr.lotId,url:result.data});
      }
      await state.context.close();
    }
    assert.equal(report.qrImages.length,6);console.log('PASS six rendered raw/processed QR images decode to their exact database trace URL.');
  }
  report.allChecksPassed=true;report.completedAt=new Date().toISOString();
}catch(error){let message=error.message;for(const account of accounts)message=message.replaceAll(account.password,'<redacted>');report.errors.push(message);console.error(message);process.exitCode=1;}
finally{
  await writeFile(join(run,`browser-${phase}.json`),JSON.stringify(report,null,2),{mode:0o600});
  if(phase==='all'&&report.allChecksPassed)await writeFile(join(run,'browser-verification.json'),JSON.stringify(report,null,2),{mode:0o600});
  if(phase!=='all'&&report.allChecksPassed) {
    let business,publicReport,qrReport;
    try{business=JSON.parse(await readFile(join(run,'browser-business.json'),'utf8'));publicReport=JSON.parse(await readFile(join(run,'browser-public.json'),'utf8'));qrReport=JSON.parse(await readFile(join(run,'browser-qr.json'),'utf8'));}catch{}
    if([business,publicReport,qrReport].every(r=>r?.generation===target.generation&&r.allChecksPassed))
      await writeFile(join(run,'browser-verification.json'),JSON.stringify({generation:target.generation,allChecksPassed:true,completedAt:new Date().toISOString(),
        roles:business.roles,pages:[...business.pages,...publicReport.pages,...qrReport.pages],qrImages:qrReport.qrImages,errors:[]},null,2),{mode:0o600});
  }
  await browser.close();await db.$disconnect();
}

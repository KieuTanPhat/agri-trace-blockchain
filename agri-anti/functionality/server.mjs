import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBatches,getDashboard,getPublicTrace,submitCommand,sendSensorReading } from './lib/api-client.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT||3100);
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let value='';for await(const chunk of req){value+=chunk;if(value.length>16384)throw {status:413,message:'Dữ liệu quá lớn'};}try{return JSON.parse(value||'{}');}catch{throw {status:422,message:'Dữ liệu không hợp lệ'};}}
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
  if(req.method==='GET'&&url.pathname==='/api/batches')return json(res,200,await getBatches());
  if(req.method==='GET'&&url.pathname==='/api/dashboard')return json(res,200,await getDashboard());
  if(req.method==='GET'&&url.pathname==='/api/session')return json(res,200,{isAuthenticated:true,user:{userId:'user-farm-01',organizationId:'org-farm-01',organizationName:'HTX Rau Sạch Củ Chi',role:'FARM_STAFF'},mode:'demo'});
  if(req.method==='GET'&&url.pathname.startsWith('/api/trace/')){let code=decodeURIComponent(url.pathname.slice(11));if(process.env.NEXT_PUBLIC_MOCK_API!=='false')code=({'AT000123456':'batch-rau-001','AT000234567':'batch-xoai-002'})[code]||code;const b=await getPublicTrace(code);return json(res,b?200:404,b||{status:404,message:'Không tìm thấy mã truy xuất.'});}
  const command=url.pathname.match(/^\/api\/batches\/([^/]+)\/commands\/([^/]+)$/);
  if(req.method==='POST'&&command){const batches=await getBatches(),b=batches.find(x=>x.batchId===decodeURIComponent(command[1]));if(!b)return json(res,404,{message:'Không tìm thấy lô.'});if(!b.allowedCommands.includes(command[2]))return json(res,403,{message:'Thao tác không được phép cho lô này.'});return json(res,200,await submitCommand(b.batchId,command[2]));}
  if(req.method==='POST'&&url.pathname==='/api/iot/readings'){const input=await body(req);if(!input.deviceId||!input.batchId||!Number.isFinite(input.temperature)||!Number.isFinite(input.humidity)||Number.isNaN(Date.parse(input.timestampUtc)))return json(res,422,{message:'Thiếu thông tin hoặc dữ liệu cảm biến không hợp lệ.'});return json(res,200,await sendSensorReading(input));}
  return json(res,404,{message:'Không tìm thấy chức năng.'});
 }
 let pathname=decodeURIComponent(url.pathname);if(pathname==='/'){res.writeHead(302,{location:'/wireframes/public/home.html'});return res.end();}
 const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep))return json(res,403,{message:'Không được truy cập.'});
 if(!(pathname.startsWith('/wireframes/')||pathname.startsWith('/AgriTrace-Full-UI-and-Assets/')||pathname==='/functionality/client.mjs'||pathname.startsWith('/functionality/lib/')||pathname.startsWith('/functionality/vendor/')))return json(res,404,{message:'Không tìm thấy trang.'});
 const ext=path.extname(file),types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.css':'text/css','.woff2':'font/woff2'};
 let content=await fs.readFile(file);if(ext==='.html'){content=content.toString('utf8').replace('https://cdn.tailwindcss.com','/functionality/vendor/tailwind.js');if(!url.searchParams.has('reference'))content=content.replace('</body>','<script type="module" src="/functionality/client.mjs"></script></body>');}
 res.writeHead(200,{'content-type':types[ext]||'application/octet-stream','cache-control':'no-cache'});res.end(content);
 }catch(e){json(res,e.status|| (e.code==='ENOENT'?404:503),{message:e.message||'Hệ thống tạm thời không khả dụng.'});}
}).listen(port,'127.0.0.1',()=>console.log(`AgriTrace giao diện gốc: http://localhost:${port}`));

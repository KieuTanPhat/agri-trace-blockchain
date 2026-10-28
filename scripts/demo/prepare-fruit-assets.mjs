import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { freshProducts, processedProducts } from './fruit-catalog.mjs';

const source = resolve(process.argv[2] ?? 'C:/Users/kieup/Desktop/Data');
const out = resolve('.codex/fruit-assets');
await mkdir(out,{recursive:true});
const photos=[];
async function photo(key,path,description) {
  const original=await readFile(path);
  const bytes=await sharp(original).rotate().resize({width:1100,withoutEnlargement:false}).jpeg({quality:85}).toBuffer();
  const file=`${key}.jpg`;
  await writeFile(join(out,file),bytes);
  photos.push({key,file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,source:path,
    sourceSha256:createHash('sha256').update(original).digest('hex'),author:'Operator-provided asset',description});
}
for(const p of [...freshProducts,...processedProducts]) await photo(p.slug,join(source,'AnhSanPham',p.source?'CheBien':'SanPham',p.file),p.name);
for(const [key,file] of Object.entries({care:'Chamsoc1.jpg',care2:'Chamsoc2.webp',inspect:'kiemtra1.jpg',harvest:'thuhoach1.jpg',harvest2:'thuhoach2.jpg',harvest3:'thuhoach3.jpg',lot:'Lohang.jpg',water:'tuoicay1.jpg',protection:'phunthuoc1.jpg'})) {
  await photo(key,join(source,'AnhChamSoc',file),`Hình ảnh ${key}`);
}
for(let i=1;i<=6;i++) await photo(`warehouse${i}`,join(source,'AnhNhaKho',`nhakho${i}.jpg`),'Cơ sở bảo quản và tiếp nhận hàng');
await photo('reference-cert',join(out,'reference-9.jpg'),'Bản tham khảo hồ sơ kiểm tra đã ẩn thông tin định danh');
// Aliases support the maintained checkpointed scenario runner. Product and lot
// uploads use their exact product key; these aliases illustrate shared activity.
for(const [key,target] of Object.entries({tomato1:'mit',tomato2:'chuoi',tomato3:'harvest',berry1:'dualuoi',berry2:'thanhlong',berry3:'water',tomatoField:'care',greenhouse:'warehouse2',logistics:'warehouse1'})) photos.push({...photos.find(p=>p.key===target),key});
const names={farm:'BÌNH MINH',berry:'PHÚ AN',garden:'MIỆT VƯỜN',carrier:'AN TÂM',distributor:'VIỆT XANH',retailer:'AN LÀNH',processor:'MÙA VÀNG',auditor:'VIỆT TÍN'};
const suppliedLogos={farm:'logo8.jpg',berry:'logo2.avif',garden:'logo1.avif',carrier:'logo3.jpg',distributor:'logo6.png',retailer:'logo5.jpg',processor:'logo7.avif',auditor:'logo4.png'};
for(const [key,name] of Object.entries(names)) {
  try {
    await photo(`logo-${key}`,join(source,'logoDoanhNghiep',suppliedLogos[key]),`Logo ${name}`);
    continue;
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  // Repo-native vector wordmarks, rendered for the existing JPEG/PNG evidence API.
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600"><rect width="1000" height="600" rx="40" fill="#f5f7f0"/><circle cx="500" cy="215" r="115" fill="#174d36"/><path d="M440 260 Q420 135 570 125 Q585 240 440 260Z" fill="#a9cd61"/><path d="M450 250L550 150" stroke="#f5f7f0" stroke-width="8"/><text x="500" y="440" text-anchor="middle" font-family="Arial,sans-serif" font-size="60" font-weight="700" fill="#174d36">${name}</text><text x="500" y="495" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" letter-spacing="7" fill="#57715c">NÔNG SẢN &amp; CHUỖI GIÁ TRỊ</text></svg>`;
  const bytes=await sharp(Buffer.from(svg)).jpeg({quality:90}).toBuffer(),file=`logo-${key}.jpg`;
  await writeFile(join(out,file),bytes);
  photos.push({key:`logo-${key}`,file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,source:'Original vector wordmark',author:'AgriTrace dataset',description:`Logo ${name}`});
}
await writeFile(join(out,'manifest.json'),JSON.stringify({syntheticBusinessData:true,sourceRoot:source,photos},null,2));
console.log(`Prepared ${photos.length} asset entries for 28 products; originals untouched.`);

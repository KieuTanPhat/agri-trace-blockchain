const columns=['productName','sku','category','originFarmId','gtin','variety','defaultUnit','storageConditions','ingredients','usageInstructions','price','description'] as const;
const required=['productName','sku','category','originFarmId','defaultUnit','storageConditions','ingredients','usageInstructions'];
export function parseCatalogCsv(source:string):Record<string,string|number>[] {
 const rows:string[][]=[],row:string[]=[];let cell='',quoted=false,closed=false;
 const text=source.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c==='"'){if(cell||closed)throw new Error('Dấu nháy không hợp lệ trong CSV');quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){row.push(cell);cell='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v.trim()))rows.push([...row]);row.length=0;}continue;}
  if(closed)throw new Error('Ký tự ngoài dấu nháy CSV');cell+=c;
 }
 if(quoted)throw new Error('CSV chưa đóng dấu nháy');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 const header=rows.shift()?.map(v=>v.trim());if(!header||header.length!==new Set(header).size||header.some(c=>!columns.includes(c as typeof columns[number]))||!required.every(c=>header.includes(c)))throw new Error('Dùng mẫu CSV có đủ tên, mã, danh mục, mã vùng xuất xứ, đơn vị, bảo quản, thành phần và hướng dẫn sử dụng');
 if(!rows.length||rows.length>200)throw new Error('Mỗi lần nhập từ 1 đến 200 sản phẩm');
 return rows.map((values,i)=>{if(values.length!==header.length)throw new Error(`Dòng ${i+2} không đủ hoặc dư cột`);const row=Object.fromEntries(header.map((name,j)=>[name,values[j].trim()]).filter(([,v])=>v!=='')) as Record<string,string|number>;if(required.some(name=>!String(row[name]??'').trim()))throw new Error(`Dòng ${i+2} thiếu trường bắt buộc`);if(row.price!==undefined){const price=Number(row.price);if(!Number.isFinite(price)||price<0)throw new Error(`Dòng ${i+2}: giá không hợp lệ`);row.price=price;}return row;});
}
export const catalogCsvTemplate='\uFEFFproductName,sku,category,originFarmId,gtin,variety,defaultUnit,storageConditions,ingredients,usageInstructions,price,description\r\n';

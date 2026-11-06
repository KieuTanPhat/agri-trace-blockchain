import assert from 'node:assert/strict';

export const organizationDefinitions = [
  ['O01','Công ty Cổ phần Nông nghiệp Đại Việt','FARM','BAC','logo1.avif'],
  ['O02','Công ty Phân phối Minh Long','DISTRIBUTOR','BAC','logo2.avif'],
  ['O03','Công ty Vận tải Hồng Phát','TRANSPORTER','TRUNG','logo3.jpg'],
  ['O04','Công ty Phân phối Liên Kết','DISTRIBUTOR','NAM','logo4.png'],
  ['O05','Công ty Thương mại Ngũ Châu','DISTRIBUTOR','TRUNG','logo5.jpg'],
  ['O06','Công ty Thực phẩm Hải Hà','PROCESSOR','BAC','logo6.png'],
  ['O07','Cửa hàng Thực phẩm Kim Long','RETAILER','BAC','logo7.avif'],
  ['O08','Công ty Nông nghiệp Hành Tinh Xanh','FARM','TRUNG','logo8.jpg'],
  ['O09','Công ty Thực phẩm Sunhouse','PROCESSOR','TRUNG','logo9.png'],
  ['O10','Công ty Vận tải Sơn Hải','TRANSPORTER','NAM','logo10.jpg'],
  ['O11','Cửa hàng Nông sản Phúc Gia','RETAILER','NAM','logo11.avif'],
  ['O12','Cửa hàng Thực phẩm Tân Phát','RETAILER','TRUNG','logo12.jpg'],
  ['O13','Công ty Tư vấn và Đánh giá Hoàng An','AUDITOR','BAC','logo13.jpg'],
  ['O14','Công ty Đánh giá Chất lượng Alpha','AUDITOR','NAM','logo14.webp'],
  ['O15','Công ty Thương mại Modana','DISTRIBUTOR','NAM','logo15.png'],
  ['O16','Công ty Nông nghiệp Lộc Xanh','FARM','NAM','logo16.jpg'],
  ['O17','Cửa hàng Thực phẩm Adoni','RETAILER','BAC','logo17.jpg','PENDING_REVIEW'],
  ['O18','Cửa hàng J&A','RETAILER','TRUNG','logo18.jpg','REJECTED'],
  ['O19','Công ty Thực phẩm Kinh Đô','PROCESSOR','NAM','logo19.png'],
  ['O20','Công ty Vận tải Casa','TRANSPORTER','BAC','logo20.jpg'],
].map(([key,name,type,region,logo,status='APPROVED']) => ({key,name,type,region,logo,status,
  owner: ['O01','O08','O06','O09','O19'].includes(key)}));

const names = `mit=Mít Thái|saurieng=Sầu riêng Ri6|xoai=Xoài cát Hòa Lộc|chuoi=Chuối già Nam Mỹ|cam=Cam sành|buoi=Bưởi da xanh|chanh=Chanh không hạt|quyt=Quýt đường|duahau=Dưa hấu ruột đỏ|dualuoi=Dưa lưới ruột cam|duagan=Dưa gang|duale=Dưa lê|dudu=Đu đủ ruột đỏ|thanhlong=Thanh long ruột trắng|chomchom=Chôm chôm nhãn|nhan=Nhãn xuồng|mangcut=Măng cụt|mangcau=Mãng cầu ta|me=Me ngọt|vusua=Vú sữa Lò Rèn|oi=Ổi lê|coc=Cóc Thái|dua=Dừa xiêm|bo=Bơ sáp|thom=Thơm Queen|bapcai=Bắp cải trắng|cachua=Cà chua|caithao=Cải thảo|caithia=Cải thìa|carot=Cà rốt|catim=Cà tím|chanhvang=Chanh vàng|cucai=Củ cải đỏ|cucaitrang=Củ cải trắng|dauhalan=Đậu Hà Lan|daunanh=Đậu nành|duachuot=Dưa chuột|gung=Gừng|hanhtay=Hành tây|khoailang=Khoai lang|khoaitay=Khoai tây|kiwi=Kiwi xanh|le=Lê|luu=Lựu|ngo=Ngô ngọt|nho=Nho xanh|ot=Ớt đỏ|otchuong=Ớt chuông|suplotrang=Súp lơ trắng|tao=Táo đỏ|taoxanh=Táo xanh|toi=Tỏi|xalach=Xà lách|dautay=Dâu tây|vietquat=Việt quất|namvietquat=Nam việt quất|phucbontudo=Phúc bồn tử đỏ|mamxoiden=Mâm xôi đen|lychuaden=Lý chua đen|lychuado=Lý chua đỏ|anhdao=Anh đào|dao=Đào|xuandao=Xuân đào|mo=Mơ|manbac=Mận Bắc|roi=Roi đỏ|honggion=Hồng giòn|hongxiem=Hồng xiêm|na=Na dai|chanhday=Chanh dây|khe=Khế ngọt|vai=Vải thiều|bonbon=Bòn bon|daudadat=Dâu da đất|daudaxoan=Dâu da xoan|hongbi=Hồng bì|tramden=Trám đen|tramtrang=Trám trắng|sau=Sấu|taota=Táo ta|taotau=Táo tàu|sung=Sung|va=Vả|chala=Chà là|oliu=Ô liu|duahauruotvang=Dưa hấu ruột vàng|thanhlongruotdo=Thanh long ruột đỏ|oiruothong=Ổi ruột hồng|buoiruotdo=Bưởi ruột đỏ|kiwivang=Kiwi vàng|chanhngontay=Chanh ngón tay|tambop=Tầm bóp|raumuong=Rau muống|raungot=Rau ngót|raudendo=Rau dền đỏ|raudenxanh=Rau dền xanh|mongtoi=Mồng tơi|rauday=Rau đay|raulang=Rau lang|caiboxoi=Cải bó xôi|caixoan=Cải xoăn|caibexanh=Cải bẹ xanh|caingot=Cải ngọt|cailan=Cải làn|caicuc=Cải cúc|caixoong=Cải xoong|bapcaitim=Bắp cải tím|suploxanh=Súp lơ xanh|suhao=Su hào|cucaidotron=Củ cải đỏ tròn|cucaiden=Củ cải đen|cucaivang=Củ cải vàng|cucan=Củ cần|cuhoi=Củ hồi|cucaingua=Củ cải ngựa|cudenvang=Củ dền vàng|carottim=Cà rốt tím|carottrang=Cà rốt trắng|bido=Bí đỏ|bidao=Bí đao|bingoi=Bí ngòi|bau=Bầu|muophuong=Mướp hương|muopkhia=Mướp khía|khoqua=Khổ qua|susu=Su su|daubap=Đậu bắp|caphao=Cà pháo|cachuabi=Cà chua bi|cachuavang=Cà chua vàng|dualeogai=Dưa leo gai|atiso=Atisô|mangtay=Măng tây|mangtre=Măng tre|ngosen=Ngó sen|cusen=Củ sen|hoathienly=Hoa thiên lý|bongdiendien=Bông điên điển|bongsodua=Bông so đũa|raucangcua=Rau càng cua|raunhut=Rau nhút|rauma=Rau má|luate=Lúa tẻ|luanep=Lúa nếp|luami=Lúa mì|luamach=Lúa mạch|yenmach=Yến mạch|luamachden=Lúa mạch đen|caoluong=Cao lương|ke=Kê|diemmach=Diêm mạch|kieumach=Kiều mạch|hatden=Hạt dền|ydi=Ý dĩ|dauxanh=Đậu xanh|dauden=Đậu đen|daudo=Đậu đỏ|dautrang=Đậu trắng|dauga=Đậu gà|daulang=Đậu lăng|dauphong=Đậu phộng|metrang=Mè trắng|meden=Mè đen|hathuongduong=Hạt hướng dương|hatchia=Hạt chia|hatlanh=Hạt lanh|hatdieu=Hạt điều|hatoccho=Hạt óc chó|hanhnhan=Hạnh nhân|san=Sắn|khoaimon=Khoai môn|hanhla=Hành lá|hanhtim=Hành tím|he=Hẹ|toitay=Tỏi tây|cantay=Cần tây|raumui=Rau mùi|ngogai=Ngò gai|thila=Thì là|hungque=Húng quế|hunglui=Húng lủi|tiato=Tía tô|kinhgioi=Kinh giới|diepca=Diếp cá|lalot=Lá lốt|sa=Sả|rieng=Riềng|nghevang=Nghệ vàng|hotieu=Hồ tiêu|caphe=Cà phê nhân|cacao=Ca cao|namrom=Nấm rơm|nambaongu=Nấm bào ngư|namhuong=Nấm hương|namkimcham=Nấm kim châm|nammo=Nấm mỡ|nammeo=Nấm mèo`;
const rawNames = Object.fromEntries(names.split('|').map(s=>s.split('=')));
const processedRows = [
 ['banhmi','Bánh mì','luami','BAKING'],['banhtrang','Bánh tráng','luate','DRYING'],
 ['bodauphong','Bơ đậu phộng','dauphong','GRINDING'],['bongngo','Bỏng ngô','ngo','ROASTING'],
 ['botcacao','Bột ca cao','cacao','GRINDING'],['botmi','Bột mì','luami','GRINDING'],
 ['botngo','Bột ngô','ngo','GRINDING'],['bunkho','Bún khô','luate','DRYING'],
 ['capherangxay','Cà phê rang xay','caphe','ROASTING'],['chuoisay','Chuối sấy','chuoi','DRYING'],
 ['dauhuongduong','Dầu hướng dương','hathuongduong','PRESSING'],['daume','Dầu mè','metrang','PRESSING'],
 ['dauoliu','Dầu ô liu','oliu','PRESSING'],['dauphu','Đậu phụ','daunanh','COOKING'],
 ['duachuotmuoi','Dưa chuột muối','duachuot','FERMENTING'],['duongmia','Đường mía',null,'COOKING'],
 ['giamtao','Giấm táo','tao','FERMENTING'],['khoaitaychienlat','Khoai tây chiên lát','khoaitay','FRYING'],
 ['mansay','Mận sấy','manbac','DRYING'],['miong','Mì ống','luami','DRYING'],
 ['mitsay','Mít sấy','mit','DRYING'],['mosay','Mơ sấy','mo','DRYING'],
 ['mutdautay','Mứt dâu tây','dautay','COOKING'],['nhokho','Nho khô','nho','DRYING'],
 ['nuoccam','Nước cam','cam','JUICING'],['nuoccotdua','Nước cốt dừa','dua','PRESSING'],
 ['nuoceptao','Nước ép táo','tao','JUICING'],['nuoctuong','Nước tương','daunanh','FERMENTING'],
 ['socola','Sô cô la','cacao','COOKING'],['suadaunanh','Sữa đậu nành','daunanh','COOKING'],
 ['tuongca','Tương cà','cachua','COOKING'],['xoaisaydeo','Xoài sấy dẻo','xoai','DRYING'],
 ['yenmachcan','Yến mạch cán','yenmach','ROLLING'],
];
const processedMap = Object.fromEntries(processedRows.map(([slug,name,source,processType])=>
 [slug,{name,source,processType}]));

const farmKeys = ['O01','O08','O16'];
const ingredientSlugs = [...new Set(processedRows.map(r=>r[2]).filter(Boolean))];

export function createComprehensiveCatalog(inventory) {
  const products = inventory.assets.filter(a=>a.group==='AnhSanPham').map(a=>{
    const filename=a.relativePath.split('/').at(-1);
    const slug=filename.replace(/\.[^.]+$/,'').replace(/\d+$/,'');
    const number=Number(filename.match(/(\d+)\.[^.]+$/)?.[1]??0);
    const processed=a.relativePath.includes('/CheBien/');
    const detail=processed?processedMap[slug]:{name:slug==='dautam'?(number===56?'Dâu tằm':'Đậu tằm'):rawNames[slug]};
    assert.ok(detail?.name,`Unmapped product image: ${filename}`);
    return {...a,slug:slug==='dautam'?`${slug}${number}`:slug,filename,number,processed,...detail,
      category:processed?'Thực phẩm chế biến':number>=195?'Nấm':number>=175?'Rau gia vị':number>=145?'Ngũ cốc, đậu và hạt':number>=95?'Rau củ':'Trái cây',
      shelfDays:processed?180:number>=145&&number<=172||number>=192&&number<=194?365:21};
  }).sort((a,b)=>Number(a.processed)-Number(b.processed)||a.number-b.number);
  const fresh=products.filter(p=>!p.processed),processed=products.filter(p=>p.processed);
  assert.equal(fresh.length,199);assert.equal(processed.length,33);
  const selected={O01:[],O08:[],O16:[]};
  const unassigned=new Map(fresh.map(p=>[p.slug,p]));
  for(const slug of ingredientSlugs) {
    const p=unassigned.get(slug);assert.ok(p,`Missing ingredient ${slug}`);
    selected.O01.push(p);unassigned.delete(slug);
  }
  for(const key of farmKeys) {
    const target=key==='O01'?34:33;
    while(selected[key].length<target) {
      const p=unassigned.values().next().value;
      selected[key].push(p);unassigned.delete(p.slug);
    }
    selected[key].forEach((p,cycleIndex)=>Object.assign(p,{owner:key,cycleIndex}));
  }
  for(const key of farmKeys) {
    const target=key==='O01'?67:66;
    const remaining=target-selected[key].length;
    for(let i=0;i<remaining;i++) {
      const p=unassigned.values().next().value;unassigned.delete(p.slug);p.owner=key;
    }
  }
  processed.forEach((p,i)=>{p.owner=['O06','O09','O19'][Math.floor(i/11)];});
  assert.equal(new Set(products.map(p=>p.sha256)).size,232);
  return {products,fresh,processed,selected,ingredientSlugs};
}

export const cycleAllocations = [
 ['C01','O01',true,[2,1,4,1,2]],['C02','O08',true,[2,1,3,2,2]],
 ['C03','O16',true,[18,9,3,2,1]],['C04','O01',false,[17,7,0,0,0]],
 ['C05','O08',false,[16,7,0,0,0]],
].map(([key,owner,personal,states])=>({key,owner,personal,
 states:Object.fromEntries(['COMPLETED','GROWING','PLANTED','CREATED','CANCELLED'].map((s,i)=>[s,states[i]]))}));

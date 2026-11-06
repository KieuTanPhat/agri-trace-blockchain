import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/api/dist/generated/prisma/client.js";
import { datasetContext } from "./dataset-context.mjs";

// This is local demo-fixture content only. Real content management remains on
// the audited platform-admin API; the local seed intentionally needs no account.

if (process.env.AGRITRACE_PRODUCTION_DATASET === "true")
  throw new Error("Bộ bài viết này chỉ được nạp vào demo local.");

const context = datasetContext();
assert.equal(context.production, false, "Chỉ cho phép cập nhật demo local.");
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: context.databaseUrl }),
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const articles = [
  {
    key: "traceability-scale-2026",
    legacyTitle: "Đối chiếu nhãn lô trước khi nhận hàng",
    title: "Hơn 800.000 sản phẩm đã được đăng ký truy xuất",
    summary: "Đến giữa tháng 9/2026, hệ thống truy xuất nông sản quốc gia ghi nhận 814.000 sản phẩm từ khoảng 3.000 hộ và 207 doanh nghiệp tại 24/34 tỉnh, thành.",
    photo: "about-rice-village.jpg",
    photoCredit: ["Peter Hammer", "https://unsplash.com/photos/ggQy5lGtwb0"],
    source: "https://en.mae.gov.vn/quality-processing-and-market-development/over-800000-agricultural-products-registered-for-traceability-9663.htm",
    sourceLabel: "Bộ Nông nghiệp và Môi trường, 16/09/2026",
    body: `Bộ Nông nghiệp và Môi trường công bố số liệu này tại buổi họp báo ngày 16/09/2026. Cần phân biệt số sản phẩm đã đăng ký với số sản phẩm đã phát sinh dữ liệu tra cứu: theo cùng báo cáo, từ khi hệ thống vận hành chính thức cuối tháng 6, hơn 309.000 sản phẩm được đăng ký từ 211 hộ và 25 doanh nghiệp tại 17 tỉnh; 428 sản phẩm của 32 hộ và 11 doanh nghiệp ở 9 tỉnh đã được truy xuất. Đây là các nhóm số liệu có mốc và phạm vi khác nhau.

Hệ thống đang kết nối địa phương, doanh nghiệp và đơn vị công nghệ. Bộ cho biết công việc tiếp theo gồm chuẩn hóa dữ liệu, quy trình kết nối, hướng dẫn cho từng nhóm sản phẩm và khả năng truy xuất xuôi lẫn ngược. Số lượng bản ghi chỉ có ý nghĩa khi thông tin được gắn đúng sản phẩm, cơ sở và lô hàng, rồi cập nhật khi hàng chuyển qua các công đoạn.

Với doanh nghiệp, đây là lời nhắc cần rà soát các trường dữ liệu trước khi phát hành mã: tên hàng, đơn vị chịu trách nhiệm, vùng sản xuất, mốc thu hoạch, cơ sở đóng gói và lần bàn giao. Người mua nên quét đúng mã trên bao bì, kiểm tra thông tin của chính lô đang cầm và đọc cả cảnh báo cùng thời điểm cập nhật. Số liệu trên mô tả hệ thống quốc gia, không phải thống kê vận hành của AgriTrace.

Nguồn: ${"Bộ Nông nghiệp và Môi trường, 16/09/2026 — "}${"https://en.mae.gov.vn/quality-processing-and-market-development/over-800000-agricultural-products-registered-for-traceability-9663.htm"}
Ảnh: Peter Hammer / Unsplash — https://unsplash.com/photos/ggQy5lGtwb0`,
  },
  {
    key: "traceability-provinces-2026",
    legacyTitle: "Đọc lịch sử truy xuất và cảnh báo",
    title: "Hệ thống truy xuất nông sản đã triển khai tại 26 tỉnh, thành",
    summary: "Báo cáo tháng 6/2026 ghi nhận 18.500 sản phẩm thuộc 112 nhóm hàng và 919 lô dữ liệu; ba container sầu riêng đã xuất sang Trung Quốc với thông tin truy xuất đầy đủ.",
    photo: "tea-hills.jpg",
    photoCredit: ["Colin Roe", "https://unsplash.com/photos/H1RWuPMIgBY"],
    source: "https://en.mae.gov.vn/SMPT_Publishing_UC/KhaiThac/TinTuc/pInTinTuc.aspx?ItemID=9436",
    sourceLabel: "Bộ Nông nghiệp và Môi trường, 20/06/2026",
    body: `Theo thông tin Bộ Nông nghiệp và Môi trường công bố ngày 20/06/2026, đến giữa tháng 6 hệ thống đã được triển khai ở 26 tỉnh, thành. Nền tảng quản lý 18.500 sản phẩm thuộc 112 nhóm hàng, 919 lô dữ liệu từ 547 hộ sản xuất, 255 vùng trồng và 149 doanh nghiệp. Bộ cũng cho biết ba container sầu riêng đã xuất sang Trung Quốc với thông tin truy xuất đầy đủ tính đến ngày 10/05/2026.

Các con số cho thấy truy xuất cần nhiều hơn một mã QR. Dữ liệu phải nối được chủ thể, vùng trồng, sản phẩm, lô thu hoạch và lần giao nhận; các hệ thống của địa phương và doanh nghiệp cũng cần thống nhất cách trao đổi. Bộ nêu kế hoạch mở rộng hệ thống từ ngày 01/07/2026 tới các nhóm hàng như gạo, thịt, trứng, sữa, dứa, chanh dây và chè, đồng thời tiếp tục hoàn thiện chuẩn dữ liệu và quy trình vận hành.

Khi kiểm tra một lô hàng, người mua nên đối chiếu tên sản phẩm, đơn vị cung ứng, mã lô và các mốc thời gian. Doanh nghiệp nên kiểm thử quy trình khi thay đổi cơ sở hoặc bên nhận hàng để tránh đứt đoạn hồ sơ. Một trường dữ liệu trống không tự chứng minh sản phẩm kém chất lượng, nhưng cần được nhìn nhận đúng là thông tin chưa được công khai hoặc chưa có trong bản ghi được tra cứu.

Nguồn: ${"Bộ Nông nghiệp và Môi trường, 20/06/2026 — "}${"https://en.mae.gov.vn/SMPT_Publishing_UC/KhaiThac/TinTuc/pInTinTuc.aspx?ItemID=9436"}
Ảnh: Colin Roe / Unsplash — https://unsplash.com/photos/H1RWuPMIgBY`,
  },
  {
    key: "durian-export-2026",
    legacyTitle: "Phân biệt ngày thu hoạch và hạn sử dụng",
    title: "Sầu riêng xuất khẩu tăng, truy xuất phải đi cùng kiểm soát chất lượng",
    summary: "Bộ NN&MT ước tính xuất khẩu sầu riêng đạt 1,97 tỷ USD trong 8 tháng đầu năm 2026; cơ quan này nhấn mạnh chất lượng, an toàn thực phẩm và truy xuất là nền tảng của tăng trưởng bền vững.",
    photo: "role-retail.jpg",
    photoCredit: ["Thomas Le", "https://unsplash.com/photos/pRJhn4MbsMM"],
    source: "https://en.mae.gov.vn/SMPT_Publishing_UC/KhaiThac/TinTuc/pInTinTuc.aspx?ItemID=9617",
    sourceLabel: "Bộ Nông nghiệp và Môi trường, 04/09/2026",
    body: `Tại họp báo Chính phủ đầu tháng 9/2026, Bộ Nông nghiệp và Môi trường ước tính xuất khẩu sầu riêng trong tám tháng đầu năm đạt 1,97 tỷ USD, tăng 28,3% so với cùng kỳ. Riêng thị trường Trung Quốc đạt khoảng 1,85 tỷ USD. Bộ cho biết Việt Nam đã mở rộng xuất khẩu tới hơn 20 quốc gia và vùng lãnh thổ; Ấn Độ cho phép nhập khẩu sầu riêng tươi của Việt Nam từ tháng 7/2026.

Tăng trưởng thương mại cũng làm tăng yêu cầu đối với khâu sản xuất và sơ chế. Theo bài thông tin của Bộ, cả nước có 1.599 mã số vùng trồng sầu riêng và 281 mã số cơ sở đóng gói đang hoạt động. Hệ thống truy xuất điện tử được áp dụng từ ngày 01/07/2026 cho nông sản nói chung và sầu riêng xuất khẩu nói riêng. Những mã số này giúp xác định phạm vi được phê duyệt; chúng không thay thế việc kiểm tra chất lượng, an toàn thực phẩm hay tuân thủ quy trình của từng lô.

Bài học cho chuỗi cung ứng là cần chuẩn bị hồ sơ từ đầu vụ thay vì xử lý khi lô hàng gặp vướng mắc. Vùng trồng, cơ sở đóng gói, kết quả kiểm nghiệm, thời điểm thu hoạch và giao nhận cần được lưu đúng phạm vi. Doanh nghiệp cũng cần giảm phụ thuộc vào một thị trường, tăng liên kết giữa người trồng, đơn vị đóng gói và nhà xuất khẩu, đồng thời chỉ công bố những dữ liệu có căn cứ.

Nguồn: ${"Bộ Nông nghiệp và Môi trường, 04/09/2026 — "}${"https://en.mae.gov.vn/SMPT_Publishing_UC/KhaiThac/TinTuc/pInTinTuc.aspx?ItemID=9617"}
Ảnh: Thomas Le / Unsplash — https://unsplash.com/photos/pRJhn4MbsMM`,
  },
  {
    key: "durian-codes-2026",
    legacyTitle: "Nhật ký vùng trồng và thông tin người tiêu dùng",
    title: "Thêm mã vùng trồng và cơ sở đóng gói sầu riêng được phê duyệt",
    summary: "Trong đợt cập nhật tháng 8/2026, phía Trung Quốc chấp thuận thêm 401 mã vùng trồng và 166 mã cơ sở đóng gói của Việt Nam sau khi đánh giá 736 hồ sơ.",
    photo: "role-farm.jpg",
    photoCredit: ["feifei liang", "https://unsplash.com/photos/K7DllgDsGNo"],
    source: "https://en.mae.gov.vn/SMPT_Publishing_UC/KhaiThac/TinTuc/pInTinTuc.aspx?ItemID=9569",
    sourceLabel: "Bộ Nông nghiệp và Môi trường, 20/08/2026",
    body: `Bộ Nông nghiệp và Môi trường cho biết ngày 20/08/2026, Tổng cục Hải quan Trung Quốc đã đánh giá 736 hồ sơ sầu riêng của Việt Nam. Trong số đó, 401 mã vùng trồng và 166 mã cơ sở đóng gói được chấp thuận; 283 hồ sơ vùng trồng và 160 hồ sơ cơ sở đóng gói còn chờ đánh giá. Phía Trung Quốc cũng phê duyệt thêm một số mã cho dừa, ớt và cơ sở đóng gói các mặt hàng nông sản khác.

Mã vùng trồng và mã cơ sở đóng gói xác định địa điểm, chủ thể và phạm vi được chấp thuận theo yêu cầu của thị trường nhập khẩu. Chúng không phải chứng nhận chất lượng cho mọi lô hàng xuất phát từ địa điểm đó. Mỗi lô vẫn cần hồ sơ phù hợp, được đóng gói tại cơ sở đủ điều kiện và đáp ứng các quy định kỹ thuật của thị trường đích.

Bộ cho biết hệ thống truy xuất nông sản đang được phát triển để kết nối thông tin từ vùng sản xuất và cơ sở đóng gói tới lô hàng và thị trường. Với doanh nghiệp, cách làm thiết thực là kiểm tra mã còn hiệu lực trước mùa thu hoạch, gắn mã đúng với lô thực tế và giữ lại kết quả kiểm tra, thời điểm đóng gói cùng thông tin giao nhận. Người mua có thể đối chiếu mã và tên cơ sở trên hồ sơ được công khai thay vì suy luận từ nhãn hiệu hoặc nơi bán.

Nguồn: ${"Bộ Nông nghiệp và Môi trường, 20/08/2026 — "}${"https://en.mae.gov.vn/SMPT_Publishing_UC/KhaiThac/TinTuc/pInTinTuc.aspx?ItemID=9569"}
Ảnh: feifei liang / Unsplash — https://unsplash.com/photos/K7DllgDsGNo`,
  },
  {
    key: "durian-safety-2026",
    legacyTitle: "Theo dõi nguyên liệu trong lô chế biến",
    title: "Kiểm soát cadimi và Auramine O cần dữ liệu xuyên suốt chuỗi sầu riêng",
    summary: "Một hội thảo chuyên ngành tại Tây Nguyên tập trung nhận diện rủi ro dư lượng và cách kiểm soát từ sản xuất, sơ chế tới bảo quản, gắn với nhật ký và mã vùng trồng.",
    photo: "role-inspection.jpg",
    photoCredit: ["Noah Buscher", "https://unsplash.com/photos/x8ZStukS2PM"],
    source: "https://en.mae.gov.vn/controlling-cadmium-and-auramine-o-to-develop-sustainable-durian-industry-9692.htm",
    sourceLabel: "Bộ Nông nghiệp và Môi trường, 28/09/2026",
    body: `Cuối tháng 9/2026, Viện Khoa học Kỹ thuật Nông Lâm nghiệp Tây Nguyên tổ chức hội thảo về kiểm soát cadimi và Auramine O trong ngành sầu riêng. Theo Bộ Nông nghiệp và Môi trường, hội thảo tập trung nhận diện nguy cơ dư lượng, tìm nguồn phát sinh và thảo luận biện pháp kiểm soát từ khâu sản xuất, sơ chế đến bảo quản. Mạng lưới Horticultural Innovation Network, WASI và CSIRO phối hợp triển khai chương trình này với hỗ trợ từ Aus4Innovation.

Thông điệp thực tế là kiểm soát an toàn không thể chỉ bắt đầu ở cửa khẩu. Nhật ký canh tác, quản lý vật tư, điều kiện vùng trồng, thu hoạch, sơ chế và bảo quản cần được xem như các phần nối tiếp. Khi phát hiện kết quả bất thường, hồ sơ theo lô giúp khoanh vùng phạm vi cần kiểm tra và tìm lại công đoạn liên quan; bản ghi thiếu không nên được lấp bằng phỏng đoán.

Doanh nghiệp và hợp tác xã có thể bắt đầu bằng việc xác định ai cập nhật từng loại dữ liệu, thời điểm cập nhật và tài liệu nào làm căn cứ. Cơ sở sơ chế cần tách lô rõ ràng, ghi nhận đầu vào và kết quả kiểm tra. Người tiêu dùng khi tra cứu nên hiểu rằng mã QR cung cấp đường dẫn tới hồ sơ được công khai, còn kết luận về dư lượng phải dựa trên kết quả kiểm nghiệm phù hợp.

Nguồn: ${"Bộ Nông nghiệp và Môi trường, 28/09/2026 — "}${"https://en.mae.gov.vn/controlling-cadmium-and-auramine-o-to-develop-sustainable-durian-industry-9692.htm"}
Ảnh: Noah Buscher / Unsplash — https://unsplash.com/photos/x8ZStukS2PM`,
  },
  {
    key: "postharvest-storage-guide",
    legacyTitle: "Bảo quản nông sản theo từng nhóm sản phẩm",
    title: "Bảo quản trái cây: không có một mức nhiệt dùng chung cho mọi loại",
    summary: "Hướng dẫn kỹ thuật của FAO cho thấy nhiệt độ và độ ẩm phù hợp thay đổi theo từng loại nông sản; phân loại, thao tác nhẹ tay và tránh làm lạnh quá mức đều quan trọng.",
    photo: "role-processing.jpg",
    photoCredit: ["Amy Vann", "https://unsplash.com/photos/omICPqHDfgY"],
    source: "https://www.fao.org/4/a1549e/a1549e01.pdf",
    sourceLabel: "FAO, tài liệu kỹ thuật về xử lý và bảo quản sau thu hoạch",
    body: `Nông sản tiếp tục biến đổi sau khi thu hoạch nên nhiệt độ, độ ẩm, thời gian và cách xếp dỡ đều ảnh hưởng tới chất lượng. Tài liệu kỹ thuật của FAO phân biệt nhóm cây nguồn gốc nhiệt đới nhạy với lạnh và nhóm cây ôn đới chịu được nhiệt độ thấp hơn. Một số nhóm rau quả được bảo quản quanh 0–4°C, nhóm khác khoảng 4–8°C, còn loại cần nhiệt độ trên 8°C; đây là khung tham khảo để hiểu sự khác biệt, không phải công thức áp dụng cho mọi giống hay mọi lô.

FAO cũng lưu ý phần lớn rau quả tươi chứa nhiều nước. Không khí quá khô làm nông sản mất ẩm nhanh hơn, trong khi độ ẩm cao không phù hợp có thể tạo điều kiện cho hư hỏng. Tài liệu nêu khoảng 85–95% độ ẩm tương đối cho nhiều loại nông sản, nhưng điều kiện tối ưu còn phụ thuộc mặt hàng, nhiệt độ và thời gian lưu kho. Trái cây nhiệt đới có thể bị tổn thương lạnh nếu hạ nhiệt quá thấp.

Trước khi nhập kho, nên loại riêng sản phẩm dập hoặc có dấu hiệu bệnh, phân loại theo độ chín và kích cỡ, thao tác nhẹ để tránh bầm dập, dùng nước sạch khi rửa và để ráo trước khi đóng gói. Khi vận chuyển, giảm số lần bốc dỡ và tránh để lô hàng nóng lên trong xe kín. Hãy dùng hướng dẫn theo từng mặt hàng và yêu cầu của người mua thay vì đặt một mức nhiệt cho cả kho.

Nguồn: FAO, “Food Processing: Post-Harvest Handling and Storage” — https://www.fao.org/4/a1549e/a1549e01.pdf
Ảnh: Amy Vann / Unsplash — https://unsplash.com/photos/omICPqHDfgY`,
  },
];

const legacySummary = "Thông tin hướng dẫn đối chiếu hồ sơ sản phẩm và lựa chọn điều kiện bảo quản phù hợp.";
const legacyBody = "Quét mã trên nhãn để kiểm tra tên sản phẩm, đơn vị cung ứng, thời điểm thu hoạch và các cảnh báo. Đối chiếu số lượng khi nhận hàng; giữ bao bì và mã lô để thuận tiện tra cứu khi cần.";

function editorialBody(article) {
  const content = article.body.split("\n\nNguồn:")[0].trim();
  return `${content}\n\nNguồn: ${article.sourceLabel} — ${article.source}\nẢnh: ${article.photoCredit[0]} / Unsplash — ${article.photoCredit[1]}`;
}

const sharp = (await import("sharp")).default;
const imageCache = new Map();
async function cover(photo) {
  if (!imageCache.has(photo)) {
    const source = resolve(root, "apps/web/public/images/site", photo);
    imageCache.set(photo, sharp(await readFile(source))
      .resize({ width: 1000, height: 700, fit: "cover", withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer());
  }
  const bytes = await imageCache.get(photo);
  assert.ok(bytes.length <= 393216, `Ảnh bìa vượt 384 KB: ${photo}`);
  return bytes;
}

let created = 0;
let updated = 0;
let preserved = 0;
let unchanged = 0;
try {
  const covers = new Map();
  for (const article of articles) covers.set(article.key, await cover(article.photo));

  await db.$transaction(async (tx) => {
    let rows = await tx.consumerNews.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        title: true,
        summary: true,
        body: true,
        coverContent: true,
        coverMimeType: true,
        coverUrl: true,
        version: true,
        isPublished: true,
        publishedAt: true,
      },
    });

    for (const article of articles) {
      const body = editorialBody(article);
      const bytes = covers.get(article.key);
      const matches = rows.filter((row) =>
        row.title === article.legacyTitle || row.title === article.title,
      );
      assert.ok(matches.length <= 1, `Có nhiều bài trùng tiêu đề seed: ${article.legacyTitle}`);
      let row = matches[0];

      if (row?.title === article.legacyTitle &&
          (row.summary !== legacySummary || row.body !== legacyBody)) {
        preserved++;
        continue;
      }

      if (row?.title === article.title &&
          (row.summary !== article.summary || row.body !== body)) {
        preserved++;
        continue;
      }

      if (!row) {
        row = await tx.consumerNews.create({
          data: {
            title: article.title,
            summary: article.summary,
            body,
            coverContent: new Uint8Array(bytes),
            coverMimeType: "image/jpeg",
            isPublished: true,
            publishedAt: new Date(),
          },
          select: {
            id: true,
            title: true,
            summary: true,
            body: true,
            coverContent: true,
            coverMimeType: true,
            coverUrl: true,
            version: true,
            isPublished: true,
            publishedAt: true,
          },
        });
        rows = [...rows, row];
        created++;
        continue;
      }

      const sameCover = row.coverMimeType === "image/jpeg" &&
        row.coverContent !== null && Buffer.from(row.coverContent).equals(bytes);
      const needsUpdate = row.title !== article.title ||
        row.summary !== article.summary ||
        row.body !== body ||
        !sameCover ||
        row.coverUrl !== null ||
        !row.isPublished ||
        !row.publishedAt;
      if (!needsUpdate) {
        unchanged++;
        continue;
      }

      const changed = await tx.consumerNews.updateMany({
        where: { id: row.id, version: row.version, archivedAt: null },
        data: {
          title: article.title,
          summary: article.summary,
          body,
          coverContent: new Uint8Array(bytes),
          coverMimeType: "image/jpeg",
          coverUrl: null,
          isPublished: true,
          publishedAt: row.publishedAt ?? new Date(),
          version: { increment: 1 },
        },
      });
      assert.equal(changed.count, 1, `Bài viết đã đổi trong lúc seed: ${article.legacyTitle}`);
      rows = rows.map((candidate) => candidate.id === row.id
        ? { ...row, title: article.title, summary: article.summary, body,
          coverContent: new Uint8Array(bytes), coverMimeType: "image/jpeg",
          coverUrl: null, isPublished: true, publishedAt: row.publishedAt ?? new Date(),
          version: row.version + 1 }
        : candidate);
      updated++;
    }
  }, { timeout: 30_000 });

  console.log(`Bản tin demo: tạo ${created}, cập nhật ${updated}, giữ nguyên bài đã biên tập ${preserved}, không đổi ${unchanged}.`);
} finally {
  await db.$disconnect();
}

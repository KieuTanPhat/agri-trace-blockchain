# AGT-002 — dependency remediation, 2026-10-06

Task và tiêu chí nghiệm thu: [issue #14](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/14).
Owner task: Tuấn (`@TuanLo123`); review: Phát, Phi. Tài liệu này ghi bằng chứng
kỹ thuật; reviewer và Phát xác nhận nghiệm thu trong issue.

## Baseline và kế hoạch

- Main baseline của Tuấn: `67c4716b04f2f2c448fab56caa41a60cff5abad2`.
- Nhánh nhận: `tuan-AGT002-dependency-advisories`, commit
  `1156c0421800fec2d750d0f9339e122e26e02ab2`.
- Nhánh remediation: `codex/agt-002-remediation`; giữ Next.js 15.5.25 và NestJS
  core 12.0.1, giữ các bản vá runtime/chaincode mà Tuấn đã làm.
- Máy kiểm tra bổ sung: Windows x64, Node.js 22.22.3, npm 12.1.0; PostgreSQL 18
  trong database dùng riêng cho task, không dùng database ứng dụng.

Thứ tự thực hiện:

1. Cài từ root lockfile và audit mới; ghi graph và cấu hình lint hiệu lực tại
   SHA nhận nhánh. Audit riêng lockfile chaincode.
2. So sánh phương án vá, thay dependency, exception; chọn cách loại bỏ advisory
   và kiểm tra các rule đang dùng.
3. Sửa manifest, tái tạo root lockfile bằng npm 12.1.0. Giữ overrides runtime;
   kiểm tra graph không có peer invalid.
4. Cài lại hai lockfile trong môi trường riêng, kiểm tra từng rule lint và build gate; chạy toàn bộ
   checks với PostgreSQL E2E. CI kiểm tra container và mạng Fabric.
5. Push PR, đối chiếu CI trên SHA của PR; ghi audit, artifact, môi trường và SHA
   vào issue #14 để Phát/Phi review.

## Vấn đề xác nhận tại SHA nhận nhánh

Audit mới sau `npm ci`: root có 5 high, không có critical/moderate; production
và lockfile chaincode độc lập có 0 advisory. Năm mục high cùng một đường dẫn:

```text
eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces@3.0.3
```

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) báo
stack exhaustion khi xử lý pattern lồng quá sâu; phạm vi bị ảnh hưởng gồm
`braces <=3.0.3`, chưa có bản vá phát hành tại ngày kiểm tra. Đây là dependency
của lint lúc phát triển/build, không nằm trong audit production. Kết luận về
production là phạm vi dependency; công cụ chạy trong CI vẫn cần xử lý.

`npm ls --all --json` còn phát hiện `@swc/helpers@0.5.15` không thỏa peer của
`@swc/core@1.16.2`. Sửa peer này để graph cài từ lockfile hợp lệ.

Các bản vá Tuấn đã thực hiện được giữ: `@grpc/grpc-js` 1.14.5, `proxy-addr`
2.0.8, `source-map-js` 1.2.2, `fast-uri` 3.1.8 và các bản `brace-expansion`
đã vá; chaincode lockfile riêng giữ `source-map-js` 1.2.2.

## Quyết định và lý do

| Phương án                                | Kết quả đánh giá                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Cập nhật bản vá `braces`/preset Next 15  | Preset 15.5.27 vẫn kéo `braces@3.0.3`; không có bản vá advisory này.                                                                       |
| `npm audit fix --force`                  | npm đề xuất `eslint-config-next@14.2.35`, thay đổi breaking và không cùng major với Next 15; chưa chứng minh giữ policy hiện tại.          |
| Fork/vá tại chỗ `braces`                 | Phải tự duy trì bản vá thư viện và chứng minh tính đầy đủ; không cần khi có thể thay công cụ lint bằng các plugin hiện hữu.                |
| Chấp nhận exception có owner/hạn         | Vẫn giữ advisory; cần Phát duyệt. Không cần exception khi phương án thay dependency đạt checks.                                            |
| ESLint plugin trực tiếp + Oxlint Next.js | Được chọn: bỏ chuỗi bị ảnh hưởng, giữ các plugin React/TypeScript/accessibility và kiểm tra 21 rule Next.js bằng Oxlint đã dùng trong API. |

[Oxlint có plugin Next.js tích hợp](https://oxc.rs/docs/guide/usage/linter/plugins.html).
Policy được chụp từ `next/core-web-vitals` + `next/typescript` của
`eslint-config-next@15.5.27`: TypeScript có 71 rule bật (50 ESLint + 21 Next);
JavaScript có 67 (46 + 21). Bốn rule core chỉ bật với TypeScript được giữ đúng
phạm vi. Options mặc định được ghi tường minh cho `prefer-const` và
`@typescript-eslint/no-unused-expressions`.

`scripts/lint-policy.json` ghi nguồn SHA và severity/options; contract đối chiếu
TS/TSX/MTS/CTS và JS/JSX/MJS/CJS. Settings import resolver cũ không được kéo theo:
rule import đang bật chỉ là `no-anonymous-default-export`, không cần resolver.
Các engine có thể khác nhau ở trường hợp không được fixtures bao phủ; contract
kiểm tra các hành vi đại diện, không chứng minh tương đương với mọi chương trình.

### Thay đổi cụ thể

- Bỏ `eslint-config-next` và preset `.eslintrc.json`; dùng flat config ESLint và
  `.oxlintrc.json` với các rule Next cùng severity.
- `lint` chạy cả hai engine. `build` chạy `lint` trước compiler; `check` còn chạy
  contract. Tắt lượt lint nhúng của Next vì không chạy được phần Oxlint.
- Contract có fixture cho từng rule phát diagnostic, trường hợp hợp lệ,
  Pages/App Router, kiểm tra graph và hai thử nghiệm gọi build thật với lỗi
  cố ý (ESLint và Oxlint) để xác nhận compiler chưa được gọi.
- Đổi liên kết nội bộ `/scan` ở trang login sang `next/link`, đáp ứng rule link
  App Router; giữ nguyên nội dung và đích liên kết.
- API khai báo `@swc/helpers@0.5.17` để thỏa peer SWC. Bỏ allowScripts của
  `unrs-resolver` sau khi bỏ resolver dependency; giữ các overrides runtime.
- CI pin Node 22.22.3/npm 12.1.0, audit cả dev và production, chặn high/moderate,
  kiểm tra peer graph và lưu JSON/metadata. Thêm job cài/check chaincode từ
  lockfile riêng; Fabric smoke chỉ chạy sau khi job này đạt.
- Kiểm tra xoay vòng phát hiện cài root rồi chaincode trực tiếp trong cùng cây
  làm graph root có gói hoisted thừa và lệch `esbuild`. Script standalone dùng
  thư mục tạm độc lập, kiểm tra byte manifest/lockfile khớp nguồn, audit và chạy
  checks; kiểm tra lại graph root sau đó. CI giữ hai môi trường cài độc lập.

## Bằng chứng và lệnh tái lập

```bash
npm ci
# DATABASE_URL và TEST_DATABASE_URL phải trỏ tới database test riêng.
npm run db:migrate --workspace apps/api
npm run check
npm run audit:dependencies
npm run check:chaincode:standalone
```

Collector lưu riêng root/chaincode: audit full, audit production, installed tree
và metadata gồm thời điểm, SHA checkout, PR head SHA (CI), Node/npm, hệ điều hành,
SHA-256 manifest/lockfile, thư mục cài, lệnh và exit code. CI upload artifact kể cả khi audit
thất bại. SHA checkout trong PR workflow có thể là merge SHA; metadata phân biệt
nó với head SHA của PR. Audit phản ánh registry tại thời điểm chạy.

### Kết quả bổ sung

Sau cài lại trên Windows x64 / Node 22.22.3 / npm 12.1.0:

| Phạm vi audit                           | Baseline nhận nhánh      | Sau remediation               |
| --------------------------------------- | ------------------------ | ----------------------------- |
| Workspace đầy đủ (gồm dev)              | 5 high                   | 0 advisory                    |
| Workspace production                    | 0 advisory               | 0 advisory                    |
| Chaincode độc lập, đầy đủ và production | 0 advisory               | 0 advisory                    |
| Installed peer graph                    | Root có SWC peer invalid | Root và chaincode độc lập đạt |

| Kiểm tra                         | Kết quả local                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| Root `npm ci` và `npm run check` | Đạt, exit 0                                                                          |
| API                              | Lint/typecheck/build đạt; unit 63/63, E2E 54/54, 0 skip; PostgreSQL 18, 8 migrations |
| Web                              | Typecheck/build đạt; unit 25/25, lint contract 82/82, 0 skip                         |
| Chaincode workspace              | Typecheck/build/runtime load đạt; 34/34 test, coverage thresholds đạt                |
| Gateway                          | Typecheck/build/runtime load đạt; 3/3 test                                           |
| Chaincode lockfile riêng         | `npm ci`, typecheck/build/runtime load đạt; 34/34 test, coverage thresholds đạt      |

Docker daemon không chạy trên máy Windows này; production container/HTTP smoke
và Fabric deploy/smoke được kiểm chứng bằng hai workflow trên GitHub. SHA cuối,
trạng thái CI và các URL artifact được đối chiếu trong PR và issue #14. Metadata
phân biệt working tree local còn sửa với checkout CI đã commit. Kết quả cũ của
`docs/refactoring-verification.md` thuộc SHA khác.

Sau remediation không còn advisory cần exception trong các phạm vi đã audit.
Reviewer/Phát xác nhận nghiệm thu khi đối chiếu bằng chứng CI đúng SHA; kết quả
kỹ thuật không tự thay thế việc review đó.

### Lịch sử trước remediation

Báo cáo của Tuấn tại nhánh nhận: macOS arm64, Node 24.20.0/npm 12.1.0; root từ
1 critical/8 high/1 moderate về 5 high, production và chaincode về 0 advisory.
API unit 63 đạt; E2E 20 đạt/34 skip do thiếu database test; Web 25, chaincode 34,
gateway 3 đạt. Đây là kiểm tra local trước remediation; chưa phải CI/nghiệm thu
cho PR cuối. Lượt bổ sung dùng database để chạy cả các test trước đó bị skip.

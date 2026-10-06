# AGT-002 — rà soát dependency ngày 2026-10-06

Baseline: `67c4716b04f2f2c448fab56caa41a60cff5abad2` (`origin/main` tại lúc tạo nhánh). Nhánh làm việc: `tuan-AGT-002-dependency-audit`. Môi trường kiểm tra: macOS arm64, Node.js 24.20.0, npm 12.1.0. SHA của bản sửa cần bổ sung sau khi commit; tài liệu này không phải xác nhận nghiệm thu.

## Thay đổi

- Nâng dependency trực tiếp `@grpc/grpc-js` của Fabric Gateway từ 1.14.4 lên 1.14.5, đồng bộ root lockfile.
- Cập nhật root lockfile cho `proxy-addr` 2.0.8, `source-map-js` 1.2.2, `fast-uri` 3.1.8 và các bản `brace-expansion` đã vá. `eslint-config-next` và plugin đi kèm lên bản vá 15.5.27, không đổi major Next.js/NestJS.
- Cập nhật lockfile độc lập của chaincode: `source-map-js` 1.2.1 → 1.2.2.
- Giữ nguyên các `overrides` đang có trong `package.json`: `postcss`, `deepmerge-ts`, `mysql2`, `undici`, `tmp`. Không dùng `npm audit fix --force` vì đề xuất của npm là hạ `eslint-config-next` sang major 14.

## Audit

| Phạm vi | Trước | Sau |
| --- | --- | --- |
| Root workspace, toàn bộ dependency | 1 critical, 8 high, 1 moderate | 0 critical, 5 high, 0 moderate |
| Root workspace, `--omit=dev` | Chưa ghi nhận trước sửa | 0 advisory |
| Chaincode lockfile độc lập | 1 high | 0 advisory |

Năm mục high còn lại là **một chuỗi dependency dev-only**: `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces@3.0.3`. Advisory gốc: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), stack exhaustion khi xử lý pattern lồng sâu. Hiện `braces` chưa có bản vá phát hành; `npm audit` đề xuất hạ `eslint-config-next` về 14.2.35 (đổi major framework/config), trái phạm vi task. Lockfile đánh dấu các gói trong chuỗi này `dev: true`; audit production (`--omit=dev`) sạch. Rủi ro còn ở công cụ lint/CI nếu xử lý glob không tin cậy, không thấy trong dependency runtime production.

## Kiểm chứng tại máy

- Root `npm ci` từ lockfile: đạt. Root `npm audit --json`: 5 high như trên; `npm audit --omit=dev --json`: 0. Các workspace Web, chaincode, gateway của `npm run check`: đạt ở lượt kiểm tra trước; API thất bại ban đầu vì sandbox không cho ghi cache Prisma/SWC.
- Sau khi cấp quyền ghi cache Prisma và đặt `SWC_NATIVE_BINDING_CACHE=/private/tmp/agt002-swc-cache`, chạy lại `npm ci` từ đúng lockfile rồi `npm run check --workspace apps/api`: đạt. API unit 63/63; E2E 20 đạt, 34 bỏ qua do không có database kiểm thử; lint, typecheck, build đạt.
- Chaincode độc lập `npm ci --workspaces=false`, `npm audit --workspaces=false`: đạt, 0 advisory. Chaincode typecheck, 34 test, build và runtime load đạt; Gateway typecheck, 3 test, build/runtime load đạt; Web lint, typecheck, 25 test và build đạt.
- Chưa chạy CI trên GitHub cho SHA cuối; `application-ci.yml` vẫn có audit high gate, `blockchain-ci.yml` có audit riêng cho chaincode. Chưa kiểm thử database E2E hoặc mạng Fabric thật trong lượt này.

Lệnh đối chiếu sau khi commit: `npm ci`, `npm audit --json`, `npm audit --omit=dev --json`, `npm run check`; trong `blockchain/chaincode`: `npm ci --workspaces=false`, `npm audit --workspaces=false --json`. Ghi SHA của commit và URL hai CI run tại đây sau khi đẩy nhánh.

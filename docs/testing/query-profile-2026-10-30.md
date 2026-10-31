# Đo truy vấn local — 30/10/2026

## Môi trường và phương pháp

- DB đã xác minh: `agri_trace_ui_test`, PostgreSQL 17.10 (Debian 17.10-1.pgdg13+1), khoảng 30 MB; 93 migrations, không có migration dở dang.
- Source/build ở working tree dựa trên HEAD `7cf81b5`; đây không phải bản release sạch.
- Đo service thực + Prisma trong transaction READ ONLY, statement timeout 8 giây. Không seed, reset, đổi index, ANALYZE hay VACUUM. Không truy vấn endpoint quét trace có tăng lượt quét.
- Mỗi nhóm có 2 warmup + 10 lần đo nối tiếp. EXPLAIN (ANALYZE, BUFFERS) chỉ chạy SELECT, ngoài khoảng bấm giờ; mỗi SQL shape dùng tham số đại diện, số lần lặp ghi riêng.
- Actor demo C1/C3 lấy từ DB; C3 có scope theo nhóm quyền và chỉ vụ được giao. Đây là service benchmark, không chạy JwtAuthGuard, middleware, mạng hoặc timing serialize JSON.
- HTTP GET công khai đo riêng qua `127.0.0.1:8080`, 2 warmup + 5 mẫu; chờ đủ response body. Không đăng nhập mới hoặc thay phiên người dùng.
- Có cảnh báo pg về Promise.all dùng cùng connection transaction; kết quả service phản ánh một connection, không thay cho tải pool/concurrency thật.

## Kết quả service

| Nhóm đọc | Dữ liệu trả | SQL/lần | Median ms | P95 ms |
|---|---:|---:|---:|---:|
| public-products | 20 | 13 | 12.89 | 16.84 |
| public-enterprises | 19 | 3 | 10.60 | 12.60 |
| public-product-detail | 1 | 19 | 16.06 | 17.94 |
| public-enterprise-detail | detail | 17 | 36.08 | 38.14 |
| cycles-owner | 6 | 25 | 23.13 | 29.44 |
| cycles-staff | 6 | 25 | 16.29 | 18.39 |
| cycle-detail-owner | detail | 22 | 28.13 | 31.88 |
| distribution-owner | 0 | 14 | 4.75 | 7.40 |
| processing-owner | 5 | 23 | 6.57 | 11.45 |

## HTTP công khai

| API | Median ms | Max ms (5 mẫu) |
|---|---:|---:|
| `/public/products?limit=20` | 37.99 | 45.72 |
| `/public/enterprises?limit=20` | 38.75 | 40.13 |
| `/public/products/d9de201b-e47c-44bf-bcf0-1dee88dd3959?limit=20` | 50.35 | 58.27 |
| `/public/enterprises/f14d5c03-c8ed-4a72-ab2f-f60ac8add370?limit=20` | 78.75 | 83.24 |

## Phát hiện và thứ tự xử lý

1. Danh sách vụ C1/C3: 6 vụ nhưng 25 SQL. `ProductionCyclesService.list` gọi `canWriteCycle` cho từng vụ; log có 2 SQL shape scope/grant lặp 6 lần. Danh sách còn chưa có giới hạn trang. Ưu tiên gom kiểm quyền theo tập/vùng/chuỗi, giữ đúng assignment, tier3, revoke, membership, capability và binding; không bỏ kiểm quyền để nhanh hơn. Khi triển khai cần test tương đương quyền trước/sau và dữ liệu nhiều vụ.
2. Chi tiết DN công khai: service median 36.08 ms, HTTP median 78.75 ms, cao nhất trong nhóm HTTP đã đo. Một phản hồi gom sản phẩm/lô và công khai nhiều quan hệ; cần rà query trùng và đường xử lý trước khi cache. Không cache bỏ qua rút công khai/thu hồi bằng chứng.
3. Processing list: 5 mẻ dùng 23 SQL, trong đó SELECT product cùng shape lặp 2 lần do các quan hệ. Chưa chậm trong mẫu này; xếp sau danh sách vụ.
4. Chưa phát hiện một SELECT đại diện nào vượt 2 ms trong EXPLAIN ở mẫu nhỏ/warm-cache này. Chi phí service cao hơn tổng execution SQL; không cộng/trừ các phép đo khác lượt để kết luận thời gian mạng chính xác. Chưa có bằng chứng cần thêm index hàng loạt.
5. Giao nhận hiện trả 0 bản ghi; 4.75 ms không chứng minh hiệu năng trên luồng giao nhận đầy đủ. Cần bộ nhiều chặng/chi tiết/ký hai bên trước khi kết luận.

## Giới hạn

- Chỉ 101 sản phẩm/101 lô, mỗi tenant sản xuất 6 vụ và tenant chế biến 5 mẻ; chưa stress test hay SLA production.
- Không đo camera, tải ảnh native, Web rendering, OTP, command ghi, lock contention, Worker/Fabric.
- Không có extension pg_stat_statements trong DB nên chưa có bảng xếp hạng toàn bộ query lịch sử theo tổng thời gian. Không bật extension/restart máy chủ trong lượt đo.
- Raw evidence chỉ lưu local ngoài Git: `.codex/read-query-profile-20261030.json`, `.codex/read-http-profile-20261030.json`, `.codex/query-stats-20261030.json`; không chứa password/token hoặc SQL parameter values trong report.
- Chưa sửa source nghiệp vụ/index/schema; đây là kết quả baseline để chọn tối ưu tiếp theo.

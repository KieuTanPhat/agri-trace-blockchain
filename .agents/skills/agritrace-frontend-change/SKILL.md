---
name: agritrace-frontend-change
description: Sửa hoặc review giao diện Next.js, frontend auth/recovery, QR/camera, PWA hoặc Web signer của AgriTrace; không dùng cho thay đổi backend thuần.
---

# Frontend change của AgriTrace

Đọc [hướng dẫn chung](../../../AGENTS.md) và [frontend guide](../../../docs/frontend.md).
Trong plan/review, chỉ đọc source và nêu cách kiểm; không chạy browser ghi nghiệp vụ.

1. Xác định page/component, style ownership, API consumer và yêu cầu thực tế từ
   source hiện hành. Task landing/style chỉ cần frontend context; khi đổi auth,
   recovery, quyền, trace hoặc signer, đọc [business rules](../../../docs/core-business-rules.md)
   và kết hợp skill API/Hybrid nếu contract hoặc invariant bị ảnh hưởng.
2. Dùng design tokens/styles và component có sẵn, nội dung tiếng Việt, responsive,
   keyboard/focus và reduced motion theo guide. Không tạo design system mới chỉ
   để hoàn thành chỉnh sửa nhỏ.
3. Giữ server allowedCommands và auditor read-only; hidden UI không thay authorization.
   Giữ original body/key/signature khi kết quả chưa rõ. QR chỉ điều hướng trace
   hợp lệ cùng origin; camera cần user action. PWA không cache dữ liệu account/API.
   Warning recall/expiry/integrity độc lập với proof và certification.
4. Khi triển khai, chạy `npm run check --workspace apps/web` trên Node/npm hỗ trợ.
   Kiểm browser theo viewport và tình huống ảnh hưởng trong guide; dùng fixture
   cách ly, che credentials trong artifact. Không dùng production account cho test.
5. Nếu đổi generated types, sửa nguồn NestJS và dùng workflow API contract;
   không chỉnh generated file tay. Không coi browser fixture là nghiệm thu camera
   phần cứng, PWA HTTPS hoặc nghiệp vụ production.

Trả thay đổi nhìn thấy/hành vi, kiểm tra thực đã chạy, viewport/tình huống đã xem
và giới hạn còn lại. Task typo hoặc style nhỏ không yêu cầu toàn bộ Fabric runbook.

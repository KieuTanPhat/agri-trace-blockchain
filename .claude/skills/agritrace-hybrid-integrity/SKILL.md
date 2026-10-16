---
name: agritrace-hybrid-integrity
description: Sửa hoặc review invariant nghiệp vụ AgriTrace về authorization, quantity/custody, sensor window, command recovery, trace/hash, Fabric binding/signature, outbox hoặc Worker.
---

# Hybrid integrity của AgriTrace

Đọc [hướng dẫn chung](../../../AGENTS.md), [business rules](../../../docs/core-business-rules.md)
và [context](../../../docs/PROJECT_CONTEXT.md); đây là nguồn invariant, không chép
lại toàn bộ vào task. Plan/review chỉ đọc; không gửi command hoặc thử retry thật.

1. Trace command/query qua authorization, transaction/journal, trace/outbox,
   Worker, chaincode và Web consumer có liên quan. Đối chiếu schema, SQL guards
   và Issue/plan acceptance; scope phải đúng cả write, replay, list/count/proof.
2. Với transaction/outbox/Worker, đọc [ADR-001](../../../docs/adr-001-modular-monolith-dedicated-worker.md).
   Với binding, permission epoch, signature hoặc signed payload, đọc
   [ADR-004](../../../docs/adr-004-hybrid-binding-and-signatures.md). Chỉ đọc phần
   [Hybrid runbook](../../../docs/hybrid-fabric-runbook.md) cần cho thay đổi.
3. Giữ domain/journal/trace/outbox và authorization/version/idempotency cùng
   transaction. Không đưa Fabric call hoặc signing key vào API transaction.
   Unknown outcome giữ original body/key/signature và đối soát; không thử key mới,
   xóa attempts, sửa hash/lịch sử hoặc downgrade signed handover để vượt lỗi.
4. Khi triển khai, dùng kiểm tra hiện có trong [CI guide](../../../docs/ci.md):
   unit/SQL tests theo caller, Gateway/chaincode checks và worker-contract nếu ảnh
   hưởng delivery. DB/Fabric/browser chạy trên tài nguyên cách ly; chỉ một local
   heavy job tại một thời điểm. Các bài thật cần đủ prerequisite trong runbook.
5. Kiểm đúng những failure modes bị ảnh hưởng, như sai scope, stale version/epoch,
   replay, mất response, worker restart/stale lease, Fabric outage, tamper hoặc
   sibling Lot privacy. Không coi mock, compile hoặc skipped test là Fabric evidence.

Trả execution path, invariant đã đối chiếu, findings/thay đổi, bằng chứng đúng
SHA/môi trường và khoảng trống acceptance. Source completion, pilot kỹ thuật và
quyền thực của doanh nghiệp bên ngoài là các kết luận riêng.

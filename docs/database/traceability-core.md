# Traceability Core Database

Tài liệu này mô tả schema đang được triển khai trong `apps/api/prisma/schema.prisma`. Đây là source of truth kỹ thuật cho database, thay thế mô hình legacy dùng `Batch` cho cả vụ trồng và lô thương phẩm.

## Mô hình cốt lõi

```text
Product -> Farm -> Plot? -> ProductionCycle
ProductionCycle -> CareRecord / SensorReading / SensorDigest
ProductionCycle -> HarvestEvent -> Lot -> Shipment -> Retailer
Lot -> QuantityMovement / Inspection / Certificate / TraceQR
TraceEvent -> BlockchainProof
```

- Một `ProductionCycle` có thể có nhiều `HarvestEvent`.
- Một `HarvestEvent` tạo đúng một `Lot`.
- Một `Lot` có tối đa một `Shipment` trong core.
- Raw sensor và business payload lưu off-chain; blockchain chỉ neo event metadata và hash.

## State machine

`ProductionCycle`: `CREATED -> PLANTED -> GROWING -> COMPLETED`; `CANCELLED` là terminal.

`Lot`: `HARVESTED -> IN_TRANSPORT -> ARRIVED -> RETAIL_RECEIVED -> FOR_SALE -> SOLD`.
Các trạng thái `RECALLED`, `EXPIRED`, `DAMAGED`, `REJECTED`, `SOLD` là terminal trong core.

`Shipment`: `CREATED -> IN_TRANSIT -> ARRIVED -> DELIVERED`; các nhánh kết thúc khác là `REJECTED` và `FAILED`.

State chỉ được đổi qua command nghiệp vụ. API không được nhận `currentState` hoặc `status` tùy ý từ client.

## Invariant được khóa ở database

- `cycleCode` unique theo `farmId`; `lotCode`, `deviceCode`, `email`, `role.code`, `traceToken` unique.
- `HarvestEvent.finalSensorDigestId`, `Lot.harvestId`, `Shipment.lotId`, `TraceQR.lotId`, `BlockchainProof.eventId` là quan hệ 0..1 hoặc 1..1 đúng thiết kế.
- Quantity bắt buộc hợp lệ; `availableQuantity` không âm và không lớn hơn `initialQuantity`.
- `QuantityMovement` bắt buộc `afterQty = beforeQty + delta`, `quantity = abs(delta)` và không được làm số lượng âm.
- `Certificate` thuộc đúng một trong hai chủ thể: `Lot` hoặc `ProductionCycle`.
- Hash dùng lowercase SHA-256 hex 64 ký tự.
- `TraceEvent` append-only bằng trigger PostgreSQL. Correction phải insert event mới và dùng `supersedesEventId`.
- `BlockchainProof.dataHash` phải khớp `TraceEvent.dataHash`; proof có trạng thái `PENDING`, `COMMITTED`, `FAILED`.
- State-changing command dùng `version` để optimistic locking và `IdempotencyRecord` với unique `(requesterId, operation, idempotencyKey)`.

## Nâng cấp từ schema Batch legacy

Migration `20260918120000_init_traceability_core` là baseline sạch cho mô hình mới. Lịch sử migration thử nghiệm cũ đã được thay thế vì không có cách suy ra an toàn `Product`, `Farm`, `ProductionCycle`, `HarvestEvent`, quantity và custody từ một hàng `Batch` cũ.

Nếu database local đã chạy migration legacy, hãy sao lưu dữ liệu cần giữ rồi chạy:

```bash
npm exec --workspace apps/api -- prisma migrate reset
```

Không chạy reset trên môi trường có dữ liệu cần bảo toàn. Với staging/production có dữ liệu legacy, cần viết ETL riêng và xác nhận mapping quantity, state, cycle và harvest trước khi deploy baseline này.

## Quy tắc triển khai command

Mỗi command thay đổi state phải thực hiện trong một transaction: authorize actor và organization, kiểm tra state hiện tại, kiểm tra quantity, khóa bằng version/row lock, cập nhật business entity, ghi `QuantityMovement` nếu cần, insert `TraceEvent`, tạo `BlockchainProof` ở `PENDING`, rồi submit qua relayer. Retry cùng idempotency key phải trả lại kết quả cũ và không tạo thêm entity/event.

# QR/Public Trace UX Spec

## URL Format

Canonical public URL:

```text
https://{public-host}/trace/{lotId}
```

Optional query fields for printed QR batches:

```text
https://{public-host}/trace/{lotId}?v=2
```

QR không chứa toàn bộ lịch sử, raw sensor, secret hoặc auth proof. QR chỉ chứa trace URL, `lotId` hoặc opaque `traceToken`.

## UX Flow

1. Người dùng quét QR hoặc nhập mã Lot ở `/scan`.
2. FE chuẩn hóa input:
   - Nếu là full URL `/trace/{lotId|traceToken}` thì mở trực tiếp.
   - Nếu là lot id/token thì điều hướng đến `/trace/{lotId|traceToken}`.
3. Public trace gọi mock/API đọc công khai.
4. Hiển thị hồ sơ lô, timeline, state hiện tại và trạng thái xác minh.
5. Nếu không tìm thấy hoặc lỗi xác minh, hiển thị error state rõ ràng, không lộ thông tin nội bộ.

## Public Trace Data

- `lotId`, `lotCode`, `productName`, `productionCycle`
- `currentState`
- `farmOrg`, `retailerOrg`
- `timeline[]`
- `proofStatus`: `VERIFIED | PENDING | INTEGRITY_WARNING | BLOCKCHAIN_UNAVAILABLE`
- `blockchainProof`: network, tx id, data hash, transaction status, recordedAt

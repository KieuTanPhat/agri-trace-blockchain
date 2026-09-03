# QR/Public Trace UX Spec

## URL Format

Canonical public URL:

```text
https://{public-host}/trace/{batchId}
```

Optional query fields for printed QR batches:

```text
https://{public-host}/trace/{batchId}?v=1
```

QR không chứa toàn bộ lịch sử, raw sensor, secret hoặc token. QR chỉ chứa trace URL/batch id.

## UX Flow

1. Người dùng quét QR hoặc nhập mã batch ở `/scan`.
2. FE chuẩn hóa input:
   - Nếu là full URL `/trace/{batchId}` thì mở trực tiếp.
   - Nếu là batch code/id thì điều hướng đến `/trace/{batchId}`.
3. Public trace gọi mock/API đọc công khai.
4. Hiển thị hồ sơ lô, timeline, state hiện tại và trạng thái xác minh.
5. Nếu không tìm thấy hoặc lỗi xác minh, hiển thị error state rõ ràng, không lộ thông tin nội bộ.

## Public Trace Data

- `batchId`, `batchCode`, `productName`
- `currentState`
- `farmOrg`, `retailerOrg`
- `timeline[]`
- `proofStatus`: `verified | pending | mismatch | unavailable`
- `blockchainProof`: network, tx hash/id, data hash, recordedAt

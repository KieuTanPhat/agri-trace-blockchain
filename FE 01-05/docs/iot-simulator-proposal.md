# IoT Simulator Proposal

## Mục tiêu

Tạo màn hình giả lập thiết bị gửi sensor reading cho batch đang được gán. Simulator chỉ gửi dữ liệu IoT, không chuyển state nghiệp vụ.

## UI

- Device selector: chọn thiết bị mô phỏng.
- Batch selector: chọn batch được mock/API trả về.
- Temperature: số thập phân, đơn vị °C.
- Humidity: số thập phân, đơn vị `%`.
- Timestamp UTC: mặc định `new Date().toISOString()`, cho phép sửa.
- Send/retry: gửi payload và thử lại payload gần nhất.
- Status: `idle`, `sending`, `accepted`, `rejected`, `retrying`.
- Response panel: hiển thị validation/status từ backend mock.

## Proposed Contract

```ts
type SensorReadingRequest = {
  deviceId: string;
  batchId: string;
  temperature: number;
  humidity: number;
  timestampUtc: string;
};

type SensorReadingResponse = {
  status: "accepted" | "rejected";
  readingId?: string;
  digestPreview?: {
    periodStart: string;
    periodEnd: string;
    readingCount: number;
  };
  error?: {
    status: 403 | 409 | 422 | 503;
    code: string;
    message: string;
  };
};
```

## Validation đề xuất

- `deviceId`, `batchId` bắt buộc.
- `temperature` và `humidity` là số hữu hạn.
- `timestampUtc` là ISO-8601 UTC.
- Backend kiểm tra thiết bị có được gán batch và batch có cho phép nhận sensor hay không.
- FE chỉ hiển thị accepted/rejected theo response, không tự kết luận state hợp lệ.

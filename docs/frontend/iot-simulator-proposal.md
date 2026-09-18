# IoT Simulator Proposal

## Mục tiêu

Tạo màn hình giả lập thiết bị gửi sensor reading cho `ProductionCycle` đang được gán. Simulator chỉ gửi dữ liệu IoT, không chuyển state nghiệp vụ.

## UI

- Device selector: chọn thiết bị mô phỏng.
- ProductionCycle selector: chọn vụ trồng được mock/API trả về.
- Sensor type, value và unit: một reading chuẩn hóa cho mỗi giá trị cảm biến.
- Timestamp UTC: mặc định `new Date().toISOString()`, cho phép sửa.
- Send/retry: gửi payload và thử lại payload gần nhất.
- Status: `idle`, `sending`, `accepted`, `rejected`, `retrying`.
- Response panel: hiển thị validation/status từ backend mock.

## Proposed Contract

```ts
type SensorReadingRequest = {
  deviceId: string;
  cycleId: string;
  sensorType: string;
  value: number;
  unit: string;
  timestamp: string;
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

- `deviceId`, `cycleId`, `sensorType`, `value`, `unit` bắt buộc.
- `value` là số hữu hạn; `timestamp` là ISO-8601 UTC.
- Backend kiểm tra thiết bị active, được bind đúng cycle và cycle đang `PLANTED/GROWING`.
- FE chỉ hiển thị accepted/rejected theo response, không tự kết luận state hợp lệ.

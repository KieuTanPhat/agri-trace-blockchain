# Wokwi ESP32 — chuẩn bị firmware độc lập

Phần IO04 độc lập theo gói giao việc IoT ngày 16/10/2026. Mạch và firmware
đọc DHT22, lấy mẫu mỗi 10 giây sau NTP, xử lý nút cửa/mạng/dừng và giữ FIFO
RAM tối đa 180 mẫu. Mỗi boot và mỗi mẫu có UUID riêng. Nguồn là
`WOKWI_SIMULATED`; không phải cảm biến vật lý đã nghiệm thu.

**Chưa tích hợp API.** Bản này không gửi telemetry/heartbeat, không giả receipt,
không xóa mẫu sau khi in Serial và không kết nối Fabric. Queue sẽ đầy sau khoảng
30 phút đo hợp lệ. `LOCAL_STATUS` chỉ là trạng thái tại thiết bị, không phải
heartbeat server đã nhận. LED xanh chỉ báo WiFi, không chứng minh gửi thành công.

## Build và chạy

Cài Python 3.11 và PlatformIO Core `6.1.18` trong virtualenv riêng, sau đó chạy
từ thư mục này:

```powershell
$env:PYTHONUTF8 = '1'
python -m pip install platformio==6.1.18
python -m platformio run -e esp32dev
Get-FileHash .pio/build/esp32dev/firmware.bin -Algorithm SHA256
python -m platformio pkg list -e esp32dev
```

Nếu dùng virtualenv trong `.tools/iot-python` ở root repository, thay `python`
bằng đường dẫn tuyệt đối tới `Scripts/python.exe` của virtualenv đó. Dependency
được pin trong `platformio.ini`: Espressif32 6.9.0, Arduino ESP32 2.0.17,
Xtensa 8.4.0+2021r2-patch5 và DHTesp 1.19.

Trên Windows, đặt PlatformIO core/toolchain tại đường dẫn ngắn. Nếu gặp
`xtensa-esp32-elf-g++: error: CreateProcess`, đường dẫn include dài có thể làm
vượt giới hạn command line. Có thể ánh xạ tạm thư mục core bằng `subst` tới
một ký tự ổ đĩa chưa sử dụng, đặt `PLATFORMIO_CORE_DIR` tới ổ đó, build với
`-j 1`, rồi gỡ ánh xạ sau build. Không cần sửa code thư viện để né lỗi này.

Mở thư mục `iot/wokwi` bằng VS Code có Wokwi extension và chạy **Wokwi: Start
Simulator** sau build. Xem [hướng dẫn PlatformIO của Wokwi](https://docs.wokwi.com/vscode/platformio).
Có thể sao chép `config.example.h` thành `include/agritrace_config.h` để đổi WiFi/NTP;
file riêng này bị Git bỏ qua. Bản độc lập không cần token.

## Mạch và thao tác

| Thành phần | GPIO | Hành vi |
| --- | --- | --- |
| DHT22 | 4 | 3V3/GND, pull-up 10 kΩ; chỉnh nhiệt/ẩm bằng thanh trượt Wokwi |
| DOOR | 18 | Nhấn đổi đóng/mở, debounce 50 ms; không thay nhiệt độ |
| WIFI | 19 | Nhấn ngắt/kết nối WiFi thật, đo tiếp khi offline nếu đã đồng bộ giờ |
| STOP | 21 | Dừng lấy mẫu đến lần reset; giữ queue và trạng thái local |
| LED xanh | 25 | WiFi đã kết nối, điện trở 220 Ω |
| LED đỏ | 26 | Chưa NTP, lỗi sensor, mất mạng hoặc queue đầy; xem Serial |

Không dùng thời gian tăng tốc. Đọc sensor lỗi không tạo mẫu 0 hoặc tái sử dụng
giá trị cũ. Khi RAM đầy, dừng tạo mẫu mới và báo `QUEUE_FULL`, không ghi đè.
Reset/đóng simulator mất RAM: bootId mới báo lần khởi động mới, không chứng minh
khôi phục dữ liệu. Local stop không phải yêu cầu DRAINING trên server.

## Kiểm thử logic

Test C++ dùng cùng header với firmware, không cần sensor/mạng hoặc backend:

```powershell
g++ -std=c++11 -Wall -Wextra -Werror -I include test/test_monitoring/test_main.cpp -o monitoring-test.exe
./monitoring-test.exe
g++ -std=c++11 -Wall -Wextra -Werror -I test/stubs -I include test/test_firmware.cpp -o firmware-test.exe
./firmware-test.exe
```

Chạy trong thư mục tạm hoặc xóa executable sau chạy; không commit binary.
Kiểm FIFO, 180 slot gồm quarantine, cutoff giữ nguyên timestamp, receipt đúng
sampleId, debounce/wrap millis, retry/backoff/Retry-After và giá trị sensor lỗi.
Các test này không thay nghiệm thu Wokwi runtime, HTTPS, API hoặc Fabric.

Test thứ hai chạy chính `setup()/loop()` với stub phần cứng và clock điều khiển
trong test: chờ NTP, mất WiFi 60 giây, đồng bộ lại, sensor lỗi/NaN, nút cửa,
STOP, queue đầy và tiếp tục khi giải phóng slot. Không dùng clock tăng tốc này
trong firmware hoặc gửi timestamp giả vào API. Test FIFO còn chạy 100 lượt
fill/drain (18.000 mẫu) để kiểm việc tái sử dụng bộ nhớ.
`LOCAL_STATUS` phân biệt `RUNNING`, `WAIT_NTP`, `STOPPED`, `QUEUE_FULL` và
trạng thái sensor riêng; chưa phải heartbeat của server.

Workflow `Firmware CI` chạy test này và build ESP32 trên PR/main, merge queue
và dispatch; log có danh sách package cùng checksum binary. Đây là kiểm tra
bổ sung, không thay Application/Blockchain/Dependency gate hiện có.

Kiểm thủ công trong simulator: chờ NTP và mẫu đầu, nhấn cửa, chỉnh DHT22, tắt
WiFi 60 giây rồi bật, nhấn STOP và reset. Kiểm không mất queue khi WiFi tắt,
không tạo mẫu sau STOP và bootId đổi sau reset. Chạy 30 phút để kiểm QUEUE_FULL.
Kết quả thực tế ghi vào PR/artifact, chưa chạy không đánh dấu đạt.

## Điểm nối sau khi chốt IO02

Adapter HTTPS cần dùng credential riêng, CA và hostname verification; tối đa
5 giây/request và chạy độc lập với vòng lấy mẫu/nút. Không có `setInsecure` hoặc
fallback khóa chung. Endpoint/body phải lấy từ Swagger đã sinh, không suy từ
API telemetry cũ đang yêu cầu GPS và chưa hỗ trợ session.

- Runtime/heartbeat mỗi 10 giây, bootId, pending/quarantine và samplingStopped.
- Session DRAINING dừng đo; `Samples::cutoff` giữ mẫu sau cutoff ở quarantine.
- Body/key gốc từ sampleId phải giữ nguyên qua retry; chỉ gọi `acknowledge`
  sau receipt committed khớp đúng mẫu. UNKNOWN cần inspection trước.
- `Backoff` cung cấp 1/2/4/8/16/30 giây + jitter và tôn trọng Retry-After.
  `actionFor` là policy thuần đã kiểm thử, chưa phải HTTP client.
- Credential lỗi dừng network writes; terminal dừng đo và giữ phần chưa nhận.
- Gửi bù, TLS âm, heartbeat server, seal/proof và managed/self-managed cần
  kiểm lại với API và môi trường cách ly sau xác nhận baseline onboarding.

TÀI LIỆU PHÂN TÍCH NGHIỆP VỤ

HỆ THỐNG TRUY XUẤT NGUỒN GỐC NÔNG SẢN
ỨNG DỤNG BLOCKCHAIN



| Thuộc tính | Nội dung |

| --- | --- |

| Đồ án | Xây dựng hệ thống truy xuất nguồn gốc nông sản ứng dụng Blockchain |

| Phạm vi áp dụng | Chuỗi cung ứng nông sản quy mô nhỏ, mô phỏng 1-2 hợp tác xã hoặc trang trại mẫu tại TP.HCM |

| Luồng cốt lõi | Tạo lô -> gieo trồng -> chăm sóc/IoT -> thu hoạch -> tạo shipment -> vận chuyển -> bán lẻ -> QR -> người tiêu dùng tra cứu |

| Mô hình lô | 1 Batch : 1 Shipment : 1 Retailer đích; không tách/gộp lô trong phạm vi v1.2 |

| Mục tiêu tài liệu | Khóa nghiệp vụ, quyền, State Machine, TraceEvent, quy tắc hash và điểm bàn giao để sẵn sàng triển khai Blockchain, Backend, Frontend/IoT |

| Phiên bản | 1.2 - Tháng 08/2026 |





Thay đổi chính v1.2: bổ sung REJECTED/DAMAGED; khóa FARM_STAFF tạo Shipment; cơ chế Flush & Finalize IoT khi thu hoạch; chuẩn RFC 8785/JCS + SHA-256; mô hình Backend Custodial Wallet/Relayer và actor evidence; khóa phạm vi 1-1 Batch-Shipment-Retailer.



# Mục lục nội dung

1. Mục đích và nguyên tắc tài liệu nghiệp vụ

2. Phạm vi nghiệp vụ của hệ thống

3. Tác nhân và quyền nghiệp vụ

4. Đối tượng nghiệp vụ chính

5. Quy trình nghiệp vụ tổng thể

6. Luồng nghiệp vụ chi tiết theo công đoạn

7. State Machine của vòng đời lô nông sản

8. Danh mục sự kiện truy xuất (Trace Event Catalogue)

9. Quy tắc nghiệp vụ bắt buộc

10. Use Case nghiệp vụ

11. Nguyên tắc dữ liệu và bằng chứng Blockchain

12. Kịch bản lỗi và ngoại lệ

13. Tiêu chí nghiệm thu nghiệp vụ

14. Phạm vi không thực hiện trong đồ án

15. Kết luận nghiệp vụ cần khóa trước khi code

Phụ lục A. Điểm bàn giao giữa ba module

Phụ lục B. Command/State Matrix phục vụ code

Phụ lục C. Canonical payload mẫu và quy tắc hash



# 1. Mục đích và nguyên tắc tài liệu nghiệp vụ

Tài liệu này mô tả hệ thống ở góc nhìn nghiệp vụ: ai thực hiện, thực hiện việc gì, trên lô nông sản nào, ở thời điểm nào, điều kiện nào cho phép chuyển sang công đoạn tiếp theo, dữ liệu nào được lưu off-chain và bằng chứng nào được neo lên Blockchain. Tài liệu là baseline nghiệp vụ thống nhất để Blockchain, Backend và Frontend/IoT cùng triển khai theo một logic duy nhất.

- Bám sát chuỗi cốt lõi: tạo lô -> gieo trồng -> chăm sóc/IoT -> thu hoạch -> tạo Shipment -> vận chuyển -> bán lẻ -> QR -> tra cứu.

- Mỗi công đoạn phải xác định actor, điều kiện trước, dữ liệu đầu vào, command, validation, TraceEvent, bằng chứng Blockchain, trạng thái sau và ngoại lệ.

- Không cho phép client cập nhật currentState/status trực tiếp. Mọi chuyển trạng thái chỉ đi qua command nghiệp vụ hợp lệ.

- CARE và SENSOR là sự kiện lặp trong giai đoạn PLANTED và không tự tạo state mới.

- Bất kỳ thay đổi logic nào ảnh hưởng State Machine, quyền hoặc canonical payload phải được đồng bộ giữa Backend, Blockchain và Frontend/IoT.

- Blockchain lưu bằng chứng bất biến và lịch sử cần thiết; dữ liệu vận hành chi tiết và raw sensor được lưu off-chain.

- Người tiêu dùng không cần ví Blockchain; mọi tương tác chain đi qua Backend Custodial Wallet/Relayer Service.

- Tài liệu v1.2 khóa rõ các trạng thái kết thúc bất thường CANCELLED, DAMAGED, REJECTED và giới hạn mô hình 1 Batch - 1 Shipment - 1 Retailer đích.

# 2. Phạm vi nghiệp vụ của hệ thống

## 2.1. Phạm vi áp dụng

- Một chuỗi cung ứng nông sản quy mô nhỏ, mô phỏng 1-2 hợp tác xã hoặc trang trại mẫu tại khu vực TP.HCM.

- Sản phẩm được truy xuất theo đơn vị lô (Batch/Lot), không quản lý từng đơn vị rau/quả riêng lẻ.

- Chuỗi tác nhân tối thiểu: đơn vị sản xuất -> đơn vị vận chuyển -> nhà bán lẻ -> người tiêu dùng.

- Dữ liệu nghiệp vụ có thể nhập tay hoặc sinh từ IoT giả lập. IoT thật là phần mở rộng, không phải điều kiện bắt buộc của core.

- Mô hình vận chuyển của v1.2 là 1-1: một Batch chỉ có một Shipment duy nhất và một Retailer đích duy nhất.

- Blockchain dùng để lưu TraceEvent/bằng chứng, hỗ trợ phát hiện dữ liệu off-chain bị sửa và truy ngược lịch sử.

- Các trạng thái DAMAGED và REJECTED được coi là trạng thái kết thúc trong phạm vi PoC; không triển khai quy trình hoàn hàng, tái vận chuyển hoặc tái chế.

## 2.2. Chức năng nghiệp vụ bắt buộc

| Nhóm nghiệp vụ | Mô tả |

| --- | --- |

| Quản trị | Tạo tổ chức, người dùng, gán role, khóa/mở tài khoản, đăng ký transporter/retailer. |

| Quản lý lô | Tạo batchCode duy nhất, xác định sản phẩm và đơn vị sản xuất. |

| Gieo trồng | Ghi thông tin gieo trồng; CREATED -> PLANTED. |

| Chăm sóc | Ghi tưới, bón phân, xử lý sâu bệnh, kiểm tra sinh trưởng; giữ PLANTED. |

| IoT | Nhận raw sensor, lưu off-chain, gom digest SENSOR_RECORDED; chỉ khi PLANTED. |

| Thu hoạch | Flush & Finalize toàn bộ IoT còn chờ, ghi HARVEST_RECORDED; PLANTED -> HARVESTED. |

| Shipment | FARM_STAFF tạo/gán Shipment duy nhất cho Batch HARVESTED và chọn TRANSPORTER + Retailer đích. |

| Vận chuyển | TRANSPORTER bắt đầu/hoàn tất Shipment; có thể báo hỏng -> DAMAGED. |

| Bán lẻ | RETAILER nhận lô -> RETAIL_RECEIVED hoặc từ chối -> REJECTED; sau đó markForSale -> FOR_SALE. |

| QR truy xuất | Sinh QR chứa batchId/trace URL. |

| Tra cứu | Hiển thị hồ sơ lô, timeline, actor/organization và trạng thái xác minh. |

| Xác minh toàn vẹn | Canonicalize bằng RFC 8785/JCS, SHA-256, đối chiếu hash với Blockchain. |





## 2.3. Ranh giới nghiệp vụ 1-1 của Batch

Trong v1.2, Batch là đơn vị truy xuất trung tâm và không được tách/gộp. Một Batch chỉ được liên kết với đúng một Shipment; Shipment đó chỉ có một TRANSPORTER được gán và một Retailer đích. Ràng buộc này giảm nhánh State Machine và tránh bài toán phân chia sản lượng, nhiều chain-of-custody song song hoặc hợp nhất lịch sử.

# 3. Tác nhân và quyền nghiệp vụ

| Role/Service | Đại diện | Quyền nghiệp vụ chính |

| --- | --- | --- |

| SYSTEM_ADMIN | Quản trị hệ thống | Tạo organization/user; gán role; đăng ký transporter/retailer/device; khóa/mở tài khoản. Không đại diện actor nghiệp vụ để ghi sự kiện sản xuất/vận chuyển/bán lẻ. |

| FARM_STAFF | Nhân viên sản xuất thuộc Trang trại/HTX | Tạo Batch; ghi gieo trồng/chăm sóc; ghi thu hoạch; báo DAMAGED khi Batch ở HARVESTED; tạo/gán Shipment duy nhất cho Batch HARVESTED. |

| IOT_DEVICE | Thiết bị/Simulator | Gửi sensor payload cho Batch được gán khi PLANTED. Không được chuyển state. |

| TRANSPORTER | Đơn vị vận chuyển | Chỉ thao tác Shipment được gán cho organization của mình; startTransport, completeTransport; báo DAMAGED khi IN_TRANSPORT. |

| RETAILER | Nhà bán lẻ | Trên Shipment có destination đúng organization: receiveRetail hoặc rejectRetail; sau khi nhận có thể markForSale. |

| AUDITOR | Người kiểm tra | Đọc lịch sử, bằng chứng, trạng thái xác minh; không sửa dữ liệu nghiệp vụ. |

| CONSUMER | Người tiêu dùng | Tra cứu công khai qua QR; không đăng nhập, không ghi/sửa dữ liệu. |

| RELAYER_SERVICE | Backend Custodial Wallet/Relayer | Tài khoản dịch vụ dùng khóa Blockchain để submit giao dịch đã được Backend xác thực/ủy quyền. Không phải actor nghiệp vụ; không thay thế actor người dùng trong TraceEvent. |





## 3.1. Nguyên tắc kiểm soát quyền

- Đúng role là điều kiện cần nhưng chưa đủ; Backend phải kiểm tra đồng thời role, organization, object ownership và currentState.

- FARM_STAFF của tổ chức A không được thao tác Batch của tổ chức B.

- TRANSPORTER chỉ được start/complete Shipment đã được FARM_STAFF gán cho transporter organization đó.

- RETAILER chỉ được receive/reject Shipment có destinationRetailerOrg đúng organization của mình.

- Chỉ FARM_STAFF được tạo Shipment. SYSTEM_ADMIN, Backend service và TRANSPORTER không được thay mặt FARM_STAFF tạo/gán Shipment trong core flow.

- Không tách role PLANTING_STAFF, CARE_STAFF, HARVEST_STAFF trong v1.2.

## 3.2. Mô hình Blockchain Custodial Wallet và bất khả chối bỏ

Hệ thống sử dụng Backend Custodial Wallet/Relayer Service: người dùng không giữ ví Blockchain và không ký trực tiếp từng giao dịch on-chain. Backend xác thực user, kiểm tra quyền nghiệp vụ, tạo canonical businessPayload, tính dataHash và dùng relayer wallet để submit giao dịch.

Để duy trì bằng chứng quy trách nhiệm ở mức nghiệp vụ, mỗi TraceEvent phải nhúng actorContext trước khi băm: userId, organizationId, role, eventTime và actorAuthProof. actorAuthProof phải là bằng chứng định danh có thể kiểm tra lại (ví dụ chữ ký số của actor nếu triển khai, hoặc signed authentication assertion/token identifier/fingerprint do hệ thống xác thực tạo ra). Không lưu raw access token, password, secret key hoặc session secret trong payload/on-chain.

Lưu ý phạm vi: với mô hình custodial, chữ ký giao dịch Blockchain thuộc Relayer Service. Vì vậy v1.2 cung cấp non-repudiation ở mức nghiệp vụ dựa trên actor identity + authentication evidence + immutable hash; không tuyên bố tương đương mô hình mỗi người dùng tự giữ private key và tự ký giao dịch on-chain.

# 4. Đối tượng nghiệp vụ chính

| Đối tượng | Ý nghĩa nghiệp vụ | Thuộc tính tối thiểu |

| --- | --- | --- |

| Organization | HTX/trang trại, transporter hoặc retailer. | organizationId, name, type, status |

| User | Người dùng nội bộ thuộc một organization. | userId, organizationId, role, accountStatus |

| Batch | Đối tượng trung tâm của truy xuất. | batchId, batchCode, productName, farmOrg, createdAt, currentState, shipmentId? |

| TraceEvent | Sự kiện truy xuất bất biến theo append-only. | eventId, batchId, eventType, actorContext, eventTime, businessData, schemaVersion, dataHash |

| SensorReading | Raw dữ liệu cảm biến off-chain. | readingId, deviceId, batchId, temperature, humidity, timestamp, ingestTime |

| SensorDigest | Tập hợp/summary sensor được băm. | digestId, batchId, periodStart, periodEnd, readingCount, digestHash, isFinal |

| Shipment | Vận chuyển duy nhất của Batch. | shipmentId, batchId(unique), transporterOrg, retailerOrg, origin, destination, pickupTime, deliveryTime, status |

| BlockchainProof | Bằng chứng giao dịch. | network, txId/txHash, dataHash, recordedAt, relayerAddress |

| TraceQR | Định danh/URL để tra cứu. | batchId hoặc trace URL; không chứa toàn bộ lịch sử |

| ActorContext | Ngữ cảnh actor được đưa vào payload trước khi băm. | userId, organizationId, role, actorAuthProof, authProofType |





# 5. Quy trình nghiệp vụ tổng thể

Quy trình tổng thể theo một đường đi chính của Batch. CARE/SENSOR xen kẽ trong PLANTED. Shipment chỉ được tạo sau HARVESTED. DAMAGED và REJECTED là nhánh kết thúc ngoại lệ.

| Bước | Công đoạn | Kết quả nghiệp vụ |

| --- | --- | --- |

| 1 | Khởi tạo | SYSTEM_ADMIN tạo org, user, device, transporter, retailer. |

| 2 | Tạo lô | FARM_STAFF tạo Batch CREATED. |

| 3 | Gieo trồng | FARM_STAFF recordPlanting: CREATED -> PLANTED. |

| 4 | Chăm sóc/IoT | FARM_STAFF ghi CARE; IOT_DEVICE gửi sensor; state giữ PLANTED. |

| 5 | Thu hoạch | FARM_STAFF recordHarvest; hệ thống Flush & Finalize IoT trước, sau đó PLANTED -> HARVESTED. |

| 6 | Tạo Shipment | FARM_STAFF tạo Shipment duy nhất, gán TRANSPORTER + Retailer đích; state giữ HARVESTED. |

| 7 | Vận chuyển | TRANSPORTER start: HARVESTED -> IN_TRANSPORT; complete: IN_TRANSPORT -> TRANSPORTED; có thể DAMAGED. |

| 8 | Bán lẻ | RETAILER receive: TRANSPORTED -> RETAIL_RECEIVED hoặc reject: TRANSPORTED -> REJECTED. |

| 9 | Đưa ra bán | RETAILER markForSale: RETAIL_RECEIVED -> FOR_SALE. |

| 10 | QR/Tra cứu | Hệ thống/CONSUMER mở trace timeline + proof verification. |





# 6. Luồng nghiệp vụ chi tiết theo công đoạn

## 6.1. Tạo lô nông sản

Tác nhân chính: FARM_STAFF

Điều kiện trước: User đã đăng nhập; organization sản xuất đang active.

Đầu ra: Batch CREATED; BATCH_CREATED + proof.

### Dữ liệu đầu vào

- batchCode duy nhất.

- productName.

- farmOrg lấy từ context, không cho client giả mạo.

- createdAt theo server UTC.

### Xử lý nghiệp vụ

1. Xác thực role = FARM_STAFF, organization active.

1. Kiểm tra batchCode chưa tồn tại.

1. Tạo Batch currentState = CREATED.

1. Tạo BATCH_CREATED với actorContext; canonicalize JCS; SHA-256; submit proof qua Relayer.

### Trường hợp phải từ chối

- batchCode trùng.

- Sai role/organization.

- Thiếu dữ liệu bắt buộc.

- Không tạo được proof theo chính sách consistency đã chọn.

## 6.2. Ghi nhận gieo trồng

Tác nhân chính: FARM_STAFF

Điều kiện trước: Batch tồn tại, thuộc organization của user, state = CREATED.

Đầu ra: Batch PLANTED; PLANTING_RECORDED + proof.

### Dữ liệu đầu vào

- batchId.

- plantingTime ISO-8601 UTC.

- seed/variety.

- location/plot nếu quản lý.

- ghi chú nghiệp vụ.

### Xử lý nghiệp vụ

1. Xác thực role + organization + ownership.

1. Validate state CREATED.

1. Lưu dữ liệu gieo trồng.

1. Tạo PLANTING_RECORDED, actorContext, JCS + SHA-256 + proof.

1. Chuyển CREATED -> PLANTED bằng command recordPlanting.

### Trường hợp phải từ chối

- Gieo trồng lặp.

- Batch không ở CREATED.

- Sai organization/ownership.

- Payload không hợp lệ.

## 6.3. Ghi nhận chăm sóc

Tác nhân chính: FARM_STAFF

Điều kiện trước: Batch state = PLANTED và thuộc organization của user.

Đầu ra: Một CARE_RECORDED; state vẫn PLANTED.

### Dữ liệu đầu vào

- careType: tưới/bón phân/xử lý sâu bệnh/kiểm tra sinh trưởng/...

- eventTime.

- details: mô tả, khối lượng/liều lượng nếu có.

### Xử lý nghiệp vụ

1. Kiểm tra quyền.

1. Validate state PLANTED.

1. Lưu CARE_RECORDED.

1. Tạo actorContext; JCS + SHA-256; ghi proof.

1. Không thay đổi lifecycle state.

### Trường hợp phải từ chối

- Batch chưa PLANTED hoặc đã rời PLANTED.

- Dữ liệu chăm sóc không hợp lệ.

## 6.4. Ghi nhận IoT và cơ chế Flush & Finalize

Tác nhân chính: IOT_DEVICE hoặc simulator. Điều kiện nhận sensor: Batch = PLANTED, deviceId hợp lệ và được gán cho Batch.

- Payload tối thiểu: deviceId, batchId, temperature/humidity hoặc trường cảm biến đã khóa, timestamp.

- Raw SensorReading lưu off-chain. Theo chu kỳ, Backend gom nhóm và tạo SENSOR_RECORDED digest; không ghi từng raw reading lên Blockchain.

- Mỗi SENSOR_RECORDED phải mô tả periodStart, periodEnd, readingCount, digest/summary và cờ isFinal nếu là digest cuối trước thu hoạch.

### Cơ chế Flush & Finalize khi recordHarvest

1. Khi nhận command recordHarvest hợp lệ, Backend lấy lock nghiệp vụ trên Batch và đặt sensorIngestionLocked = true (cờ xử lý nội bộ, không phải lifecycle state).

1. Chốt harvestCutoffTime theo server UTC. Từ thời điểm khóa, sensor payload mới cho Batch bị từ chối/retry theo chính sách; không được lọt vào sau digest cuối.

1. Drain toàn bộ raw readings còn trong queue/buffer và toàn bộ readings hợp lệ có timestamp <= harvestCutoffTime chưa được đưa vào digest.

1. Chuẩn hóa tập dữ liệu, tạo SENSOR_RECORDED cuối cùng với isFinal = true, canonicalize JCS, SHA-256 và ghi BlockchainProof.

1. Chỉ khi final sensor digest được commit thành công mới tiếp tục tạo HARVEST_RECORDED và chuyển state sang HARVESTED.

1. Nếu Flush/Finalize hoặc ghi proof thất bại: không chuyển HARVESTED; Batch vẫn PLANTED nhưng giữ cơ chế kiểm soát retry/idempotency để không tạo digest trùng. Sau khi recovery thành công mới hoàn tất recordHarvest.

### Trường hợp phải từ chối

- deviceId chưa đăng ký/không gắn Batch.

- Batch không ở PLANTED.

- timestamp/giá trị cảm biến không hợp lệ.

- Sensor payload đến sau khi Batch đã HARVESTED/DAMAGED/CANCELLED hoặc khi ingestion đang khóa cho finalize.

## 6.5. Ghi nhận thu hoạch

Tác nhân chính: FARM_STAFF

Điều kiện trước: Batch = PLANTED; user đúng organization/ownership.

Đầu ra: Final SENSOR_RECORDED (nếu có dữ liệu chưa chốt), HARVEST_RECORDED; Batch HARVESTED.

### Dữ liệu đầu vào

- batchId.

- harvestTime.

- quantity > 0 và unit.

- qualityNote nếu có.

### Xử lý nghiệp vụ

1. Kiểm tra quyền và state PLANTED.

1. Validate quantity > 0, unit hợp lệ.

1. Kích hoạt Flush & Finalize IoT theo Mục 6.4; bắt buộc hoàn tất trước transition.

1. Tạo HARVEST_RECORDED với actorContext, JCS + SHA-256 + proof.

1. Chuyển PLANTED -> HARVESTED.

1. Mở khóa xử lý; từ đây BR-07 khiến mọi SENSOR/CARE mới bị reject.

### Trường hợp phải từ chối

- Thu hoạch trước gieo trồng.

- Thu hoạch lần hai.

- Quantity <= 0/thiếu unit.

- Flush & Finalize thất bại.

- Sai quyền/organization.

## 6.6. Tạo và thực hiện vận chuyển

### 6.6.1. Tạo/gán Shipment

Tác nhân chính: FARM_STAFF. Đây là quyền được khóa cố định trong v1.2.

- Điều kiện: Batch = HARVESTED; chưa có Shipment; transporterOrg và retailerOrg đều đã đăng ký/active.

- Dữ liệu: batchId, transporterOrg, retailerOrg, origin, destination, plannedPickupTime nếu có.

- Ràng buộc: batchId là unique trong Shipment; một Batch không được có Shipment thứ hai. Retailer đích cố định cho Shipment trong core flow.

1. Kiểm tra FARM_STAFF đúng farmOrg/ownership.

1. Kiểm tra Batch HARVESTED và shipmentId chưa tồn tại.

1. Kiểm tra transporterOrg, retailerOrg hợp lệ.

1. Tạo Shipment; gán transporter + retailer đích.

1. Tạo SHIPMENT_CREATED với actor FARM_STAFF, actorContext, JCS + SHA-256 + proof.

1. Không đổi state: Batch vẫn HARVESTED cho đến startTransport.

### 6.6.2. Bắt đầu/hoàn tất vận chuyển

Tác nhân chính: TRANSPORTER đã được gán.

1. startTransport: validate Shipment + transporter ownership + Batch HARVESTED; tạo TRANSPORT_STARTED; HARVESTED -> IN_TRANSPORT.

1. completeTransport: chỉ khi IN_TRANSPORT; tạo TRANSPORT_COMPLETED; IN_TRANSPORT -> TRANSPORTED.

1. Mọi event ghi actor/organization để duy trì chain of custody.

1. Nếu phát hiện hỏng/mất mát khi IN_TRANSPORT: reportDamaged -> DAMAGE_RECORDED -> DAMAGED.

### Trường hợp phải từ chối

- SYSTEM_ADMIN/Backend/TRANSPORTER cố tạo Shipment.

- Batch đã có Shipment.

- Batch chưa HARVESTED hoặc đã DAMAGED.

- Sai transporter hoặc shipment ownership.

- startTransport/completeTransport lặp.

- completeTransport trước startTransport.

## 6.7. Bán lẻ: nhận hoặc từ chối lô

Tác nhân chính: RETAILER. Điều kiện: Batch = TRANSPORTED; Shipment destinationRetailerOrg đúng organization của retailer.

### Nhánh A - Nhận lô

1. RETAILER kiểm tra Shipment, Batch và destination.

1. receiveRetail -> tạo RETAIL_RECEIVED event + proof.

1. Chuyển TRANSPORTED -> RETAIL_RECEIVED.

1. Sau đó markForSale -> MARKED_FOR_SALE -> FOR_SALE.

### Nhánh B - Từ chối nhận

1. Nếu hàng hỏng/không đạt tại điểm nhận, RETAILER thực hiện rejectRetail và nhập rejectReason/inspectionNote.

1. Tạo RETAIL_REJECTED + proof.

1. Chuyển TRANSPORTED -> REJECTED.

1. REJECTED là terminal state trong core; không cho receiveRetail/markForSale tiếp.

### Trường hợp phải từ chối

- Retailer khác organization/destination.

- receiveRetail hoặc rejectRetail khi Batch chưa TRANSPORTED.

- markForSale khi chưa RETAIL_RECEIVED.

- Gọi receiveRetail sau khi Batch đã REJECTED.

## 6.8. Ghi nhận hàng hỏng (DAMAGED)

DAMAGED được dùng khi hàng bị hỏng/mất mát trước khi hoàn tất vận chuyển đến điểm bán lẻ. Chỉ có hai transition trong v1.2: HARVESTED -> DAMAGED và IN_TRANSPORT -> DAMAGED.

| State hiện tại | Actor được phép | Command/Event | Kết quả |

| --- | --- | --- | --- |

| HARVESTED | FARM_STAFF | reportDamaged / DAMAGE_RECORDED | DAMAGED |

| IN_TRANSPORT | TRANSPORTER | reportDamaged / DAMAGE_RECORDED | DAMAGED |





- Dữ liệu tối thiểu: damageTime, damageType, description, affectedQuantity nếu có, evidenceRef nếu có.

- DAMAGED là terminal state trong phạm vi PoC. Không được start/complete transport, receiveRetail hoặc markForSale sau đó.

## 6.9. QR và tra cứu người tiêu dùng

Tác nhân chính: CONSUMER. QR chứa batchId hoặc trace URL. Backend trả hồ sơ công khai, timeline và verification status. Đối với Batch DAMAGED/REJECTED/CANCELLED, trang trace vẫn có thể hiển thị lịch sử và trạng thái cuối phù hợp, nhưng không hiển thị là đang bán.

1. Quét QR mở /trace/{batchId}.

1. Backend lấy Batch + public TraceEvent.

1. Tái tạo canonical payload theo RFC 8785/JCS và tính SHA-256.

1. Đối chiếu proof on-chain.

1. Trả VERIFIED / INTEGRITY_WARNING / BLOCKCHAIN_UNAVAILABLE theo từng event hoặc toàn Batch.

# 7. State Machine của vòng đời lô nông sản

State Machine v1.2 mô tả các mốc vòng đời của Batch. CARE/SENSOR là self-events ở PLANTED. Tạo Shipment là nghiệp vụ không đổi state. sensorIngestionLocked/finalizing là cờ xử lý nội bộ, không phải lifecycle state.



Hình 2. State Machine v1.2 của vòng đời lô nông sản

| State | Ý nghĩa | Transition hợp lệ |

| --- | --- | --- |

| CREATED | Lô đã tạo, chưa gieo. | recordPlanting -> PLANTED; cancel -> CANCELLED |

| PLANTED | Đã gieo; CARE/SENSOR có thể phát sinh nhiều lần. | recordHarvest -> HARVESTED (sau Flush & Finalize); cancel -> CANCELLED |

| HARVESTED | Đã thu hoạch; có thể tạo Shipment duy nhất. | startTransport -> IN_TRANSPORT; reportDamaged -> DAMAGED |

| IN_TRANSPORT | Đang vận chuyển. | completeTransport -> TRANSPORTED; reportDamaged -> DAMAGED |

| TRANSPORTED | Đã giao tới điểm bán lẻ, chờ kiểm tra. | receiveRetail -> RETAIL_RECEIVED; rejectRetail -> REJECTED |

| RETAIL_RECEIVED | Retailer đã nhận. | markForSale -> FOR_SALE |

| FOR_SALE | Đủ điều kiện hiển thị đang bán. | Terminal trong core |

| CANCELLED | Lô bị hủy ở giai đoạn sớm. | Terminal |

| DAMAGED | Hàng hỏng/mất mát sau thu hoạch hoặc trong vận chuyển. | Terminal |

| REJECTED | Retailer từ chối nhận hàng sau TRANSPORTED. | Terminal |





## 7.1. Transition không làm đổi state

| Command/Event | State yêu cầu | State sau | Ghi chú |

| --- | --- | --- | --- |

| recordCare / CARE_RECORDED | PLANTED | PLANTED | Có thể nhiều lần. |

| recordSensorDigest / SENSOR_RECORDED | PLANTED | PLANTED | Digest định kỳ hoặc final digest. |

| createShipment / SHIPMENT_CREATED | HARVESTED | HARVESTED | Chỉ FARM_STAFF; tối đa 1 Shipment/Batch. |





# 8. Danh mục sự kiện truy xuất (Trace Event Catalogue)

| Event type | Công đoạn | Actor | Ảnh hưởng state | Dữ liệu nghiệp vụ tối thiểu |

| --- | --- | --- | --- | --- |

| BATCH_CREATED | Tạo lô | FARM_STAFF | -> CREATED | batchCode, product, farmOrg |

| PLANTING_RECORDED | Gieo trồng | FARM_STAFF | CREATED -> PLANTED | plantingTime, seed/variety, location |

| CARE_RECORDED | Chăm sóc | FARM_STAFF | PLANTED giữ nguyên | careType, time, details |

| SENSOR_RECORDED | IoT/cảm biến | IOT_DEVICE/System | PLANTED giữ nguyên | deviceId/period, readingCount, digest/summary, isFinal |

| HARVEST_RECORDED | Thu hoạch | FARM_STAFF | PLANTED -> HARVESTED | harvestTime, quantity, unit, finalSensorDigestId? |

| SHIPMENT_CREATED | Tạo/gán Shipment | FARM_STAFF | HARVESTED giữ nguyên | shipmentId, transporterOrg, retailerOrg, origin, destination |

| TRANSPORT_STARTED | Bắt đầu vận chuyển | TRANSPORTER | HARVESTED -> IN_TRANSPORT | shipmentId, carrier, pickupTime |

| TRANSPORT_COMPLETED | Kết thúc vận chuyển | TRANSPORTER | IN_TRANSPORT -> TRANSPORTED | shipmentId, deliveryTime |

| DAMAGE_RECORDED | Báo hỏng/mất mát | FARM_STAFF/TRANSPORTER | HARVESTED/IN_TRANSPORT -> DAMAGED | damageTime, damageType, description, affectedQuantity? |

| RETAIL_RECEIVED | Retailer nhận lô | RETAILER | TRANSPORTED -> RETAIL_RECEIVED | retailerOrg, receivedTime |

| RETAIL_REJECTED | Retailer từ chối | RETAILER | TRANSPORTED -> REJECTED | retailerOrg, rejectedTime, rejectReason |

| MARKED_FOR_SALE | Đưa ra bán | RETAILER | RETAIL_RECEIVED -> FOR_SALE | saleReadyTime |

| BATCH_CANCELLED | Hủy lô sớm | FARM_STAFF | CREATED/PLANTED -> CANCELLED | cancelTime, reason |





Mọi event nghiệp vụ do người dùng kích hoạt đều phải có actorContext: userId, organizationId, role, actorAuthProof/authProofType. Event do hệ thống tạo tự động (ví dụ SENSOR_RECORDED final digest) phải có systemActor/service identity và liên kết command/event nguồn để audit.

# 9. Quy tắc nghiệp vụ bắt buộc

| Mã | Quy tắc nghiệp vụ |

| --- | --- |

| BR-01 | Mỗi batchCode phải duy nhất trong hệ thống. |

| BR-02 | Batch luôn thuộc một farm organization xác định. |

| BR-03 | Chỉ FARM_STAFF thuộc đúng organization và có quyền trên Batch được tạo/ghi sự kiện sản xuất, recordHarvest, reportDamaged ở HARVESTED và createShipment. |

| BR-04 | Batch mới tạo bắt đầu ở CREATED. |

| BR-05 | Chỉ CREATED mới được recordPlanting. |

| BR-06 | Không recordPlanting hai lần cho cùng Batch. |

| BR-07 | CARE và SENSOR chỉ được ghi khi Batch = PLANTED. Sau khi chuyển HARVESTED hoặc state khác, sensor payload mới bị từ chối. |

| BR-08 | CARE/SENSOR không tự làm thay đổi lifecycle state. |

| BR-09 | Chỉ PLANTED mới được recordHarvest. |

| BR-10 | Sản lượng thu hoạch phải > 0 và có unit. |

| BR-11 | Không harvest hai lần trong core flow. |

| BR-12 | recordHarvest bắt buộc hoàn tất Flush & Finalize toàn bộ sensor pending và commit final SENSOR_RECORDED proof trước khi chuyển HARVESTED. |

| BR-13 | Nếu Flush & Finalize thất bại, Batch không được chuyển HARVESTED; retry phải idempotent và không tạo final digest trùng. |

| BR-14 | Chỉ FARM_STAFF được createShipment; Batch phải HARVESTED, chưa có Shipment và transporter/retailer đích phải active. |

| BR-15 | Quan hệ Batch-Shipment là 1-1; một Batch không được có Shipment thứ hai trong v1.2. |

| BR-16 | Một Shipment chỉ có một Retailer đích trong v1.2; không đổi retailer sau khi Shipment được tạo. |

| BR-17 | TRANSPORTER chỉ thao tác Shipment được gán cho organization của mình. |

| BR-18 | Chỉ HARVESTED + Shipment hợp lệ mới được startTransport. |

| BR-19 | Không completeTransport trước startTransport; không lặp start/complete. |

| BR-20 | FARM_STAFF có thể reportDamaged khi HARVESTED; TRANSPORTER có thể reportDamaged khi IN_TRANSPORT; kết quả là DAMAGED terminal. |

| BR-21 | RETAILER chỉ receiveRetail/rejectRetail khi Batch TRANSPORTED và destinationRetailerOrg đúng organization. |

| BR-22 | TRANSPORTED chỉ được đi một trong hai nhánh receiveRetail -> RETAIL_RECEIVED hoặc rejectRetail -> REJECTED. |

| BR-23 | Chỉ RETAIL_RECEIVED mới được markForSale. |

| BR-24 | Mọi payload trước khi hash phải qua Canonical Serialization bằng RFC 8785 JSON Canonicalization Scheme (JCS) sau bước chuẩn hóa domain. Key order/whitespace/number serialization tuân RFC 8785; timestamp phải được chuẩn hóa thành ISO-8601 UTC theo format hệ thống đã khóa. |

| BR-25 | Chuỗi canonical bytes phải encode UTF-8 và tính SHA-256; biểu diễn dataHash thống nhất lowercase hex 64 ký tự. |

| BR-26 | Mọi thành phần tạo/kiểm tra hash phải dùng cùng canonicalizationVersion/schemaVersion và bộ test vector; không tự JSON.stringify tùy ý. |

| BR-27 | Mọi TraceEvent do actor người dùng kích hoạt phải đưa userId, organizationId, role, eventTime và actorAuthProof vào businessPayload trước khi canonicalize/hash. |

| BR-28 | Không lưu raw access token, password, private key hoặc session secret trong DB proof/on-chain; actorAuthProof dùng chữ ký số hoặc định danh/fingerprint/assertion có thể audit. |

| BR-29 | Mọi event quan trọng phải có dataHash và BlockchainProof truy ngược được. |

| BR-30 | Dữ liệu chi tiết và raw sensor lưu off-chain; không ghi raw stream lớn lên Blockchain. |

| BR-31 | Nếu hash tính lại khác expected hash trên chain -> INTEGRITY_WARNING; không được hiển thị VERIFIED. |

| BR-32 | Blockchain/RPC không truy cập được phải trả BLOCKCHAIN_UNAVAILABLE, phân biệt với hash mismatch. |

| BR-33 | Public API chỉ trả dữ liệu cần cho truy xuất; không lộ dữ liệu nội bộ/secret/actor auth evidence nhạy cảm. |

| BR-34 | Không có API cho client truyền trực tiếp currentState/status mới để bỏ qua command. |

| BR-35 | Mỗi command phải idempotent hoặc có idempotencyKey để chống tạo sự kiện trùng khi retry. |

| BR-36 | TraceEvent là append-only; user thông thường không sửa/xóa event đã ghi và có proof. |

| BR-37 | Các state FOR_SALE, CANCELLED, DAMAGED, REJECTED là terminal trong core v1.2; mọi command chuyển lifecycle tiếp theo phải reject. |

| BR-38 | Consumer không cần tài khoản/ví Blockchain để public trace. |





# 10. Use Case nghiệp vụ

| Mã | Use Case | Actor chính | Kết quả |

| --- | --- | --- | --- |

| UC-01 | Quản lý tổ chức/người dùng | SYSTEM_ADMIN | Org/user/role/device sẵn sàng. |

| UC-02 | Tạo lô | FARM_STAFF | Batch CREATED. |

| UC-03 | Ghi gieo trồng | FARM_STAFF | CREATED -> PLANTED. |

| UC-04 | Ghi chăm sóc | FARM_STAFF | CARE_RECORDED; giữ PLANTED. |

| UC-05 | Gửi dữ liệu IoT | IOT_DEVICE | Raw SensorReading + SENSOR_RECORDED digest. |

| UC-06 | Ghi thu hoạch | FARM_STAFF | Flush & Finalize IoT; PLANTED -> HARVESTED. |

| UC-07 | Tạo/gán Shipment | FARM_STAFF | Shipment duy nhất liên kết Batch với TRANSPORTER + Retailer đích. |

| UC-08 | Bắt đầu vận chuyển | TRANSPORTER | HARVESTED -> IN_TRANSPORT. |

| UC-09 | Hoàn tất vận chuyển | TRANSPORTER | IN_TRANSPORT -> TRANSPORTED. |

| UC-10 | Nhận lô tại bán lẻ | RETAILER | TRANSPORTED -> RETAIL_RECEIVED. |

| UC-11 | Đưa ra bán | RETAILER | RETAIL_RECEIVED -> FOR_SALE. |

| UC-12 | Sinh/mở QR | Hệ thống/CONSUMER | Mở /trace/{batchId}. |

| UC-13 | Tra cứu lịch sử | CONSUMER | Xem profile + timeline + trạng thái cuối. |

| UC-14 | Xác minh toàn vẹn | Hệ thống/CONSUMER/AUDITOR | VERIFIED hoặc cảnh báo. |

| UC-15 | Ghi nhận hư hỏng | FARM_STAFF/TRANSPORTER | HARVESTED/IN_TRANSPORT -> DAMAGED. |

| UC-16 | Từ chối nhận lô | RETAILER | TRANSPORTED -> REJECTED. |





## 10.1. UC-03 - Ghi gieo trồng

| Mục | Nội dung |

| --- | --- |

| Mục tiêu | Ghi điểm bắt đầu sản xuất của Batch và tạo bằng chứng truy xuất. |

| Actor | FARM_STAFF của farmOrg sở hữu Batch. |

| Tiền điều kiện | User active; role FARM_STAFF; Batch thuộc organization; state CREATED. |

| Luồng chính | Chọn Batch -> nhập dữ liệu -> Backend authorize/validate -> lưu -> actorContext -> JCS/SHA-256 -> proof -> CREATED -> PLANTED -> trả receipt/timeline. |

| Ngoại lệ | Batch đã PLANTED; sai organization; thiếu dữ liệu; proof lỗi. |

| Hậu điều kiện | PLANTING_RECORDED tồn tại, state PLANTED, có proof. |





## 10.2. UC-06 - Ghi thu hoạch và Finalize IoT

| Mục | Nội dung |

| --- | --- |

| Mục tiêu | Kết thúc giai đoạn sản xuất mà không bỏ sót sensor data trước harvest. |

| Actor | FARM_STAFF. |

| Tiền điều kiện | Batch PLANTED; đúng ownership; không có harvest trước đó. |

| Luồng chính | Authorize -> khóa sensor ingestion -> chốt cutoff UTC -> flush raw queue -> tạo final SENSOR_RECORDED/isFinal=true + proof -> tạo HARVEST_RECORDED + proof -> PLANTED -> HARVESTED. |

| Ngoại lệ | Finalize thất bại; quantity <= 0; sensor pipeline lỗi; Blockchain unavailable. |

| Hậu điều kiện | Không còn pending sensor trước cutoff; có final digest; Batch HARVESTED. Sensor mới bị reject. |





## 10.3. UC-07 - Tạo/gán Shipment

| Mục | Nội dung |

| --- | --- |

| Mục tiêu | Tạo Shipment duy nhất cho Batch sau thu hoạch và khóa transporter + retailer đích. |

| Actor | FARM_STAFF của farmOrg sở hữu Batch. |

| Tiền điều kiện | Batch HARVESTED; chưa có Shipment; transporterOrg và retailerOrg active/đã đăng ký. |

| Dữ liệu | batchId, transporterOrg, retailerOrg, origin, destination, plannedPickupTime? |

| Luồng chính | 1) Chọn Batch HARVESTED. 2) Chọn transporter và retailer đích. 3) Backend authorize FARM_STAFF + ownership. 4) Kiểm tra 1-1 uniqueness. 5) Tạo Shipment. 6) Tạo SHIPMENT_CREATED + actorContext + JCS/SHA-256 + proof. 7) Trả shipmentId; Batch vẫn HARVESTED. |

| Ngoại lệ | Batch chưa HARVESTED; đã có Shipment; transporter/retailer inactive; sai organization; request retry trùng. |

| Hậu điều kiện | Một và chỉ một Shipment liên kết Batch; TRANSPORTER được gán có thể UC-08. |





## 10.4. UC-15 - Ghi nhận hư hỏng

| Mục | Nội dung |

| --- | --- |

| Actor | FARM_STAFF nếu HARVESTED; TRANSPORTER nếu IN_TRANSPORT. |

| Tiền điều kiện | Batch ở đúng state và actor có ownership. |

| Luồng chính | Nhập reason/details -> validate -> DAMAGE_RECORDED + proof -> chuyển DAMAGED. |

| Hậu điều kiện | DAMAGED terminal; không thể vận chuyển/nhận/bán tiếp. |





## 10.5. UC-16 - Retailer từ chối nhận

| Mục | Nội dung |

| --- | --- |

| Actor | RETAILER là destinationRetailerOrg của Shipment. |

| Tiền điều kiện | Batch TRANSPORTED. |

| Luồng chính | Kiểm tra hàng -> nhập rejectReason -> RETAIL_REJECTED + proof -> TRANSPORTED -> REJECTED. |

| Hậu điều kiện | REJECTED terminal; không receiveRetail/markForSale. |





## 10.6. UC-14 - Xác minh toàn vẹn

| Mục | Nội dung |

| --- | --- |

| Mục tiêu | Xác định dữ liệu đọc từ off-chain còn khớp bằng chứng on-chain. |

| Actor | Hệ thống tự thực hiện; phục vụ CONSUMER/AUDITOR. |

| Tiền điều kiện | TraceEvent có dataHash, schemaVersion/canonicalizationVersion và BlockchainProof. |

| Luồng chính | Đọc payload off-chain -> domain normalize -> RFC8785 JCS -> UTF-8 -> SHA-256 lowercase hex -> đọc expected hash -> so sánh. |

| Nhánh | Khớp -> VERIFIED; khác -> INTEGRITY_WARNING; ledger/RPC unavailable -> BLOCKCHAIN_UNAVAILABLE. |

| Hậu điều kiện | UI hiển thị trạng thái xác minh rõ ràng. |





# 11. Nguyên tắc dữ liệu và bằng chứng Blockchain

## 11.1. Phân tách on-chain / off-chain

| Vùng dữ liệu | Nội dung |

| --- | --- |

| Off-chain - PostgreSQL/ứng dụng | Full business payload; user/org metadata; raw sensor readings; sensor queue/buffer; shipment metadata; timeline projection; state; idempotency records; auth evidence chi tiết nếu nhạy cảm. |

| On-chain - bằng chứng | eventId, batchId, eventType/stage, actor/org ở mức cần thiết, eventTime, dataHash, schemaVersion/canonicalizationVersion, previousEventHash nếu dùng, tx identifier. |

| Không đưa public chain | Password, private key, raw access token, session secret, dữ liệu cá nhân không cần thiết, raw sensor stream lớn, chứng từ nội bộ nhạy cảm. |





## 11.2. Canonical Serialization - RFC 8785 (JCS)

Trước khi hash, toàn bộ hệ thống phải tạo cùng một chuỗi byte canonical. v1.2 khóa chuẩn RFC 8785 - JSON Canonicalization Scheme (JCS) làm canonical serializer. RFC 8785 xử lý canonical property ordering, JSON string/number serialization và loại bỏ khác biệt whitespace. Các giá trị nghiệp vụ phải được normalize trước khi đưa vào JCS.

- Timestamp: chuẩn hóa thành ISO-8601 UTC theo một format duy nhất, khuyến nghị YYYY-MM-DDTHH:mm:ss.SSSZ; không trộn timezone local hoặc nhiều độ chính xác.

- Key names và schema: cố định theo schemaVersion; field optional absent và null phải có quy ước rõ, không dùng lẫn lộn.

- Numbers: không truyền số dưới dạng chuỗi nếu schema định nghĩa number; không làm tròn khác nhau giữa module.

- Encoding: canonical JSON được encode UTF-8 trước SHA-256.

- Hash output: lowercase hexadecimal, 64 ký tự.

- Mỗi TraceEvent lưu canonicalizationVersion = RFC8785-JCS-v1 và schemaVersion tương ứng.

- Backend là điểm tạo hash authoritative. Smart Contract/Chaincode và công cụ audit phải sử dụng cùng test vector để kiểm chứng. Frontend không được tự tạo payload/hashing theo JSON.stringify tùy ý; nếu cần verify client-side phải dùng cùng JCS implementation và schema.

```text
domain payload -> validate -> normalize domain values -> RFC 8785 JCS -> UTF-8 bytes -> SHA-256 -> dataHash -> persist full payload off-chain -> submit event+hash via Relayer -> persist transaction receipt
```

## 11.3. Actor evidence và non-repudiation

Mỗi businessPayload do user kích hoạt phải chứa actorContext trước khi băm. actorContext là một phần của hash, vì vậy sửa userId/orgId/role/auth proof sau này sẽ làm hash mismatch.

```text
"actorContext": {
  "userId": "...",
  "organizationId": "...",
  "role": "FARM_STAFF",
  "authProofType": "DIGITAL_SIGNATURE | SIGNED_ASSERTION | TOKEN_FINGERPRINT",
  "actorAuthProof": "..."
}
```

Không đưa raw JWT/access token vào canonical payload. Nếu sử dụng token-based identity, chỉ dùng immutable token identifier/fingerprint hoặc signed assertion đã được xác thực và có thể audit. Relayer wallet chỉ là transaction submitter; TraceEvent vẫn phải mang actor identity nghiệp vụ.

## 11.4. Quy trình xác minh

1. Lấy TraceEvent/full payload off-chain.

1. Đọc schemaVersion + canonicalizationVersion.

1. Domain-normalize theo version.

1. JCS canonicalize, UTF-8, SHA-256.

1. Lấy expected dataHash/proof trên chain.

1. So sánh hash và transaction status.

1. Trả VERIFIED, INTEGRITY_WARNING hoặc BLOCKCHAIN_UNAVAILABLE.

# 12. Kịch bản lỗi và ngoại lệ

| Mã | Tình huống | Mô tả | Kết quả bắt buộc |

| --- | --- | --- | --- |

| EX-01 | Duplicate batch | Tạo batchCode đã tồn tại. | Reject; không tạo Batch mới. |

| EX-02 | Invalid transition | Ví dụ CREATED startTransport hoặc PLANTED receiveRetail. | Backend + smart contract/chaincode reject. |

| EX-03 | Wrong role | RETAILER gọi recordHarvest. | 403/reject; không tạo event. |

| EX-04 | Wrong object ownership | TRANSPORTER đúng role nhưng Shipment của đơn vị khác. | 403/reject. |

| EX-05 | IoT invalid device | deviceId lạ/không gắn Batch. | Reject sensor payload; log lỗi. |

| EX-06 | Blockchain unavailable | Ledger/RPC lỗi khi ghi/xác minh. | Không hiển thị VERIFIED; retry/controlled failure. |

| EX-07 | DB tampering | Payload off-chain bị sửa sau proof. | Hash mismatch -> INTEGRITY_WARNING. |

| EX-08 | Malformed QR | QR không có batchId hợp lệ. | Thông báo QR không hợp lệ; không crash. |

| EX-09 | Unknown batch | batchId không tồn tại. | Hiển thị không tìm thấy lô. |

| EX-10 | Request retry | Client gửi lại command do timeout. | Idempotent; không tạo event trùng. |

| EX-11 | Retail rejected | Retailer kiểm tra lô TRANSPORTED bị hỏng/không đạt. | RETAIL_REJECTED; TRANSPORTED -> REJECTED; terminal. |

| EX-12 | Damaged after harvest | FARM_STAFF phát hiện hỏng/mất mát khi HARVESTED. | DAMAGE_RECORDED; HARVESTED -> DAMAGED; terminal. |

| EX-13 | Damaged in transport | TRANSPORTER phát hiện hỏng/mất mát khi IN_TRANSPORT. | DAMAGE_RECORDED; IN_TRANSPORT -> DAMAGED; terminal. |

| EX-14 | Late sensor payload | Sensor gửi khi Batch đã HARVESTED hoặc state khác PLANTED. | Reject theo BR-07; không ghi raw/event. |

| EX-15 | Sensor finalize failure | Flush queue hoặc final digest/proof thất bại khi recordHarvest. | Không chuyển HARVESTED; giữ/recover transaction và retry idempotent. |

| EX-16 | Duplicate shipment | FARM_STAFF tạo Shipment thứ hai cho cùng Batch. | Reject unique constraint/business rule. |

| EX-17 | Canonicalization mismatch | Một module dùng JSON serialize khác JCS/schema version. | Fail verification/test; không chấp nhận VERIFIED; sửa implementation. |

| EX-18 | Missing actor proof | User event thiếu userId/orgId/role/actorAuthProof. | Reject trước hash/submission. |

| EX-19 | Wrong retailer destination | Retailer khác destination cố receive/reject. | 403/reject. |

| EX-20 | Terminal-state command | Gọi transport/receive/sale sau DAMAGED/REJECTED/CANCELLED/FOR_SALE. | Reject invalid transition. |





# 13. Tiêu chí nghiệm thu nghiệp vụ

| Mã | Tiêu chí |

| --- | --- |

| AC-01 | Happy path chạy end-to-end: CREATED -> PLANTED -> HARVESTED -> IN_TRANSPORT -> TRANSPORTED -> RETAIL_RECEIVED -> FOR_SALE. |

| AC-02 | CARE/SENSOR có thể ghi nhiều lần khi PLANTED mà không phá State Machine. |

| AC-03 | Sai role, organization, ownership bị từ chối. |

| AC-04 | Mọi invalid transition bị backend và lớp chain reject. |

| AC-05 | recordHarvest luôn tạo/commit final SENSOR_RECORDED trước HARVESTED khi có pending sensor. |

| AC-06 | Sensor payload sau HARVESTED bị reject. |

| AC-07 | Chỉ FARM_STAFF tạo Shipment; SYSTEM_ADMIN/TRANSPORTER không tạo được. |

| AC-08 | Một Batch không thể có Shipment thứ hai; Shipment có đúng một retailer đích. |

| AC-09 | HARVESTED -> DAMAGED và IN_TRANSPORT -> DAMAGED hoạt động đúng actor/quyền. |

| AC-10 | TRANSPORTED -> REJECTED hoạt động và REJECTED chặn receive/markForSale. |

| AC-11 | Consumer quét QR mở đúng Batch và xem timeline/trạng thái cuối. |

| AC-12 | Timeline hiển thị actor/organization, thời gian, công đoạn và dữ liệu công khai phù hợp. |

| AC-13 | Mỗi event cốt lõi có dataHash + BlockchainProof truy ngược. |

| AC-14 | Cùng payload + cùng schema/JCS trên các module tạo cùng SHA-256 bằng test vector. |

| AC-15 | Sửa payload off-chain -> INTEGRITY_WARNING. |

| AC-16 | Blockchain unavailable khác hash mismatch. |

| AC-17 | TraceEvent user thiếu actorContext/auth proof bị reject. |

| AC-18 | Public trace không lộ raw token, password, private key hoặc dữ liệu nội bộ. |

| AC-19 | Không có API cập nhật status trực tiếp. |

| AC-20 | Retry command không tạo event/digest/shipment trùng. |





# 14. Phạm vi không thực hiện trong đồ án

- Không xây hệ thống quản trị chuỗi cung ứng quy mô doanh nghiệp/consortium production nhiều tổ chức ngoài phạm vi mẫu.

- Không xây marketplace, thanh toán, token hóa nông sản hoặc ví tiền mã hóa cho người tiêu dùng.

- Không yêu cầu người tiêu dùng cài MetaMask hoặc ký giao dịch để tra cứu.

- Không bắt buộc mobile native; responsive web/PWA đủ cho core.

- Không ghi toàn bộ business data hoặc raw IoT lên Blockchain.

- Không xem IoT thật là điều kiện bắt buộc; simulator là phương án nền tảng.

- Không triển khai QA/chứng nhận chất lượng thành workflow bắt buộc nếu đề bài chưa yêu cầu.

- Không tuyên bố tuân thủ đầy đủ tiêu chuẩn truy xuất quốc tế ngoài các quy tắc kỹ thuật được khóa trong tài liệu.

- Không triển khai Batch Splitting: một Batch không được tách thành nhiều Batch/Shipment con.

- Không triển khai Batch Merging: không hợp nhất nhiều Batch thành Batch mới.

- Không triển khai nhiều Shipment cho cùng một Batch hoặc nhiều Retailer đích cho cùng Shipment. Mô hình v1.2 là 1 Batch : 1 Shipment : 1 Retailer đích.

- Không triển khai quy trình trả hàng/tái vận chuyển/phục hồi sau REJECTED hoặc DAMAGED; đây là terminal state của PoC.

- Không triển khai mô hình mỗi user tự giữ private key Blockchain; v1.2 dùng Backend Custodial Wallet/Relayer.

# 15. Kết luận nghiệp vụ cần khóa trước khi code

Trước khi tách việc cho Blockchain, Backend và Frontend/IoT, cả nhóm phải coi tài liệu v1.2 là baseline duy nhất. Tối thiểu phải khóa các nội dung sau:

1. Role model: FARM_STAFF là actor sản xuất thống nhất và là actor duy nhất tạo Shipment; TRANSPORTER/RETAILER chỉ thao tác đối tượng được gán.

1. State Machine: CREATED -> PLANTED -> HARVESTED -> IN_TRANSPORT -> TRANSPORTED -> RETAIL_RECEIVED -> FOR_SALE; nhánh terminal CANCELLED, DAMAGED, REJECTED.

1. IoT boundary: CARE/SENSOR chỉ ở PLANTED; recordHarvest có Flush & Finalize bắt buộc trước HARVESTED.

1. TraceEvent Catalogue gồm SHIPMENT_CREATED, DAMAGE_RECORDED, RETAIL_REJECTED và actorContext đầy đủ.

1. Business Rules BR-01 đến BR-38 và invalid transition bắt buộc reject.

1. Mô hình dữ liệu 1-1: Batch : Shipment : Retailer đích; không split/merge.

1. Canonical hash contract: domain normalization -> RFC 8785/JCS -> UTF-8 -> SHA-256 lowercase hex; có schemaVersion/canonicalizationVersion và test vectors.

1. Blockchain interaction: Backend Custodial Wallet/Relayer submit giao dịch; actor identity + auth evidence nằm trong payload hash để audit/non-repudiation ở mức nghiệp vụ.

1. Public QR trace phải hiển thị timeline và verification status, không chỉ đọc dữ liệu DB.

## Định nghĩa nghiệp vụ cốt lõi của đồ án

Một lô nông sản được theo dõi bằng chuỗi TraceEvent append-only có actor, organization, thời gian, dữ liệu nghiệp vụ, canonical hash và BlockchainProof. Backend chịu trách nhiệm authorization, command/state machine, idempotency và canonicalization; Blockchain bảo vệ bằng chứng lịch sử; Frontend/IoT chỉ gửi command/payload đúng schema và không tự gán state.

Giá trị của hệ thống không nằm ở QR hay Blockchain đơn thuần mà ở khả năng chứng minh: không nhảy sai quy trình; không actor sai quyền ghi sự kiện; sensor trước thu hoạch không bị bỏ sót; Shipment có chain-of-custody rõ; dữ liệu bị sửa có thể phát hiện; và các trường hợp hỏng/từ chối được phản ánh đúng trạng thái kết thúc.

# Phụ lục A. Điểm bàn giao giữa ba module

| Điểm bàn giao | Nội dung phải thống nhất |

| --- | --- |

| Backend -> Frontend | OpenAPI/DTO, role permissions, allowedCommands theo state, error codes, public trace response, terminal states. |

| Frontend/IoT -> Backend | Form/sensor payload đúng schema; timestamp format; idempotencyKey; không gửi status tự do. |

| IoT -> Backend | device identity, batch binding, sensor schema, buffer semantics, finalize behavior, late-payload response. |

| Backend -> Blockchain | event envelope, canonical payload/dataHash, actorContext, schemaVersion, canonicalizationVersion, command/eventType. |

| Blockchain -> Backend | tx receipt, committed event/state, expected hash/query result, failure status. |

| Backend -> Relayer | Giao dịch đã authorize + dataHash + metadata; relayer không tự quyết định nghiệp vụ. |

| Blockchain -> Frontend | Không gọi trực tiếp; UI nhận proof/verification qua Backend. |





# Phụ lục B. Command/State Matrix phục vụ code

| Command | State trước | Actor | State sau | TraceEvent |

| --- | --- | --- | --- | --- |

| createBatch | - | FARM_STAFF | CREATED | BATCH_CREATED |

| recordPlanting | CREATED | FARM_STAFF | PLANTED | PLANTING_RECORDED |

| recordCare | PLANTED | FARM_STAFF | PLANTED | CARE_RECORDED |

| ingestSensor | PLANTED | IOT_DEVICE | PLANTED | SENSOR_RECORDED theo chu kỳ |

| recordHarvest | PLANTED | FARM_STAFF | HARVESTED | final SENSOR_RECORDED + HARVEST_RECORDED |

| createShipment | HARVESTED | FARM_STAFF | HARVESTED | SHIPMENT_CREATED |

| startTransport | HARVESTED | TRANSPORTER | IN_TRANSPORT | TRANSPORT_STARTED |

| completeTransport | IN_TRANSPORT | TRANSPORTER | TRANSPORTED | TRANSPORT_COMPLETED |

| reportDamaged | HARVESTED | FARM_STAFF | DAMAGED | DAMAGE_RECORDED |

| reportDamaged | IN_TRANSPORT | TRANSPORTER | DAMAGED | DAMAGE_RECORDED |

| receiveRetail | TRANSPORTED | RETAILER | RETAIL_RECEIVED | RETAIL_RECEIVED |

| rejectRetail | TRANSPORTED | RETAILER | REJECTED | RETAIL_REJECTED |

| markForSale | RETAIL_RECEIVED | RETAILER | FOR_SALE | MARKED_FOR_SALE |

| cancel | CREATED/PLANTED | FARM_STAFF | CANCELLED | BATCH_CANCELLED |





# Phụ lục C. Canonical payload mẫu và quy tắc hash

Payload dưới đây là cấu trúc logic tham chiếu; tên field cuối cùng phải khóa trong schema/OpenAPI trước khi code. Thứ tự hiển thị trong tài liệu không phải thứ tự hash; JCS sẽ canonicalize theo RFC 8785.

```text
{
  "schemaVersion": "trace-event-1.2",
  "canonicalizationVersion": "RFC8785-JCS-v1",
  "eventId": "evt-...",
  "batchId": "batch-...",
  "eventType": "HARVEST_RECORDED",
  "eventTime": "2026-08-27T14:00:00.000Z",
  "actorContext": {
    "userId": "user-...",
    "organizationId": "farm-org-...",
    "role": "FARM_STAFF",
    "authProofType": "SIGNED_ASSERTION",
    "actorAuthProof": "proof-or-fingerprint-..."
  },
  "businessData": {
    "harvestTime": "2026-08-27T13:55:00.000Z",
    "quantity": 120.5,
    "unit": "kg",
    "finalSensorDigestId": "sd-..."
  }
}
```

Hash contract: validate schema -> normalize timestamps/domain values -> RFC 8785/JCS -> UTF-8 -> SHA-256 -> lowercase hex. Mọi ngôn ngữ/module phải vượt qua cùng bộ test vectors trước khi tích hợp.
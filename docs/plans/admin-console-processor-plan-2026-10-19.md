# Kế hoạch: trang quản trị nền tảng đầy đủ, nhà chế biến và doanh nghiệp chuỗi

- Ngày lập: 19/10/2026
- Nhánh khảo sát: `feature/enterprise-business-workspace` @ `38287f0`
- Trạng thái: **chờ chủ dự án duyệt**. Chưa sửa code.
- Liên quan: [đề xuất nghiệp vụ](agritrace-business-functions-proposal.md),
  [onboarding doanh nghiệp](enterprise-onboarding.md),
  [quản trị nền tảng P0](platform-governance.md),
  [business rules](../core-business-rules.md).

## 0. Quyết định đã chốt (19/10/2026)

| # | Câu hỏi | Quyết định |
| --- | --- | --- |
| Q1 | Mô hình chế biến | **Biến đổi đầy đủ**: 1..n lô đầu vào → 1..n lô thành phẩm mới, ghi lượng dùng từng lô, hao hụt, cân bằng đầu vào/đầu ra, ghi Fabric |
| Q2 | Ai trả phí | **NSX/HTX và DN chuỗi cung ứng** mua gói. Vận chuyển, chế biến, phân phối, bán lẻ đăng ký miễn phí, chỉ hoạt động khi được mời vào chuỗi |
| Q3 | DN chuỗi cung ứng | **Một tổ chức nhiều năng lực**; admin duyệt từng năng lực có hồ sơ chứng minh |
| Q4 | Thanh toán | **Giữ mô phỏng**; thiết kế sẵn cổng để **tích hợp SePay** ở đợt sau |
| Q5 | Phạm vi admin | **Toàn bộ** 9 nhóm menu, trừ phần cần nghiên cứu thêm (mục 9) |
| Q6 | Báo cáo từ người tiêu dùng | **Có**, form công khai trên trang truy xuất QR |
| Q7 | Ai tạo chuỗi | **NSX/HTX và DN chuỗi** có gói còn hiệu lực và được cấp `CREATE_CHAIN` qua maker-checker |
| Q8 | Hết hạn/vượt hạn mức | **Ân hạn 15 ngày**, sau đó chặn tạo mới; giao nhận đang dở vẫn hoàn tất; trang QR công khai vẫn hiển thị |

## 1. Hiện trạng (đối chiếu source)

- `OrganizationType`: `FARM`, `TRANSPORTER`, `DISTRIBUTOR`, `RETAILER`, `AUDITOR`.
  **Chưa có nhà chế biến.** Năng lực tổ chức lưu ở `OrganizationCapability`
  (một tổ chức đã có thể có nhiều năng lực — nền móng cho DN chuỗi).
- `ScopedRole`: `ORG_ADMIN`, `CREATE_CHAIN`, `CHAIN_MANAGER`, `FARM_STAFF`,
  `TRANSPORTER`, `DISTRIBUTOR`, `RETAILER`, `AUDITOR`, `COMPLIANCE_REVIEWER`.
- `Lot.harvestId` bắt buộc và unique → lô chỉ sinh từ thu hoạch. `parentLotId`/
  `lineageType` có nhưng đề xuất cũ đã chốt **không lách chế biến bằng parentLotId**.
- Gói dịch vụ là hằng số `SERVICE_PLANS` (`TRACE_5/10/20`) trong
  `service-catalog.ts`, tham khảo giá iCheck; một `EnterpriseServiceOrder` cho mỗi
  enrollment, thanh toán mô phỏng, chưa có hóa đơn, gia hạn, hạn mức thực thi.
- `EnterpriseSite.type` đã có `PROCESSING`, `PACKING`, `COLD_STORAGE`.
- `ShipmentPlanParty`: `PRODUCER`, `TRANSPORTER`, `RETAILER` — chưa có chặng
  tới/đi từ nhà chế biến.
- Chaincode `EVENT_TYPES` chưa có sự kiện biến đổi.
- Admin hiện có 14 trang (xem mục 3). Thư mục `admin/farms`, `admin/plots` rỗng.

## 2. Tham khảo bên ngoài và điều rút ra

| Nguồn | Điều rút ra cho AgriTrace |
| --- | --- |
| FDA Food Traceability Rule (FSMA 204) — sự kiện Transformation ([FDA](https://fda.gov/media/145724/download), [foodincanada](https://foodincanada.com/opinions/153204), [ifoodds](https://www.ifoodds.com/?p=7527)) | Bản ghi biến đổi phải có: mã lô mới, mã/mô tả từng lô đầu vào, **lượng dùng của từng lô**, địa điểm và ngày hoàn tất, mô tả + lượng + đơn vị thành phẩm, tài liệu tham chiếu; xuất được dạng bảng sắp xếp được |
| GS1 EPCIS / CTE-KDE ([SG Systems](https://sgsystemsglobal.com/?p=151663), [TrueCommerce](https://www.truecommerce.com/en-gb/blog/fsma-204-kdes-ctes-guide/)) | Mô hình 4 sự kiện then chốt: **tạo – nhận – biến đổi – giao**; đầu vào/đầu ra phải cân khớp. Dùng làm khung mapping sự kiện AgriTrace |
| TE-FOOD ([te-food.com](https://te-food.com/what-makes-te-food-unique/)) | Có module riêng cho nhà máy chế biến: đăng ký bao gói, gán QR cho sản phẩm bán lẻ; web admin + app B2B; có bản Enterprise/Lite → tách gói theo quy mô |
| NHD Trace, TraceFarm, hoptacxa.vn (App Store) | Đối tượng gồm hộ sản xuất, HTX, cơ sở chế biến, phân phối, xuất khẩu; có nhật ký điện tử, báo cáo sự cố, kết nối các bên |
| Dự thảo Thông tư TXNG thực phẩm của Bộ Công Thương 10/2025 ([MOIT](https://moit.gov.vn/du-thao-van-ban/ban-tong-hop-y-kien-tiep-thu-giai-trinh-y-kien-gop-y-doi-voi-du-thao-thong-tu-quy-dinh-ve-truy-xuat-nguon-goc-thuc-pham-.html), [Tạp chí Công Thương](https://tapchicongthuong.vn/bo-cong-thuong-de-xuat-quy-dinh-moi-ve-truy-xuat-nguon-goc-thuc-pham-287164.htm)); NĐ 15/2018 ([TVPL](https://thuvienphapluat.vn/van-ban/the-thao-y-te/Nghi-dinh-15-2018-ND-CP-huong-dan-Luat-an-toan-thuc-pham-341254.aspx)) | Thực phẩm chế biến đang được siết truy xuất. **Văn bản vẫn ở dạng dự thảo**; chưa xác minh được danh mục trường bắt buộc → không ghi là "tuân thủ" |
| Thực hành admin B2B SaaS ([WorkOS](https://workos.com/blog/user-management-for-b2b-saas), [SSOJet](https://ssojet.com/docs/en/branding/manage-tenants)) | Tổ chức (tenant) là đơn vị gắn gói/hạn mức/hóa đơn; thao tác tạo tenant, gán vai là thao tác nhạy cảm cần audit; impersonation phải có lý do, giới hạn thời gian, hiển thị rõ |
| iCheck (đã dùng trong `service-catalog.ts`) | Cấu trúc giá theo số sản phẩm + phí QR theo bậc — giữ và mở rộng |

Giới hạn: phần lớn nguồn về FSMA/EPCIS là blog của nhà cung cấp; chưa đọc được
toàn văn TCVN 12850:2019. Các trường KDE trong kế hoạch là **thiết kế tham khảo**,
không phải cam kết tuân thủ pháp lý.

## 3. So sánh menu admin đề xuất với hiện trạng

Ký hiệu: ✅ có sẵn · 🟡 có một phần, cần mở rộng · ➕ thêm mới · ⚠️ điều chỉnh
ranh giới · ⏸ để sau.

### 3.1. Tổng quan
| Mục đề xuất | Hiện trạng | Kế hoạch |
| --- | --- | --- |
| Dashboard hệ thống | 🟡 `/admin` (admin-summary) | Thêm KPI: DN theo trạng thái/loại, gói sắp hết hạn, hàng chờ duyệt, sự cố mở, outbox/hold, doanh thu tháng (mô phỏng) |
| Hoạt động gần đây | 🟡 có trong audit log | Widget 20 sự kiện mới nhất từ `platform-audit`, lọc theo nhóm |
| Thông báo hệ thống | ➕ | Thông báo bảo trì/tin tức có thời hạn, đối tượng (tất cả/loại tổ chức); banner độc lập với chế độ khóa ghi của controller |

### 3.2. Doanh nghiệp
| Mục | Hiện trạng | Kế hoạch |
| --- | --- | --- |
| Danh sách doanh nghiệp | 🟡 `/admin/organizations` | Hợp nhất thành **Danh bạ tổ chức**: lọc loại/năng lực/trạng thái/gói/tỉnh; trang chi tiết 360° (hồ sơ, năng lực, gói, thành viên, chuỗi, kết nối, sự cố, audit) |
| Duyệt hồ sơ doanh nghiệp | ✅ `/admin/enterprises` + amendments | Thêm: yêu cầu bổ sung hồ sơ (trạng thái `NEEDS_INFO`), checklist theo loại tổ chức, SLA chờ duyệt |
| Vai trò & liên kết doanh nghiệp | 🟡 capabilities, scoped-grants | **Duyệt từng năng lực** (mục 5), xem chuỗi tham gia, liên kết đối tác |
| Trạng thái doanh nghiệp | ➕ | Tạm ngưng / khôi phục / chấm dứt có lý do + maker-checker; tạm ngưng chặn ghi mới, không xóa lịch sử |

### 3.3. Tài khoản & phân quyền
| Mục | Hiện trạng | Kế hoạch |
| --- | --- | --- |
| Quản lý tài khoản | ✅ `/admin/users` | Thêm lọc theo tổ chức, MFA, lần đăng nhập cuối |
| Vai trò & phân quyền | 🟡 | Trang **ma trận vai trò** chỉ đọc (vai nền tảng + mẫu chức trách DN) — admin không sửa quyền nghiệp vụ của DN |
| Quản trị viên hệ thống | 🟡 tạo qua approval | Trang riêng liệt kê vai nền tảng, bắt MFA, tạo/thu hồi qua maker-checker |
| Nhật ký hoạt động | ✅ `/admin/audit-log` | Giữ, thêm bộ lọc theo tổ chức/đối tượng |

### 3.4. Truy xuất nguồn gốc
| Mục | Hiện trạng | Kế hoạch |
| --- | --- | --- |
| Giám sát chuỗi truy xuất | ➕ (DN có `/supply-chains`) | Danh sách chuỗi toàn nền tảng: chủ chuỗi, thành viên, trạng thái, lô/tháng; tạm ngưng chuỗi qua maker-checker |
| Quản lý mã QR | ⚠️ | Admin **chỉ xem** thống kê in/quét, **khóa QR vi phạm** (hiện trang cảnh báo) có lý do + maker-checker; không tạo QR thay DN |
| Tra cứu lô & sản phẩm | 🟡 recall theo lotId | Tra cứu theo mã lô/QR/sản phẩm/tổ chức; hiển thị cây nguồn gốc **cả xuôi và ngược** qua sự kiện biến đổi |
| Báo cáo dữ liệu truy xuất | ➕ | Số lô, sự kiện, % lô có bằng chứng Fabric, xuất CSV theo dạng KDE |

### 3.5. Blockchain (chỉ đọc)
| Mục | Hiện trạng | Kế hoạch |
| --- | --- | --- |
| Tổng quan mạng | 🟡 binding-health, credentials | Peer/orderer/channel/chaincode version, tổ chức MSP, trạng thái |
| Giám sát giao dịch | 🟡 ledger-jobs | Danh sách tx theo chuỗi/tổ chức/loại sự kiện, tra txId |
| Quản lý tổ chức & danh tính | 🟡 enterprise-connections | Xem MSP/chứng thư, hạn chứng thư; duyệt kết nối giữ nguyên |
| Lỗi đồng bộ & ghi dữ liệu | 🟡 outbox/holds | Gom thành một trang có phân loại lỗi; **không có nút phát lại mù** — chỉ dẫn runbook operator |

### 3.6. Dịch vụ & thanh toán
| Mục | Hiện trạng | Kế hoạch |
| --- | --- | --- |
| Danh mục dịch vụ | 🟡 hằng số | Chuyển sang bảng DB có **phiên bản**; đơn cũ giữ snapshot giá |
| Gói dịch vụ & bảng giá | 🟡 TRACE_5/10/20 | Thêm gói DN chuỗi, add-on QR/ thành viên/ chuỗi; admin soạn phiên bản mới, maker-checker khi công bố |
| Đăng ký & hợp đồng | 🟡 service order | Danh sách subscription, hợp đồng, lịch sử đổi gói |
| Hóa đơn & thanh toán | ➕ (mô phỏng) | Hóa đơn nội bộ, trạng thái, đối soát; adapter `PaymentProvider` (`SIMULATION` nay, `SEPAY` sau) |
| Gia hạn & giới hạn sử dụng | ➕ | Theo dõi hạn mức đã dùng/còn lại, nhắc hạn 30/7/1 ngày, ân hạn 15 ngày |

### 3.7. Kiểm duyệt & hỗ trợ
| Mục | Hiện trạng | Kế hoạch |
| --- | --- | --- |
| Hồ sơ chờ xử lý | 🟡 rải rác | **Hộp việc admin hợp nhất**: enrollment, amendment, năng lực, kết nối, approval, báo cáo, ticket — sắp theo SLA |
| Báo cáo vi phạm | ➕ | Form công khai trên trang QR (Q6) → hàng chờ → chuyển thành hồ sơ sự cố |
| Yêu cầu hỗ trợ | ➕ | Ticket từ DN: loại, mức ưu tiên, giao người, trao đổi, đóng |
| Khiếu nại & tranh chấp | ✅ `/admin/cases` | Giữ; thêm loại "tranh chấp giao nhận" giữa hai tổ chức |

### 3.8. Báo cáo & giám sát
| Mục | Hiện trạng | Kế hoạch |
| --- | --- | --- |
| Thống kê nền tảng | ➕ | Tăng trưởng tổ chức, chuỗi, lô, quét QR theo thời gian |
| Báo cáo doanh thu | ➕ | Từ hóa đơn (gắn nhãn **mô phỏng** cho tới khi có SePay) |
| Giám sát API & dịch vụ | 🟡 operations | Health API/Worker/DB/Fabric, độ trễ, tỷ lệ lỗi |
| Cảnh báo bảo mật | ➕ | Đăng nhập thất bại hàng loạt, khóa tài khoản, admin thiếu MFA, đổi quyền nhạy cảm |

### 3.9. Cấu hình hệ thống
| Mục | Hiện trạng | Kế hoạch |
| --- | --- | --- |
| Danh mục dùng chung | 🟡 catalog shared | Đơn vị tính, loại sản phẩm, loại chứng nhận, loại cơ sở, lý do hao hụt |
| Cấu hình thông báo | ➕ | Mẫu email/thông báo, bật/tắt theo sự kiện |
| Cấu hình nền tảng | ⚠️ | Chỉ **tham số nghiệp vụ không nhạy cảm** (ân hạn, SLA, giới hạn upload) có phiên bản + maker-checker. **Không** sửa secret, khóa ký, cấu hình Fabric/controller từ web |
| Sao lưu & khôi phục | ⚠️ | **Chỉ xem** trạng thái receipt sao lưu mới nhất; thao tác sao lưu/khôi phục vẫn qua controller theo production runbook |

### 3.10. Đề xuất bổ sung (không có trong danh sách của bạn)
- **Hộp việc admin hợp nhất** và **trang chi tiết tổ chức 360°** — giúp điều phối nhanh nhất.
- **Quản lý năng lực/giấy phép**: hạn giấy chứng nhận ATTP, HACCP/ISO 22000 của nhà chế biến, cảnh báo sắp hết hạn.
- **Kiểm định viên & phân công** (đã có, giữ trong nhóm Doanh nghiệp).
- **Bảo vệ dữ liệu cá nhân** và **diễn tập thu hồi** (đã có, giữ trong Kiểm duyệt).
- **Xem như người dùng (impersonation)**: ⏸ để sau — rủi ro cao; nếu làm phải chỉ đọc, có lý do, giới hạn thời gian, audit.

### 3.11. Không nên làm
- Admin tạo/sửa vụ, lô, giao nhận, thu hồi **thay** doanh nghiệp.
- Nút sửa hash, xóa journal, phát lại outbox mù, khôi phục DB từ trình duyệt.
- Xóa cứng tổ chức/tài khoản đã có lịch sử — chỉ tạm ngưng/chấm dứt.

## 4. Mô hình tổ chức sau khi thay đổi

| Loại tham gia | Năng lực (`OrganizationType`) | Trả phí | Tạo chuỗi | Ghi chú |
| --- | --- | --- | --- | --- |
| NSX/HTX | `FARM` (đổi nhãn hiển thị "Nhà sản xuất/HTX") | Có | Có | Pháp nhân: DN, HTX, hộ KD, hộ SX |
| Vận chuyển | `TRANSPORTER` | Không | Không | Tham gia khi được mời |
| **Nhà chế biến** | **`PROCESSOR` (mới)** | Không | Không | Phải có cơ sở loại `PROCESSING`/`PACKING` |
| Nhà phân phối | `DISTRIBUTOR` | Không | Không | |
| Nhà bán lẻ | `RETAILER` | Không | Không | |
| **DN chuỗi cung ứng** | Tập con của `FARM`, `PROCESSOR`, `TRANSPORTER`, `DISTRIBUTOR`, `RETAILER` | Có (gói Chuỗi) | Có | Đánh dấu `participationModel = SUPPLY_CHAIN_ENTERPRISE`; mỗi năng lực duyệt riêng |
| Kiểm định | `AUDITOR` | — | Không | Không tự đăng ký; admin tạo |

Quy tắc:
- Đăng ký **không cấp năng lực** (giữ invariant hiện có). Admin duyệt hồ sơ → cấp
  từng năng lực đã chứng minh. Cấp `CREATE_CHAIN` cần gói còn hiệu lực + maker-checker.
- DN chuỗi giao hàng nội bộ giữa các năng lực **vẫn phải ghi sự kiện** (nhận/giao/
  biến đổi) để cây nguồn gốc không bị đứt; có thể ký một bên vì cùng tổ chức.
- Thêm vai `ScopedRole.PROCESSOR_STAFF` và mẫu chức trách: Quản đốc chế biến, QC chế
  biến, Thủ kho nguyên liệu.

## 5. Luồng đăng ký theo vai trò

1. Chọn **mô hình tham gia**: NSX/HTX · Vận chuyển · Chế biến · Phân phối · Bán lẻ · DN chuỗi cung ứng (chọn nhiều năng lực).
2. Khai hồ sơ pháp lý chung (đã có) + **hồ sơ theo năng lực**:
   - NSX/HTX: vùng sản xuất, chứng nhận VietGAP/GlobalGAP (nếu có).
   - Chế biến: cơ sở chế biến, **giấy chứng nhận cơ sở đủ điều kiện ATTP**, HACCP/ISO 22000 (tuỳ chọn), danh mục sản phẩm chế biến.
   - Vận chuyển: phương tiện, khả năng lạnh.
   - Phân phối/Bán lẻ: kho/cửa hàng.
3. Xác minh email OTP (đã có) → nộp hồ sơ.
4. Nếu là NSX/HTX hoặc DN chuỗi: **chọn gói → báo giá → chấp nhận hợp đồng → thanh toán (mô phỏng)**.
   Các loại khác bỏ qua bước này.
5. Admin duyệt hồ sơ (duyệt / yêu cầu bổ sung / từ chối) và duyệt **từng năng lực**.
6. Kích hoạt tổ chức; với bên trả phí, kích hoạt subscription; cấp `CREATE_CHAIN` qua approval.
7. Bên không trả phí ở trạng thái **sẵn sàng tham gia**: chỉ ghi nghiệp vụ khi được chủ chuỗi mời và chấp nhận.

## 6. Nghiệp vụ nhà chế biến (biến đổi đầy đủ)

### 6.1. Luồng
```
NSX/HTX ──giao──▶ Vận chuyển ──giao──▶ NHÀ CHẾ BIẾN
                                        │ nhận + QC nguyên liệu (chấp nhận/cách ly/từ chối)
                                        │ lệnh chế biến (1..n lô đầu vào)
                                        │ hoàn tất → 1..n lô thành phẩm + hao hụt/phụ phẩm
                                        │ đóng gói, in QR thành phẩm
                                        ▼
                         Vận chuyển ──▶ Phân phối ──▶ Bán lẻ ──▶ Người tiêu dùng quét QR
```

### 6.2. Dữ liệu (KDE tham khảo FSMA 204)
**Lệnh chế biến (`ProcessingRun`)**: mã lệnh, chuỗi, nhà chế biến, cơ sở chế biến,
quy trình/công thức (tham chiếu), người phụ trách, thời gian bắt đầu/hoàn tất, trạng thái
`DRAFT → IN_PROGRESS → COMPLETED | CANCELLED`, version.

**Đầu vào (`ProcessingInput`)**: lotId, lượng dùng, đơn vị, holding nguồn tại cơ sở.

**Đầu ra (`ProcessingOutput`)**: lô mới (mã lô mới, sản phẩm thành phẩm, lượng,
đơn vị, quy cách bao gói, NSX/HSD), loại `PRODUCT | BY_PRODUCT`.

**Hao hụt**: lượng + lý do theo danh mục dùng chung.

**Thay đổi `Lot`**: thêm `originType = HARVEST | TRANSFORMATION`, `harvestId`
thành nullable kèm CHECK (`HARVEST` ⇒ có harvestId; `TRANSFORMATION` ⇒ có
processingRunId), `ownerOrgId` cho lô do nhà chế biến tạo (giữ `farmOrgId` cho lô
thu hoạch để không phá lịch sử).

### 6.3. Bất biến
- Chỉ dùng lô **đang được nhà chế biến giữ** tại cơ sở `PROCESSING/PACKING`, đã
  nhận, không bị cách ly/thu hồi; lượng dùng ≤ lượng khả dụng.
- **Cân bằng khối lượng**: Σ đầu vào (quy đổi về đơn vị gốc) = Σ thành phẩm + phụ
  phẩm + hao hụt, sai lệch trong ngưỡng cấu hình (mặc định 0, ngưỡng do sản phẩm
  định nghĩa hệ số quy đổi). Vượt ngưỡng → không cho hoàn tất.
- Trừ lượng đầu vào, tạo lô đầu ra, trace event, outbox và command journal **trong
  cùng một transaction**; idempotency key bắt buộc; optimistic version trên lô đầu vào.
- Lô thành phẩm kế thừa **liên kết** nguồn gốc (không sao chép dữ liệu) → trang QR
  hiển thị toàn bộ lô nguyên liệu và NSX gốc.
- **Thu hồi lan truyền**: thu hồi một lô nguyên liệu → hệ thống liệt kê mọi lô
  thành phẩm phát sinh để chủ thể có quyền quyết định (admin chỉ thấy, không tự thu hồi).
- Lệnh đã hoàn tất không sửa; sai thì tạo **lệnh điều chỉnh** có lý do.
- Chaincode: thêm `TRANSFORMATION_RECORDED` chứa hash đầu vào/đầu ra; Worker ghi Fabric như sự kiện khác.

### 6.4. Ảnh hưởng chặng giao
- `ShipmentPlanParty` thêm `PROCESSOR`; kế hoạch giao hỗ trợ `PRODUCER → PROCESSOR`
  và `PROCESSOR → DISTRIBUTOR/RETAILER`.
- Biên bản bàn giao/ký giữ nguyên cơ chế hiện có.

### 6.5. Màn hình doanh nghiệp chế biến
Nhận nguyên liệu · Kho nguyên liệu · Lệnh chế biến · Lô thành phẩm · Tem QR
thành phẩm · Hồ sơ ATTP/chứng nhận · Báo cáo cân bằng khối lượng.

## 7. Gói dịch vụ và hạn mức

| Gói | Đối tượng | Hạn mức (đề xuất) | Giá năm (VND, tham khảo) |
| --- | --- | --- | --- |
| TRACE_5 / 10 / 20 | NSX/HTX | 5/10/20 sản phẩm, 1/2/3 chuỗi, 10/20/40 thành viên | Giữ như hiện tại: 3,5tr / 5,5tr / 9tr + phí setup 5tr |
| **CHAIN_PRO** (mới) | DN chuỗi cung ứng | 50 sản phẩm, 10 chuỗi, 100 thành viên, mọi năng lực đã duyệt | **Cần bạn chốt giá** (gợi ý 18tr/năm + setup 10tr) |
| Add-on | Cả hai | +QR theo bậc (giữ bậc giá hiện có), +chuỗi, +thành viên | Theo bảng add-on |
| PARTICIPANT | Vận chuyển/chế biến/phân phối/bán lẻ | Miễn phí, không tạo chuỗi, tham gia khi được mời | 0 |

Quy tắc:
- Danh mục và bảng giá lưu DB có **phiên bản**; báo giá/hợp đồng giữ snapshot bất biến (giống `EnterpriseServiceOrder` hiện nay).
- Kiểm tra hạn mức **trong cùng transaction** với lệnh tạo sản phẩm/chuỗi/thành viên/QR.
- Vòng đời subscription: `PENDING_PAYMENT → ACTIVE → GRACE (15 ngày) → RESTRICTED → CANCELLED`.
  `RESTRICTED`: chặn tạo mới; vẫn cho hoàn tất giao nhận đang dở, đọc dữ liệu, QR công khai hiển thị.
- Thanh toán qua interface `PaymentProvider`; nay chỉ `SIMULATION` (local/demo,
  production vẫn cấm như hiện tại). **SePay để đợt sau**: webhook + đối soát nội dung chuyển khoản.
- Admin xác nhận thủ công / hủy / hoàn tiền hóa đơn đều qua maker-checker và audit.

## 8. Báo cáo vi phạm từ người tiêu dùng
- Form trên trang `/trace/...`: loại (hàng giả, sai thông tin, chất lượng, khác), mô tả, ảnh (≤3, giới hạn dung lượng), email/SĐT **tuỳ chọn** kèm đồng ý xử lý dữ liệu.
- Giới hạn tần suất theo IP + QR; không dùng CAPTCHA bên thứ ba ở đợt này (cần chốt nếu muốn).
- Vào hàng chờ admin → phân loại → chuyển thành `PlatformCase` gắn lô → DN phản hồi qua `enterprise-cases` đã có.
- Dữ liệu cá nhân của người báo cáo không hiện cho DN; xử lý theo `PLATFORM_PRIVACY_OFFICER`.

## 9. Phần cần nghiên cứu thêm (không làm đợt này)
- Tích hợp **SePay** thật, hóa đơn điện tử theo quy định thuế.
- Impersonation.
- Hệ số quy đổi phức tạp (công thức nhiều cấp, độ ẩm), chế biến liên tục theo ca.
- Ngành hàng ngoài CROP (chăn nuôi, thủy sản).
- Đối chiếu đầy đủ TCVN 12850:2019 và thông tư TXNG khi ban hành chính thức.

## 10. Thay đổi kỹ thuật chính

| Vùng | Thay đổi |
| --- | --- |
| Prisma/migration | `OrganizationType.PROCESSOR`; `ScopedRole.PROCESSOR_STAFF`; `ShipmentPlanParty.PROCESSOR`; `Organization.participationModel`; `Lot.originType`, `harvestId` nullable + CHECK, `ownerOrgId`; bảng `ProcessingRun/Input/Output/Loss`; `ServicePlan`, `ServicePlanVersion`, `Subscription`, `Invoice`, `PaymentAttempt`, `UsageCounter`; `CapabilityApplication`; `SystemNotice`; `SupportTicket`, `ConsumerReport`; `PlatformSetting` (có version) |
| API | Module `processing`; mở rộng `enterprise-onboarding` (năng lực, gói); module `billing`; mở rộng `platform-governance` (notices, tickets, reports, settings, stats, chain/QR monitor); approval types mới: `ORG_SUSPEND`, `ORG_RESTORE`, `CHAIN_SUSPEND`, `QR_BLOCK`, `PLAN_PUBLISH`, `INVOICE_ADJUST`, `SETTING_CHANGE`, `CAPABILITY_GRANT` mở rộng |
| Chaincode/Worker | Sự kiện `TRANSFORMATION_RECORDED`; binding cho lô không sinh từ thu hoạch |
| Web | Registry menu admin 9 nhóm; trang mới tương ứng; luồng đăng ký chọn mô hình tham gia; workspace nhà chế biến; form báo cáo trên trang trace |
| Quyền | Thêm vai nền tảng `PLATFORM_BILLING` (xem/đối soát hóa đơn) và `PLATFORM_SUPPORT` (ticket, báo cáo) — **cần bạn chốt** |
| Docs | Cập nhật `core-business-rules.md`, `frontend.md`, onboarding plan, OpenAPI sinh lại |

## 11. Chia đợt triển khai (mỗi đợt một PR, có test + evidence)

| Đợt | Nội dung | Phụ thuộc |
| --- | --- | --- |
| P1 | Mô hình tham gia + `PROCESSOR` + duyệt từng năng lực + đăng ký theo vai trò + DN chuỗi | — |
| P2 | Danh mục/gói có phiên bản, subscription, hóa đơn mô phỏng, hạn mức, ân hạn, `PaymentProvider` | P1 |
| P3 | Nghiệp vụ chế biến: lệnh chế biến, cân bằng khối lượng, lô thành phẩm, chặng giao PROCESSOR, chaincode + Worker, QR thành phẩm, thu hồi lan truyền | P1 |
| P4 | Admin: dashboard, hộp việc hợp nhất, tổ chức 360°, trạng thái DN, giám sát chuỗi/QR/tra cứu lô, blockchain chỉ đọc | P1–P3 (từng phần) |
| P5 | Admin: dịch vụ & thanh toán, báo cáo doanh thu, thống kê | P2 |
| P6 | Hỗ trợ: ticket, báo cáo vi phạm công khai, tranh chấp; cảnh báo bảo mật; thông báo hệ thống; danh mục dùng chung; cấu hình nghiệp vụ; trạng thái sao lưu chỉ đọc | P4 |

P2 và P3 có thể làm song song trong hai worktree riêng sau khi P1 merge.

## 12. Acceptance chính
1. Đăng ký "Chế biến" không cần gói; chỉ ghi nghiệp vụ sau khi admin duyệt năng lực và được mời vào chuỗi.
2. Đăng ký NSX/HTX hoặc DN chuỗi bắt buộc qua bước gói; không có gói `ACTIVE` thì không được cấp `CREATE_CHAIN`.
3. DN chuỗi được duyệt 3 năng lực thì chỉ thấy menu/thao tác của 3 năng lực đó.
4. Lệnh chế biến 2 lô đầu vào (60 kg + 40 kg) → thành phẩm 90 kg + hao hụt 10 kg hoàn tất được; nhập 95 kg + hao hụt 10 kg bị từ chối.
5. Quét QR thành phẩm thấy cả 2 lô nguyên liệu và NSX gốc; thu hồi 1 lô nguyên liệu liệt kê được lô thành phẩm liên quan.
6. Gửi lại cùng idempotency key không tạo thêm lô; hai lệnh cùng dùng một lô vượt lượng → một lệnh bị từ chối do version.
7. Sự kiện biến đổi được Worker ghi Fabric và có proof; mock không được coi là nghiệm thu Fabric thật.
8. Gói hết hạn → 15 ngày ân hạn → chặn tạo sản phẩm/QR mới nhưng vẫn hoàn tất giao nhận đang dở; trang QR công khai vẫn mở.
9. Tạm ngưng DN, khóa QR, công bố bảng giá, chỉnh hóa đơn đều cần người thứ hai duyệt và có audit nối băm.
10. Người tiêu dùng gửi báo cáo từ QR → admin chuyển thành hồ sơ sự cố → DN phản hồi; DN không thấy liên hệ của người báo cáo.
11. Không có trang admin nào ghi lô/vụ/giao nhận thay DN, phát lại outbox, hay sửa secret/cấu hình Fabric.

## 13. Câu hỏi còn mở (cần bạn chốt trước khi bắt đầu đợt tương ứng)
1. Giá gói **CHAIN_PRO** và hạn mức chuỗi/thành viên cho từng gói (mục 7).
2. Có thêm 2 vai nền tảng `PLATFORM_BILLING`, `PLATFORM_SUPPORT` không, hay để `SYSTEM_ADMIN` làm hết?
3. Nhà chế biến có bắt buộc nộp giấy chứng nhận ATTP khi đăng ký hay cho nộp bổ sung trong 30 ngày?
4. Ngưỡng sai lệch cân bằng khối lượng: 0% tuyệt đối hay cho phép theo sản phẩm (ví dụ ±2% do độ ẩm)?
5. Đổi nhãn hiển thị `FARM` thành "Nhà sản xuất/HTX" trên toàn giao diện — đồng ý?
6. Xóa hai thư mục rỗng `apps/web/src/app/admin/farms` và `admin/plots`?

## 14. Rủi ro
- `Lot.harvestId` đang là khóa nghiệp vụ quan trọng của trace/hash/binding: đổi
  nullable cần migration mới (không sửa migration cũ) và rà toàn bộ truy vấn/trang QR.
- Chaincode thêm loại sự kiện phải triển khai chaincode mới trên mạng thật — cần
  quy trình release và evidence riêng, không suy ra từ CI.
- Phạm vi lớn (6 đợt); mỗi đợt cần DB cách ly đã migrate để test.

## 15. Kết quả triển khai (19/10/2026, nhánh `feature/admin-console-processor`)

### Phương án đã áp cho câu hỏi mục 13 (chưa được chủ dự án xác nhận riêng)
1. CHAIN_PRO: phí khởi tạo 10.000.000 ₫, duy trì 18.000.000 ₫/12 tháng; hạn mức 50 sản phẩm, 10 chuỗi, 100 thành viên, 200.000 tem QR/kỳ. Gói TRACE giữ giá cũ, thêm hạn mức 1/2/3 chuỗi, 10/20/40 thành viên. Admin đổi được qua bảng giá có phiên bản.
2. Không thêm vai `PLATFORM_BILLING`/`PLATFORM_SUPPORT`; `SYSTEM_ADMIN` xử lý thanh toán, `PLATFORM_CASE_MANAGER` xử lý hỗ trợ và báo cáo vi phạm.
3. Giấy chứng nhận ATTP bắt buộc ngay khi đăng ký năng lực chế biến.
4. Dung sai cân bằng mặc định 0%, chỉnh qua tham số `processing.massBalanceTolerancePercent` (0–10%).
5. Nhãn `FARM` hiển thị "Nhà sản xuất/HTX".
6. Hai thư mục rỗng `admin/farms`, `admin/plots` chưa xóa (cần chủ dự án đồng ý).

### Khác với bản kế hoạch
- Không thêm loại sự kiện chaincode `TRANSFORMATION_RECORDED`: chế biến ghi `DISTRIBUTION_QUANTITY_RECORDED` với `kind` `PROCESSING_INPUT`/`PROCESSING_OUTPUT` để không phải triển khai lại chaincode. Liên kết đầu vào–đầu ra nằm trong payload đã băm.
- Không dùng `ScopedRole.PROCESSOR_STAFF`; quyền chế biến là quyền doanh nghiệp `processing.read`/`processing.write` cùng 3 mẫu vai trò.
- Tạm ngưng/khôi phục tổ chức dùng lệnh `PATCH /organizations/:id` có sẵn (thu hồi phiên, audit), chưa bọc phê duyệt hai bước. Chưa có tạm ngưng chuỗi từ phía admin.
- Điều chỉnh hồ sơ (amendment) chưa cho thêm năng lực chế biến; tổ chức muốn thêm chế biến cần hồ sơ năng lực mới (chưa có luồng).
- Chưa có email nhắc gia hạn tự động (cần Worker); dashboard và trang gói hiển thị gói sắp hết hạn.
- Ma trận vai trò là trang chỉ đọc mô tả tĩnh.

### Sửa sau review độc lập (20/10/2026)
- Lỗi high:
  - Lô thành phẩm đọc được qua `/lots` cho chính tổ chức chế biến.
  - `materials` lọc theo chuỗi và cơ sở được giao cho thành viên.
  - Lượng quy đổi tính theo hệ số của sản phẩm: migration `20261205000000_processing_unit_conversion` và trang `/enterprise/processing/conversions`.
  - Hủy hóa đơn khởi tạo sẽ phát hành hóa đơn thay thế.
- Lỗi medium:
  - Lineage và chi tiết lệnh ẩn tồn kho, trạng thái lô của tổ chức khác.
  - `AUDITOR` không thấy liên hệ người phản ánh.
  - Phiếu cách ly hiện lô thành phẩm cho thành viên được giao cơ sở.
  - Hoàn tất lệnh kiểm tra lại năng lực chế biến và sản phẩm đầu ra.
  - Không đổi gói khi kỳ đã trả còn hiệu lực.
- Giới hạn còn lại: chưa hỗ trợ trả trước để đổi gói giữa kỳ (cần tính chênh lệch hoặc khấu trừ).

### Việc để sau (lỗi mức low từ review)
1. Giới hạn tần suất báo cáo công khai đếm rồi mới ghi, ngoài transaction (`support.service.ts`). Cần khóa theo `sourceHash` hoặc thêm ràng buộc DB.
2. Khóa HMAC của `sourceHash` fallback về `JWT_SECRET` hoặc một hằng số. Cần bắt buộc `CONSUMER_REPORT_SECRET` ở production.
3. Xem trước thu hồi báo `truncated` sai khi đồ thị chế biến có dạng kim cương (`platform-recall.ts`).
4. `catalogDigest` ở `GET /reference-data/service-plans` tính trên mọi gói, trong khi báo giá tính theo nhóm khách hàng, nên hai digest không khớp.
5. Các bảng `trace_qr_block`, `platform_setting`, `subscription`, `consumer_report`, `support_ticket` chưa có trigger guard chuyển trạng thái ở DB.
6. `completeProduct` của sản phẩm chế biến không giới hạn theo cơ sở chế biến của thành viên.

### Kiểm chứng
- Sau khi sửa theo review (20/10):
  - API: typecheck, lint sạch; 5 migration áp sạch trên DB cách ly.
  - Harness 131/131 đạt: chế biến 37, admin 49, đăng ký–gói–kích hoạt 31, hỗ trợ–phê duyệt 14.
  - Web: typecheck, lint sạch; vitest 300/300. Có 1 test timeout khi máy tải nặng, chạy lại riêng thì đạt.
  - Chưa có harness cho thành viên cấp 2/3 bị giới hạn cơ sở (H4) và cho trường hợp thu hồi năng lực giữa chừng (M4).
- API: typecheck, lint sạch; 4 migration áp sạch trên DB trống cách ly; harness HTTP 115/115 đạt (admin 48, chế biến 24, đăng ký–gói–kích hoạt 29, hỗ trợ–phê duyệt hai bước 14).
- Web: typecheck, lint sạch; 300/300 test vitest đạt (chạy bằng config tạm do lỗi parse JSX của vite 8 cục bộ). `lint:contract` chỉ lỗi bài "no invalid peers" có sẵn do `node_modules` cục bộ.
- Chưa chạy: bộ test vitest/e2e API có sẵn, Fabric thật (sự kiện chế biến mới chỉ vào outbox), duyệt giao diện bằng trình duyệt với dữ liệu thật (Docker Desktop không khởi động được engine lúc kiểm tra).

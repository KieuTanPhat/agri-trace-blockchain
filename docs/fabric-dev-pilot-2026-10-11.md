# Pilot Fabric dev cách ly — 11/10/2026

## Phạm vi

Người dùng xác nhận chưa có doanh nghiệp đối tác; dùng Fabric dev trước.
PR [#88](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/88) đã merge
và [Development CD](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/38150410345)
triển khai release `e1261a0203029b89745b6ab8212221fe04170a78` tại
`https://nongtrace.site`. Nền quản lý chủ chuỗi/đối tác từ PR #87 được giữ lại.

Pilot dùng core writer hiện có trên channel dev riêng. Scoped grants hiện chỉ
áp dụng module quản lý chuỗi; dữ liệu core chưa được gắn vào chuỗi mới.
Hai org Fabric do operator quản lý, chưa kiểm authority của doanh nghiệp tự
quản peer/CA hoặc chữ ký độc lập. Pilot không thay gate A/B/C của
[kế hoạch Hybrid](plans/hybrid-fabric-chain-owner-plan-2026-10-11.md).

## Runtime được kiểm

| Thành phần | Binding dev |
| --- | --- |
| Network / channel | `agritrace-dev-fabric` / `agritrace-dev` |
| Chaincode | `agritrace`, sequence 1, package từ `c07f625` |
| Peers / ordering | Hai peer Org1MSP/Org2MSP; một Raft orderer trên VPS |
| CA / identity | Ba CA và relayer riêng; secret/keys root-private |
| Ledger | Ba named volumes riêng, giữ nguyên khi tắt/bật |
| Public app | API/Web qua ingress dev; API không có signer mount |
| Host ports | Chỉ loopback; endpoint admin dùng DNS SAN `localhost` |
| Tài nguyên | Peer/chaincode 512 MiB, CA 128 MiB, orderer 256 MiB |

Binaries Fabric 2.5.16/CA 1.5.22 được kiểm SHA-256; samples pin
`5789681b4f4d24e58fa40f19a69f5496892374b6`. Công cụ provision không gọi
`test-network/network.sh` hoặc cleanup toàn host. Peer/orderer có explicit
parent mounts để không tạo volume ẩn ngoài danh mục backup. Single orderer
trên một host chưa kiểm availability khi mất host/orderer.

## Các lỗi đã phát hiện và sửa

- Generator cổng/hostname, helper orderer động và endpoint IP lệch TLS SAN:
  sửa bằng hostname dev, cổng loopback và `localhost`; giữ CA/MSP/ledger,
  cấp lại TLS orderer đúng hostname.
- Docker image tạo anonymous volumes: quản lý explicit mounts, giữ named
  ledger và chuyển dữ liệu của riêng dev sang owned binds.
- Một chẩn đoán operator in nhầm enrollment secrets của identity test:
  đã đổi 14 secrets, không xuất private key; các chẩn đoán sau che credentials.
- Canary có thể confirm trước aggregate khác: verifier đợi backlog trước
  snapshot/query proof, tối đa 180 giây/10.000 events; dead-letter hoặc hết
  thời gian vẫn chặn release.
- QR so receipt với default channel sau Fabric-off: controller truyền
  `FABRIC_CHANNEL_NAME` từ binding vào API bằng `ledger-context.json` cả ở
  light mode. Overlay chỉ có metadata đọc, không cấp signer.
- Linux regression phát hiện recovery fixture thiếu channel: bổ sung fixture
  hợp lệ; không bỏ kiểm binding hoặc đổi dữ liệu để vượt gate.
- Docker inspect phát hiện `NanoCpus`, `CpuQuota`, `CpuPeriod` của chaincode
  đều bằng 0. [Fabric 2.5.16](https://github.com/hyperledger/fabric/blob/v2.5.16/internal/peer/node/start.go#L1198)
  chỉ đọc CpuQuota/CpuPeriod cho CPU. Đã giới hạn ngay hai container riêng của
  dev bằng quota/period 100000/100000; sửa generator và policy để container
  được tạo lại vẫn có limit. Peer recreate đã kiểm container mới có CPU
  quota/period 100000/100000 và RAM 512 MiB, giữ nguyên khóa và cả mười dòng
  receipt đầy đủ so với PostgreSQL snapshot trước sửa.

Lần provision đầu cần operator reconcile các lỗi trên; chưa ghi nhận một lượt
fresh provision tự động từ đầu đến cuối sau tất cả bản sửa. CA/identity/ledger
đang có được giữ để tiếp tục kiểm, không reset và anchor lại lịch sử.

## Bằng chứng đã đạt

98 Linux CD tests và 11 verifier tests đạt ở head
`4627850e8c9df4d4e25a1b573892f6e8a0e3f5e3`. Application CI, Blockchain CI và
Dependency Audit đạt ở cả head và merge SHA. Push CI kiểm API/Web trên Node
22/24/26, core E2E, container isolation và Worker/Fabric integration.

Sau delivery light mode, bật Fabric đã kiểm 9/9 events bằng direct ledger
query, proof/hash/channel và entity history. Backlog bằng 0; public QR đạt.
Tắt Fabric giữ cả chín receipt; API tiếp tục hoạt động, command mới tạo event
thứ mười ở Pending và chưa có proof. Browser kiểm QR cũ vẫn hiện timeline đã
xác minh và receipt đúng khi Fabric tắt.

Resume đã đạt 10/10 proof, không Pending; cả chín receipt cũ và fingerprint
identity keys giữ nguyên. Rollback hai chiều `e1261a0 → c07f625 → e1261a0`
với Fabric bật giữ nguyên 10 event/proof fingerprints, năm bảng quản lý và
sequence 1. Lượt đầu fail gate roles trước mutation khi chạy probe auth dồn;
giảm probe dư, không nới throttle, rồi chạy lại đạt.

Đối chiếu production giữ 118 event/proof fingerprints, state và helper bytes;
15 container ngoài dev giữ IDs/start times/restart counts. Dev health đạt,
không OOM, khoảng 5,5 GiB RAM host còn khả dụng tại lượt kiểm. Các con số này
là kiểm chứng tại thời điểm chạy, không thay load/HA/restore gates.

PR [#90](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/90) đưa CPU
fix và báo cáo vào source; release cuối sau PR này còn chờ CI/CD. Chưa ghi
nhận đủ 24 giờ quan sát hoặc hoàn tất toàn bộ kiến trúc.

Evidence root-only tại `/opt/agri-trace-dev/cd/hybrid-fabric-dev-20261011.json`;
snapshot nhất quán DB/config/ledger được mã hóa CMS trong thư mục backups dev.
Không đưa accounts, CA enrollment secrets hoặc private key vào báo cáo.

## Công việc còn lại

StageAssignment/ShipmentPlan, scope trên core read/write/replay và backfill
manifest còn thiếu. Sau bản A mới mở protocol/binding/ledger registry/router
của B và chữ ký/handover của C theo các dependency trong plan. Self-managed
partner cần doanh nghiệp thật giữ quyền quản trị và khóa của họ.

Lịch tiếp tục trong task này mỗi 30 phút đã bật để kiểm lỗi, ghi evidence và
tiếp tục các gói còn thiếu. Thời gian quan sát tối thiểu 24 giờ tính cho
candidate cuối; đổi release hoặc có lỗi sẽ không được tính là một cửa sổ đã
đạt. Scheduled checks cần máy và app đang chạy; gián đoạn phải được ghi nhận.

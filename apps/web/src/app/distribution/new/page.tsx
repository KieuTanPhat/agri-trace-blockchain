"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  useWorkspaceData,
  useWorkspaceCommand,
  textValue,
  type Row,
  type Overview,
} from "@/lib/workspace";
import { CommandState, LoadState, PageHeader } from "@/components/manage";
export default function NewTransferPage() {
  const router = useRouter();
  const report = useWorkspaceData<{ lots: Row[] }>("/distribution/reports");
  const partners = useWorkspaceData<{ items: Row[] }>(
    "/enterprise-workspace/partners",
  );
  const overview = useWorkspaceData<Overview>("/enterprise-workspace");
  const sites = useWorkspaceData<{ items: Row[]; vehicles: Row[] }>(
    "/distribution/options",
  );
  const cmd = useWorkspaceCommand();
  const [lineIds, setLineIds] = useState([0]),
    [selectedChain, setSelectedChain] = useState(""),
    [receiver, setReceiver] = useState(""),
    [carrier, setCarrier] = useState("");
  const orgs =
    partners.data?.items
      .filter((p) => p.status === "ACTIVE")
      .map(
        (p) =>
          (p.inviterId === overview.data?.organization.id
            ? p.invitee
            : p.inviter) as Row,
      ) ?? [];
  const chains = [
    ...new Set(report.data?.lots.map((l) => String(l.chainId)) ?? []),
  ];
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const lines = lineIds.map((i) => {
      const lot = report.data?.lots.find(
        (l) => l.lotId === data.get(`lot-${i}`),
      );
      return {
        lotId: data.get(`lot-${i}`),
        quantity: data.get(`quantity-${i}`),
        unit: lot?.unit,
      };
    });
    if (
      await cmd.run("/distribution/transfers", {
        chainId: data.get("chainId"),
        receiverId: data.get("receiverId"),
        carrierId: data.get("carrierId"),
        senderSiteId: data.get("senderSiteId") || undefined,
        carrierSiteId: data.get("carrierSiteId") || undefined,
        receiverSiteId: data.get("receiverSiteId") || undefined,
        vehicleId: data.get("vehicleId") || undefined,
        origin: data.get("origin"),
        destination: data.get("destination"),
        plannedPickupAt: new Date(String(data.get("plannedPickupAt"))).toISOString(),
        plannedDeliveryAt: data.get("plannedDeliveryAt")
          ? new Date(String(data.get("plannedDeliveryAt"))).toISOString()
          : undefined,
        note: data.get("note") || undefined,
        lines,
      })
    )
      router.push("/distribution");
  }
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        backLabel="Quay lại danh sách"
        title="Tạo giao nhận"
        description="Chọn lượng giao từ một hoặc nhiều lô cùng chuỗi. Lô nguồn và đơn vị luôn được giữ nguyên."
        back="/distribution"
      />
      <LoadState {...report} />
      <form className="panel workspace-form" onSubmit={submit}>
        <CommandState command={cmd} />
        <fieldset
          disabled={cmd.pending || cmd.frozen}
          className="enterprise-fields"
        >
          <h3 className="form-section-title">
            Thông tin đối tác &amp; kho
            <small>Chọn các đơn vị tham gia trong chuỗi và cơ sở liên quan.</small>
          </h3>
          <label>
            Chuỗi cung ứng
            <select
              className="input"
              name="chainId"
              required
              value={selectedChain}
              onChange={(e) => setSelectedChain(e.target.value)}
            >
              <option value="">Chọn chuỗi</option>
              {chains.map((c) => (
                <option key={c} value={c}>
                  {String(
                    report.data?.lots.find((l) => l.chainId === c)?.chainName ??
                      `Chuỗi ${c.slice(0, 8)}`,
                  )}
                </option>
              ))}
            </select>
          </label>
          {[
            ["receiverId", "Doanh nghiệp nhận"],
            ["carrierId", "Doanh nghiệp vận chuyển"],
          ].map(([name, label]) => (
            <label key={name}>
              {label}
              <select
                className="input"
                name={name}
                required
                onChange={(e) =>
                  name === "receiverId"
                    ? setReceiver(e.target.value)
                    : setCarrier(e.target.value)
                }
              >
                <option value="">Chọn đối tác đã liên kết</option>
                {orgs.map((o) => (
                  <option key={String(o.id)} value={String(o.id)}>
                    {textValue(o.name)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {[
            ["senderSiteId", "Cơ sở giao hàng", overview.data?.organization.id],
            ["carrierSiteId", "Cơ sở điều phối vận chuyển", carrier],
            ["receiverSiteId", "Cơ sở nhận hàng", receiver],
          ].map(([name, label, org]) => (
            <label key={name}>
              {label}
              <select className="input" name={name} required>
                <option value="">Chọn cơ sở của doanh nghiệp</option>
                {sites.data?.items
                  .filter((s) => s.organizationId === org)
                  .map((s) => (
                    <option value={String(s.id)} key={String(s.id)}>
                      {textValue(s.name)}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <label>
            Phương tiện vận chuyển (nếu có)
            <select className="input" name="vehicleId">
              <option value="">Chọn phương tiện của bên vận chuyển</option>
              {sites.data?.vehicles
                .filter((v) => v.organizationId === carrier)
                .map((v) => (
                  <option key={String(v.id)} value={String(v.id)}>
                    {textValue(v.registration)} · {textValue(v.kind)}
                  </option>
                ))}
            </select>
          </label>
          <h3 className="form-section-title">
            Thời gian &amp; địa điểm
            <small>Địa điểm giao nhận và thời gian dự kiến.</small>
          </h3>
          <label>
            Điểm giao
            <input className="input" name="origin" required minLength={3} />
          </label>
          <label>
            Điểm nhận
            <input
              className="input"
              name="destination"
              required
              minLength={3}
            />
          </label>
          <label>Ngày giờ dự kiến lấy hàng
            <input className="input" name="plannedPickupAt" type="datetime-local" required />
          </label>
          <label>Ngày giờ dự kiến giao hàng (nếu có)
            <input className="input" name="plannedDeliveryAt" type="datetime-local" />
          </label>
          <label>Ghi chú giao nhận
            <textarea className="input" name="note" maxLength={1000} />
          </label>
          <h3 className="form-section-title">
            Lô nguồn và số lượng
            <small>Lượng hàng được giữ chỗ khi tạo giao nhận.</small>
          </h3>
          <div className="transfer-lines">
            {lineIds.map((i, index) => (
              <div className="transfer-line" key={i}>
                <label>
                  Lô nguồn {index + 1}
                  <select className="input" name={`lot-${i}`} required>
                    <option value="">Chọn lô</option>
                    {report.data?.lots
                      .filter(
                        (l) =>
                          l.chainId === selectedChain &&
                          Number(l.available) > 0,
                      )
                      .map((l) => (
                        <option key={String(l.lotId)} value={String(l.lotId)}>
                          {textValue(l.lotCode)} · còn {textValue(l.available)}{" "}
                          {textValue(l.unit)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Số lượng
                  <input
                    className="input"
                    name={`quantity-${i}`}
                    required
                    inputMode="decimal"
                    pattern="[0-9]+(\.[0-9]{1,3})?"
                  />
                </label>
                {lineIds.length > 1 && (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setLineIds((v) => v.filter((x) => x !== i))}
                  >
                    Bỏ dòng
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="text-link"
            disabled={lineIds.length >= 30}
            onClick={() => setLineIds((v) => [...v, Math.max(...v) + 1])}
          >
            + Thêm lô nguồn
          </button>
        </fieldset>
        <p className="notice">
          Lượng hàng được dành khi tạo giao nhận. Các bên phải đồng thuận và ký
          hai phía ở từng bước lấy / nhận hàng.
        </p>
        <button className="button" disabled={cmd.pending} type="submit">
          {cmd.pending
            ? "Đang tạo…"
            : cmd.frozen
              ? "Thử lại yêu cầu cũ"
              : "Tạo giao nhận"}
        </button>
      </form>
    </div>
  );
}

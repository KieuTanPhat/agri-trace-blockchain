"use client";

import { useState } from "react";
import { z } from "zod";
import { Plus } from "lucide-react";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { iotApi, type Device } from "@/lib/ledger/iot-api";
import { fmtAgo, fmtDateTime } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { ChoiceField, SelectField, TextField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ledger/ui/sheet";
import { DeviceDetail } from "@/components/ledger/workspace/device-detail";

const SPKI = /^[A-Za-z0-9_-]{59}$/;
const CODE = /^[A-Za-z0-9._:-]{3,120}$/;
const KIND_LABEL: Record<string, string> = { FIELD_SENSOR: "Cảm biến vùng trồng", GPS_TRACKER: "GPS trên xe" };

// RegisterDeviceInput (apps/api/src/modules/iot/device-dto.ts)
const registerSchema = z
  .object({
    kind: z.enum(["FIELD_SENSOR", "GPS_TRACKER"]),
    deviceCode: z.string().trim().regex(CODE, { error: () => tr("3–120 ký tự: chữ, số, . _ : -") }),
    name: z.string().trim().min(1).max(255),
    publicKey: z.string().trim().regex(SPKI, { error: () => tr("Khóa công khai Ed25519 dạng base64url (59 ký tự)") }),
    simulated: z.enum(["yes", "no"]),
    plotId: z.string().optional(),
    vehicleId: z.string().optional(),
  })
  .refine((v) => (v.kind === "FIELD_SENSOR" ? !!v.plotId : !!v.vehicleId), { path: ["kind"], error: () => tr("Chọn thửa hoặc xe để gắn thiết bị") });
const bindSchema = z.object({ target: z.string().optional() });
const keySchema = z.object({ publicKey: z.string().trim().regex(SPKI, { error: () => tr("Khóa công khai Ed25519 dạng base64url (59 ký tự)") }) });
const emptySchema = z.object({});

export default function DevicesPage() {
  const { can } = useWorkspaceAccess();
  const devices = useQuery({ queryKey: ["iot-devices"], queryFn: iotApi.devices, enabled: can("devices.read"), refetchInterval: 30_000 });
  const options = useQuery({ queryKey: ["iot-device-options"], queryFn: iotApi.options, enabled: can("devices.read") });
  const add = useDialog();
  const bind = useDialog<Device>();
  const rotate = useDialog<Device>();
  const toggle = useDialog<Device>();
  const plots = (options.data?.plots ?? []).map((p) => ({ value: p.id, label: `${p.farm.name} · ${p.name}` }));
  const vehicles = (options.data?.vehicles ?? []).map((v) => ({ value: v.id, label: `${v.registration} · ${v.kind}` }));
  const manage = can("devices.manage");
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = devices.data?.find((d) => d.id === openId) ?? null;

  const cols: Column<Device>[] = [
    {
      key: "device",
      header: tr("Thiết bị"),
      sort: (d) => d.name,
      cell: (d) => (
        <button type="button" onClick={() => setOpenId(d.id)} className="flex flex-col text-left hover:underline">
          <span className="font-medium">{d.name}</span>
          <span className="font-mono text-[11.5px] text-ink-2">{d.deviceCode}</span>
        </button>
      ),
    },
    { key: "kind", header: tr("Loại"), cell: (d) => <span className="text-[12px]">{tr(KIND_LABEL[d.type] ?? d.type)}</span> },
    {
      key: "asset",
      header: tr("Gắn vào"),
      cell: (d) =>
        d.plot ? (
          <span className="flex flex-col text-[12.5px]">
            <span>{d.plot.farm.name} · {d.plot.name}</span>
            <span className="text-ink-2">{d.runningCycles.length ? tr("Vụ đang chạy: {p0}", { p0: d.runningCycles.map((c) => c.cycleCode).join(", ") }) : tr("Chưa có vụ đang chạy")}</span>
          </span>
        ) : d.vehicle ? (
          <span className="flex flex-col text-[12.5px]">
            <span className="font-mono">{d.vehicle.registration}</span>
            <span className="text-ink-2">{d.activeTransfer ? `${d.activeTransfer.origin} → ${d.activeTransfer.destination}` : tr("Không có phiếu đang chạy")}</span>
          </span>
        ) : (
          <span className="text-ink-2">{tr("Chưa gắn")}</span>
        ),
    },
    {
      key: "seen",
      header: tr("Tín hiệu"),
      hideBelow: "md",
      cell: (d) => (
        <span className="flex flex-col gap-1">
          <Badge tone={d.online ? "ok" : "neutral"}>{d.online ? tr("Đang gửi") : tr("Mất kết nối")}</Badge>
          <span className="text-[11.5px] text-ink-2" title={fmtDateTime(d.lastSeenAt)}>{d.lastSeenAt ? fmtAgo(d.lastSeenAt) : tr("Chưa gửi dữ liệu")}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: tr("Trạng thái"),
      cell: (d) => (
        <span className="flex flex-wrap gap-1">
          <Badge tone={d.status === "ACTIVE" ? "ok" : "neutral"}>{d.status === "ACTIVE" ? tr("Hoạt động") : tr("Ngừng")}</Badge>
          {d.simulated && <Badge tone="warn">{tr("Mô phỏng")}</Badge>}
        </span>
      ),
    },
    {
      key: "act",
      header: <span className="sr-only">{tr("Thao tác")}</span>,
      cell: (d) => (
          <span className="flex flex-wrap gap-1">
            <Button size="xs" variant="outline" onClick={() => setOpenId(d.id)}>{tr("Chi tiết")}</Button>
            {manage && <>
            <Button size="xs" variant="outline" onClick={() => bind.open(d)}>{tr("Gắn")}</Button>
            <Button size="xs" variant="outline" onClick={() => rotate.open(d)}>{tr("Đổi khóa")}</Button>
            <Button size="xs" variant="outline" onClick={() => toggle.open(d)}>{d.status === "ACTIVE" ? tr("Ngừng") : tr("Kích hoạt")}</Button>
            </>}
          </span>
      ),
    },
  ];

  if (!can("devices.read")) return <ErrorState error={new Error(tr("Bạn chưa có quyền xem thiết bị IoT"))} />;
  return (
    <>
      <PageHeader
        title={tr("Thiết bị IoT")}
        description={tr("Cảm biến gắn vào thửa tự ghi dữ liệu cho vụ đang trồng trên thửa đó. GPS gắn vào xe tự ghi vị trí cho phiếu giao nhận đang dùng xe, chỉ trong lúc đang vận chuyển. IoT không bắt buộc và không chặn nghiệp vụ.")}
        actions={manage && <Button size="sm" onClick={() => add.open(true)}><Plus /> {tr("Đăng ký thiết bị")}</Button>}
      />
      <PageBody className="min-w-0">
        <Callout tone="info">{tr("Thiết bị tự giữ khóa riêng và ký từng gói dữ liệu. Khi đăng ký chỉ nhập mã thiết bị và khóa công khai hiển thị trên thiết bị (hoặc trên bảng điều khiển thiết bị ảo).")}</Callout>
        <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-line bg-card">
          <DataTable rows={devices.data} loading={devices.isLoading} error={devices.error} onRetry={() => devices.refetch()} columns={cols} rowKey={(d) => d.id} empty={<EmptyState title={tr("Chưa có thiết bị")} />} minWidth={760} />
        </div>
      </PageBody>

      <Sheet open={!!opened} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{opened?.name}</SheetTitle>
            <SheetDescription>{opened ? tr(KIND_LABEL[opened.type] ?? opened.type) : ""}</SheetDescription>
          </SheetHeader>
          {opened && <DeviceDetail id={opened.id} />}
        </SheetContent>
      </Sheet>

      {manage && (
        <CommandDialog
          {...add.props}
          title={tr("Đăng ký thiết bị")}
          endpoint="POST /iot/v2/devices"
          description={tr("Gắn thửa cần quyền ghi sản xuất; gắn xe cần quyền quản lý phương tiện. Mỗi xe chỉ có một GPS đang hoạt động.")}
          schema={registerSchema}
          defaultValues={{ kind: "FIELD_SENSOR", deviceCode: "", name: "", publicKey: "", simulated: "yes", plotId: "", vehicleId: "" }}
          submitLabel={tr("Đăng ký")}
          invalidate={[["iot-devices"]]}
          wide
          run={(v, cmd) =>
            iotApi.register(
              {
                kind: v.kind,
                deviceCode: v.deviceCode,
                name: v.name,
                publicKey: v.publicKey,
                simulated: v.simulated === "yes",
                ...(v.kind === "FIELD_SENSOR" ? { plotId: v.plotId } : { vehicleId: v.vehicleId }),
              },
              cmd,
            )
          }
        >
          {(f) => {
            const kind = f.watch("kind");
            return (
              <>
                <ChoiceField control={f.control} name="kind" label={tr("Loại thiết bị")} options={[{ value: "FIELD_SENSOR", label: tr("Cảm biến vùng trồng"), help: tr("Nhiệt độ, độ ẩm, độ ẩm đất") }, { value: "GPS_TRACKER", label: tr("GPS trên xe"), help: tr("Chỉ ghi vị trí") }]} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField control={f.control} name="deviceCode" label={tr("Mã thiết bị (IMEI/serial)")} max={120} />
                  <TextField control={f.control} name="name" label={tr("Tên gợi nhớ")} max={255} />
                </div>
                <TextField control={f.control} name="publicKey" label={tr("Khóa công khai của thiết bị")} hint={tr("Ed25519 SPKI base64url, 59 ký tự")} />
                {kind === "FIELD_SENSOR" ? (
                  <SelectField control={f.control} name="plotId" label={tr("Thửa")} options={plots} hint={plots.length ? undefined : tr("Doanh nghiệp chưa có thửa đang hoạt động. Tạo thửa ở Quản lý vùng sản xuất.")} />
                ) : (
                  <SelectField control={f.control} name="vehicleId" label={tr("Xe")} options={vehicles} hint={vehicles.length ? undefined : tr("Doanh nghiệp chưa khai xe nào đang hoạt động. Thêm xe ở Tài nguyên → Phương tiện.")} />
                )}
                <ChoiceField control={f.control} name="simulated" label={tr("Nguồn thiết bị")} options={[{ value: "yes", label: tr("Thiết bị ảo (mô phỏng)"), help: tr("Dữ liệu luôn hiện nhãn mô phỏng, kể cả trên QR") }, { value: "no", label: tr("Thiết bị thật") }]} />
              </>
            );
          }}
        </CommandDialog>
      )}

      {bind.target && (
        <CommandDialog
          {...bind.props}
          title={tr("Gắn thiết bị {p0}", { p0: bind.target.name })}
          endpoint={`POST /iot/v2/devices/${bind.target.id}/binding`}
          description={bind.target.type === "GPS_TRACKER" ? tr("Không tháo GPS khỏi xe khi xe đang chở hàng.") : tr("Dữ liệu chỉ vào vụ đang trồng trên thửa được chọn.")}
          schema={bindSchema}
          defaultValues={{ target: (bind.target.plotId ?? bind.target.vehicleId) ?? "" }}
          version={bind.target.authorityRevision}
          submitLabel={tr("Lưu")}
          invalidate={[["iot-devices"]]}
          run={(v, cmd) => {
            const d = bind.target!;
            const target = v.target || null;
            return iotApi.bind(d.id, { version: d.authorityRevision, ...(d.type === "FIELD_SENSOR" ? { plotId: target } : { vehicleId: target }) } as never, cmd);
          }}
        >
          {(f) => (
            <SelectField control={f.control} name="target" label={bind.target!.type === "FIELD_SENSOR" ? tr("Thửa (để trống để tháo)") : tr("Xe (để trống để tháo)")} options={[{ value: "", label: tr("— Tháo khỏi tài sản —") }, ...(bind.target!.type === "FIELD_SENSOR" ? plots : vehicles)]} />
          )}
        </CommandDialog>
      )}

      {rotate.target && (
        <CommandDialog
          {...rotate.props}
          title={tr("Đổi khóa thiết bị {p0}", { p0: rotate.target.name })}
          endpoint={`POST /iot/v2/devices/${rotate.target.id}/key`}
          description={tr("Sau khi đổi, gói ký bằng khóa cũ bị từ chối. Dùng khi thiết bị bị thay hoặc lộ khóa.")}
          schema={keySchema}
          defaultValues={{ publicKey: "" }}
          version={rotate.target.authorityRevision}
          submitLabel={tr("Đổi khóa")}
          tone="danger"
          invalidate={[["iot-devices"]]}
          run={(v, cmd) => iotApi.rotateKey(rotate.target!.id, { version: rotate.target!.authorityRevision, publicKey: v.publicKey }, cmd)}
        >
          {(f) => <TextField control={f.control} name="publicKey" label={tr("Khóa công khai mới")} />}
        </CommandDialog>
      )}

      {toggle.target && (
        <CommandDialog
          {...toggle.props}
          title={toggle.target.status === "ACTIVE" ? tr("Ngừng thiết bị") : tr("Kích hoạt thiết bị")}
          endpoint={`POST /iot/v2/devices/${toggle.target.id}/status`}
          description={toggle.target.status === "ACTIVE" ? tr("Thiết bị ngừng thì mọi gói dữ liệu mới bị từ chối.") : undefined}
          schema={emptySchema}
          defaultValues={{}}
          version={toggle.target.authorityRevision}
          submitLabel={tr("Xác nhận")}
          tone={toggle.target.status === "ACTIVE" ? "danger" : "default"}
          invalidate={[["iot-devices"]]}
          run={(_, cmd) => iotApi.setStatus(toggle.target!.id, { version: toggle.target!.authorityRevision, status: toggle.target!.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }, cmd)}
        >
          {() => null}
        </CommandDialog>
      )}
    </>
  );
}

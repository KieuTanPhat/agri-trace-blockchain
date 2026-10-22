"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { getLots } from "@/lib/api-client";
import type { LotTrace } from "@/lib/types";
import { CommandState, InfoDialog, LoadState, StatusBadge } from "@/components/manage";
import {
  textValue,
  useWorkspaceCommand,
  useWorkspaceData,
  type Catalog,
  type EnterpriseMember,
  type EnterpriseRevision,
  type EnterpriseSite,
  type Items,
  type Overview,
  type TraceEvidence,
} from "@/lib/workspace";
import { Lightbox, useEvidenceThumbs } from "./image-gallery";

type Values = Record<string, unknown>;

/** Product fields in display order, with how the API names them. */
export const productFieldLabels: [string, string][] = [
  ["sku", "Mã sản phẩm"],
  ["productName", "Tên sản phẩm"],
  ["category", "Danh mục"],
  ["variety", "Giống / phân loại"],
  ["originFarmId", "Vùng xuất xứ"],
  ["defaultUnit", "Đơn vị tính"],
  ["price", "Giá"],
  ["gtin", "GTIN"],
  ["description", "Mô tả"],
  ["storageConditions", "Điều kiện bảo quản"],
  ["ingredients", "Thành phần"],
  ["usageInstructions", "Hướng dẫn sử dụng"],
  ["rawMaterials", "Nguyên liệu"],
  ["manufacturingSiteId", "Nhà xưởng sản xuất"],
  ["exporter", "Nhà xuất khẩu"],
  ["importer", "Nhà nhập khẩu"],
  ["distributor", "Nhà phân phối"],
  ["carrier", "Nhà vận chuyển"],
  ["managerUserId", "Người quản lí"],
];
const statusLabel: Record<string, string> = { ACTIVE: "Đang bán", INACTIVE: "Ngừng bán" };

/** Body of a product revision built from the stored row, so a status change
 * resends the current fields unchanged. */
function productBody(row: Values) {
  const body: Values = {};
  for (const [name] of productFieldLabels) {
    const value = row[name];
    if (value === null || value === undefined || value === "") continue;
    body[name] = name === "price" ? Number(value) : value;
  }
  return body;
}

function useNames() {
  const catalog = useWorkspaceData<Catalog>("/catalog");
  const sites = useWorkspaceData<Items<EnterpriseSite>>("/enterprise-workspace/sites");
  const members = useWorkspaceData<Items<EnterpriseMember>>("/enterprise-workspace/members");
  const name = (field: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return "—";
    if (field === "originFarmId") return catalog.data?.farms.find((f) => f.id === value)?.name ?? String(value);
    if (field === "manufacturingSiteId") return sites.data?.items.find((s) => s.id === value)?.name ?? String(value);
    if (field === "managerUserId") return members.data?.items.find((m) => m.id === value)?.fullName ?? String(value);
    if (field === "status") return statusLabel[String(value)] ?? String(value);
    if (field === "price") return Number(value).toLocaleString("vi-VN");
    return textValue(value);
  };
  const actor = (id: string) => members.data?.items.find((m) => m.id === id)?.fullName ?? "—";
  return { catalog, name, actor };
}

export function ProductDetail({ id }: { id: string }) {
  const { catalog, name, actor } = useNames();
  const overview = useWorkspaceData<Overview>("/enterprise-workspace");
  const history = useWorkspaceData<Items<EnterpriseRevision>>(`/enterprise-workspace/revisions/PRODUCT/${id}`);
  const cmd = useWorkspaceCommand();
  const [logOpen, setLogOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [reason, setReason] = useState("");
  const evidence = useWorkspaceData<Items<TraceEvidence>>(`/enterprise-workspace/evidence?entityType=PRODUCT&entityId=${id}`);
  const productPhotos = useMemo(() => {
    const rows = evidence.data?.items ?? [];
    return rows.filter(
      (r) => r.kind === "PRODUCT_IMAGE" && r.mediaType.startsWith("image/") && !rows.some((n) => n.supersedesId === r.id),
    );
  }, [evidence.data]);
  const photos = useEvidenceThumbs(productPhotos);
  const [photo, setPhoto] = useState<(typeof photos)[number] | null>(null);
  const [lots, setLots] = useState<LotTrace[] | null>(null);
  useEffect(() => {
    getLots().then(setLots).catch(() => setLots([]));
  }, []);
  const row = catalog.data?.products.find((p) => p.id === id);
  const values = row as unknown as Values | undefined;
  const canManage = !!overview.data?.permissions.includes("catalog.manage") && !!row?.organizationId;
  const nextStatus = row?.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

  async function changeStatus(event: FormEvent) {
    event.preventDefault();
    if (!row || !values || reason.trim().length < 10) return;
    if (
      await cmd.run(
        `/enterprise-workspace/products/${id}`,
        { version: row.version, product: productBody(values), status: nextStatus, reason: reason.trim() },
        "POST",
        { confirmed: true },
      )
    ) {
      setStatusOpen(false);
      setReason("");
      catalog.reload();
      history.reload();
    }
  }

  const field = (key: string) => name(key, values?.[key]);
  const price = values?.price != null && values.price !== "" ? `${Number(values.price).toLocaleString("vi-VN")} đ/${row?.defaultUnit ?? ""}` : "—";
  const statusBadge = row && (
    <StatusBadge value={row.status} label={row.evidenceComplete === false ? "Chưa đủ ảnh" : statusLabel[row.status]} />
  );
  const infoLeft: [string, ReactNode][] = [
    ["Mã sản phẩm", field("sku")],
    ["Tên sản phẩm", field("productName")],
    ["Danh mục", field("category")],
    ["Giống / phân loại", field("variety")],
    ["Vùng xuất xứ", field("originFarmId")],
    ["Đơn vị tính", field("defaultUnit")],
    ["Giá", price],
    ["GTIN", field("gtin")],
  ];
  const infoRight: [string, ReactNode][] = [
    ["Điều kiện bảo quản", field("storageConditions")],
    ["Thành phần", field("ingredients")],
    ["Hướng dẫn sử dụng", field("usageInstructions")],
    ["Nguyên liệu", field("rawMaterials")],
    ["Nhà xưởng sản xuất", field("manufacturingSiteId")],
    ["Nhà xuất khẩu", field("exporter")],
    ["Nhà nhập khẩu", field("importer")],
    ["Nhà phân phối", field("distributor")],
    ["Nhà vận chuyển", field("carrier")],
  ];
  const lotCount = lots?.filter((lot) => lot.productName === row?.productName).length;

  return (
    <div className="manage-console product-view">
      <Link className="manage-back" href="/enterprise/products">
        ← Quay lại danh sách sản phẩm
      </Link>
      <LoadState {...catalog} />
      <CommandState command={cmd} />
      {row && values && (
        <>
          <header className="panel product-view-head">
            <span className="product-view-cover">
              {photos[0]?.url ? (
                <Image src={photos[0].url} alt={row.productName} width={96} height={72} unoptimized />
              ) : (
                <span>Chưa có ảnh</span>
              )}
            </span>
            <div className="product-view-title">
              <h1>
                {row.productName} {statusBadge}
              </h1>
              <p>
                Mã sản phẩm: <strong>{row.sku ?? "—"}</strong> <span aria-hidden="true">•</span> Phiên bản:{" "}
                <strong>{row.version}</strong>
                {!row.organizationId && <> <span aria-hidden="true">•</span> Danh mục dùng chung</>}
              </p>
            </div>
            <div className="product-view-actions">
              {canManage && (
                <Link className="button" replace href={`/enterprise/products/${id}/edit`}>
                  Sửa sản phẩm
                </Link>
              )}
              {canManage && (
                <Button
                  type="button"
                  className={`button ${row.status === "ACTIVE" ? "danger" : "secondary"}`}
                  disabled={cmd.pending}
                  onClick={() => setStatusOpen(true)}
                >
                  {row.status === "ACTIVE" ? "Ngừng bán" : "Mở bán lại"}
                </Button>
              )}
              <Button type="button" className="button secondary" onClick={() => setLogOpen(true)}>
                Lịch sử chỉnh sửa ({history.data?.items.length ?? 0})
              </Button>
            </div>
          </header>

          <div className="product-view-row">
            <section className="panel">
              <h2>Hình ảnh sản phẩm</h2>
              {photos.length ? (
                <div className="product-view-photos">
                  <Button type="button" className="product-view-main" onClick={() => setPhoto(photos[0])}>
                    {photos[0].url && <Image src={photos[0].url} alt={photos[0].row.fileName} width={640} height={420} unoptimized />}
                  </Button>
                  <div className="product-view-thumbs">
                    {photos.slice(1, 5).map((file, index) => (
                      <Button type="button" key={file.id} onClick={() => setPhoto(file)}>
                        {file.url && <Image src={file.url} alt={file.row.fileName} width={200} height={130} unoptimized />}
                        {index === 3 && photos.length > 5 && <span className="product-view-more">+{photos.length - 5}</span>}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="muted">{evidence.data ? "Chưa có hình ảnh." : "Đang tải ảnh…"}</p>
              )}
            </section>
            <section className="panel">
              <h2>Tổng quan sản phẩm</h2>
              <dl className="product-view-overview">
                {(
                  [
                    ["Danh mục", field("category")],
                    ["Đơn vị tính", field("defaultUnit")],
                    ["Giống / phân loại", field("variety")],
                    ["Giá", price],
                    ["Vùng xuất xứ", field("originFarmId")],
                    ["Người quản lý", field("managerUserId")],
                  ] as [string, string][]
                ).map(([label, text]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{text}</dd>
                  </div>
                ))}
              </dl>
              <h2 className="product-view-subtitle">Mô tả sản phẩm</h2>
              <p className="product-view-text">{field("description")}</p>
            </section>
          </div>

          <section className="panel">
            <h2>Thông tin sản phẩm</h2>
            <div className="product-view-info">
              {[infoLeft, infoRight].map((rows, column) => (
                <dl key={column}>
                  {rows.map(([label, text]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{text}</dd>
                    </div>
                  ))}
                </dl>
              ))}
            </div>
          </section>

          <section className="panel product-view-trace">
            <h2>Thông tin truy xuất liên quan</h2>
            <p>
              {lotCount === undefined
                ? "Đang tải lô nông sản…"
                : lotCount
                  ? `Sản phẩm này có ${lotCount} lô nông sản được truy xuất, từ vùng trồng đến phân phối.`
                  : "Chưa có lô nông sản nào của sản phẩm này."}
            </p>
            <Link className="button secondary" href={`/lots?product=${encodeURIComponent(row.productName)}`}>
              Xem truy xuất
            </Link>
          </section>
        </>
      )}
      <Lightbox file={photo} label={photo ? "Ảnh sản phẩm" : ""} onClose={() => setPhoto(null)} />
      <InfoDialog
        open={statusOpen}
        title={nextStatus === "INACTIVE" ? "Ngừng bán sản phẩm" : "Mở bán lại sản phẩm"}
        description="Thay đổi được lưu thành một phiên bản mới cùng lý do; lịch sử truy xuất không đổi."
        rows={[]}
        onClose={() => setStatusOpen(false)}
        actions={null}
      >
        <form className="workspace-form" onSubmit={changeStatus}>
          <label>
            Lý do
            <Textarea
              className="input"
              required
              minLength={10}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <Button type="button" className="button secondary" onClick={() => setStatusOpen(false)}>
              Hủy
            </Button>
            <Button
              type="submit"
              className={`button ${nextStatus === "INACTIVE" ? "danger" : ""}`}
              disabled={cmd.pending || reason.trim().length < 10}
            >
              {cmd.pending ? "Đang lưu…" : nextStatus === "INACTIVE" ? "Xác nhận ngừng bán" : "Xác nhận mở bán"}
            </Button>
          </div>
        </form>
      </InfoDialog>
      <RevisionLog
        open={logOpen}
        onClose={() => setLogOpen(false)}
        revisions={history.data?.items ?? []}
        current={values}
        labels={[...productFieldLabels, ["status", "Trạng thái"]]}
        name={name}
        actor={actor}
      />
    </div>
  );
}

/** Every revision as a log entry: who, when, why and which fields changed.
 * A revision stores the record before the change, so the change is the
 * difference to the next snapshot (or to the current record). */
export function RevisionLog({
  open,
  onClose,
  revisions,
  current,
  labels,
  name,
  actor,
}: {
  open: boolean;
  onClose: () => void;
  revisions: EnterpriseRevision[];
  current?: Values;
  labels: [string, string][];
  name: (field: string, value: unknown) => string;
  actor: (id: string) => string;
}) {
  const ordered = [...revisions].sort((a, b) => b.version - a.version);
  const after = (revision: EnterpriseRevision) =>
    (revisions.find((r) => r.version === revision.version + 1)?.snapshot as Values | undefined) ?? current ?? {};
  return (
    <InfoDialog
      open={open}
      title="Lịch sử chỉnh sửa"
      description="Mỗi lần sửa giữ bản trước để đối chiếu với lịch sử truy xuất."
      rows={[]}
      onClose={onClose}
      actions={
        <Button type="button" className="button" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      <ol className="revision-log">
        {ordered.map((revision) => {
          const before = revision.snapshot as Values;
          const next = after(revision);
          const changes = labels.filter(([field]) => String(before[field] ?? "") !== String(next[field] ?? ""));
          return (
            <li key={revision.id}>
              <header>
                <strong>
                  Phiên bản {revision.version} → {revision.version + 1}
                </strong>
                <span>
                  {new Date(revision.createdAt).toLocaleString("vi-VN")} · {actor(revision.actorId)}
                </span>
              </header>
              <p>Lý do: {revision.reason}</p>
              {changes.length ? (
                <Table className="manage-table compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trường</TableHead>
                      <TableHead>Trước</TableHead>
                      <TableHead>Sau</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changes.map(([field, label]) => (
                      <TableRow key={field}>
                        <TableCell>{label}</TableCell>
                        <TableCell>{name(field, before[field])}</TableCell>
                        <TableCell>{name(field, next[field])}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="muted">Không đổi trường thông tin nào.</p>
              )}
            </li>
          );
        })}
        {!ordered.length && <li className="muted">Chưa có lần sửa.</li>}
      </ol>
    </InfoDialog>
  );
}

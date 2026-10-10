"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-store";
import { request } from "@/lib/api-client";
import { ResponsiveTable } from "@/components/responsive-table";
import { DataForm, type Field } from "@/components/data-form";
import { emptyCatalog, type Catalog } from "@/lib/catalog";
import type { components } from "@/lib/generated/api";
type AdminUser = components["schemas"]["UserListDto"];
type Org = { id: string; name: string; type: string; status: string };
const tabs = ["Tổ chức", "Tài khoản", "Sản phẩm", "Nông trại", "Thửa đất"];
export default function AdminPage() {
  const { user } = useAuth();
  const allowed = user?.role.code === "SYSTEM_ADMIN";
  const [tab, setTab] = useState(0);
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<{ code: string; name: string }[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [c, o, u, r] = await Promise.all([
        request<Catalog>("/catalog"),
        request<Org[]>("/organizations"),
        request<AdminUser[]>("/users"),
        request<{ code: string; name: string }[]>("/users/roles"),
      ]);
      setCatalog(c);
      setOrgs(o);
      setUsers(u);
      setRoles(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);
  if (!allowed)
    return (
      <div className="notice error" role="alert">
        Chỉ quản trị viên được truy cập trang quản trị.
      </div>
    );
  const orgOptions = orgs
    .filter((o) => o.status === "ACTIVE")
    .map((o) => ({ value: o.id, label: o.name }));
  const farmOptions = catalog.farms
    .filter((f) => f.status === "ACTIVE")
    .map((f) => ({ value: f.id, label: f.name }));
  const fields: Field[][] = [
    [
      { name: "name", label: "Tên tổ chức", required: true },
      {
        name: "type",
        label: "Loại tổ chức",
        required: true,
        options: [
          { value: "FARM", label: "Nông trại" },
          { value: "TRANSPORTER", label: "Vận chuyển" },
          { value: "RETAILER", label: "Bán lẻ" },
          { value: "AUDITOR", label: "Kiểm định" },
        ],
      },
    ],
    [
      { name: "fullName", label: "Họ tên", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      {
        name: "password",
        label: "Mật khẩu (ít nhất 12 ký tự)",
        type: "password",
        required: true,
      },
      {
        name: "roleCode",
        label: "Vai trò",
        required: true,
        options: roles.map((r) => ({ value: r.code, label: r.name })),
      },
      {
        name: "organizationId",
        label: "Tổ chức (bắt buộc với tài khoản nghiệp vụ)",
        options: orgOptions,
      },
    ],
    [
      { name: "productName", label: "Tên sản phẩm", required: true },
      { name: "variety", label: "Giống" },
      { name: "defaultUnit", label: "Đơn vị mặc định", required: true },
    ],
    [
      { name: "name", label: "Tên nông trại", required: true },
      {
        name: "organizationId",
        label: "Tổ chức sở hữu",
        required: true,
        options: orgOptions.filter(
          (o) => orgs.find((x) => x.id === o.value)?.type === "FARM",
        ),
      },
      { name: "location", label: "Địa chỉ" },
    ],
    [
      { name: "name", label: "Tên thửa đất", required: true },
      {
        name: "farmId",
        label: "Nông trại",
        required: true,
        options: farmOptions,
      },
      { name: "area", label: "Diện tích", type: "number", min: 0.01 },
      { name: "unit", label: "Đơn vị diện tích" },
      { name: "location", label: "Vị trí" },
    ],
  ];
  const rows = [
    orgs.map((o) => [o.id, o.name, o.type, o.status]),
    users.map((u) => [u.id, u.fullName, u.email, u.role.name, u.accountStatus]),
    catalog.products.map((p) => [
      p.id,
      p.productName,
      p.variety ?? "",
      p.defaultUnit ?? "",
      p.status,
    ]),
    catalog.farms.map((f) => [
      f.id,
      f.name,
      f.organization?.name ?? "",
      f.location ?? "",
      f.status,
    ]),
    catalog.plots.map((p) => [
      p.id,
      p.name,
      p.farm?.name ?? "",
      [p.area, p.unit].filter(Boolean).join(" "),
      p.status,
    ]),
  ][tab];
  const headers = [
    ["Tên", "Loại", "Trạng thái"],
    ["Họ tên", "Email", "Vai trò", "Trạng thái"],
    ["Sản phẩm", "Giống", "Đơn vị", "Trạng thái"],
    ["Nông trại", "Tổ chức", "Địa chỉ", "Trạng thái"],
    ["Thửa đất", "Nông trại", "Diện tích", "Trạng thái"],
  ][tab];
  return (
    <div className="grid admin-page">
      <section className="page-header">
        <h1>Quản trị hệ thống</h1>
        <Link className="button secondary" href="/admin/compliance-assignments">
          Phân công người duyệt
        </Link>
      </section>
      <div className="section-tabs" aria-label="Danh mục quản trị">
        {tabs.map((t, i) => (
          <button
            className={tab === i ? "button" : "button secondary"}
            key={t}
            aria-pressed={tab === i}
            onClick={() => setTab(i)}
          >
            {t}
          </button>
        ))}
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}{" "}
          <button className="button secondary" onClick={() => void load()}>
            Thử lại
          </button>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <DataForm
        key={tab}
        title={"Thêm " + tabs[tab].toLocaleLowerCase("vi")}
        path={
          [
            "/organizations",
            "/users",
            "/catalog/products",
            "/catalog/farms",
            "/catalog/plots",
          ][tab]
        }
        fields={fields[tab]}
        onSaved={() => {
          setNotice("Đã thêm thành công.");
          void load();
        }}
      />
      <section className="panel">
        <h2>Danh sách {tabs[tab].toLocaleLowerCase("vi")}</h2>
        {loading ? (
          <p>Đang tải…</p>
        ) : rows.length === 0 ? (
          <p>Chưa có dữ liệu.</p>
        ) : (
          <ResponsiveTable<string[]>
            caption={"Danh sách " + tabs[tab]}
            rows={rows}
            rowKey={(row) => row[0]}
            columns={headers.map((header, index) => ({
              key: header,
              label: header,
              render: (row) => row[index + 1],
            }))}
          />
        )}
      </section>
    </div>
  );
}

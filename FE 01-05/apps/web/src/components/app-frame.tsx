"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, X, LayoutDashboard, Package, ScanLine, Thermometer, ShieldCheck, Blocks, Search } from "lucide-react";
import { getBatches } from "@/lib/api-client";
import type { Batch } from "@/lib/types";

const navigation = [
  { href: "/", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/batches", label: "Lô nông sản", icon: Package },
  { href: "/scan", label: "Quét mã QR", icon: ScanLine },
  { href: "/trace/batch-rau-001", label: "Truy xuất nguồn gốc", icon: ShieldCheck },
  { href: "/iot-simulator", label: "Cảm biến IoT", icon: Thermometer }
];

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [searchFailed, setSearchFailed] = useState(false);
  useEffect(() => { getBatches().then(setBatches).catch(() => setSearchFailed(true)); }, []);
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <div className="app-shell" data-collapsed={collapsed} data-mobile-open={mobileOpen}>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="AgriTrace - Tổng quan">
          <img className="brand-logo" src="/logo.png" alt="" width={64} height={64} />
          <span className="brand-text"><span className="brand-name">AgriTrace</span><span className="brand-sub">Truy xuất nguồn gốc nông sản</span></span>
        </Link>
        <div className="header-search">
          <Search size={20} />
          <input aria-label="Tìm lô nông sản" placeholder="Tìm nông sản, mã lô, trang trại..." value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setQuery(""); }} />
          {query.trim() && <div className="search-results">
            {batches.filter(batch => `${batch.productName} ${batch.batchCode} ${batch.farmOrg.name}`.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi"))).map(batch => <Link key={batch.batchId} href={`/batches/${batch.batchId}`} onClick={() => setQuery("")}><strong>{batch.productName}</strong><span>{batch.batchCode}</span></Link>)}
            {searchFailed ? <p>Chưa tải được danh sách lô.</p> : !batches.some(batch => `${batch.productName} ${batch.batchCode} ${batch.farmOrg.name}`.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi"))) && <p>Không tìm thấy lô phù hợp.</p>}
          </div>}
        </div>
        <div className="topbar-meta"><span className="workspace-avatar">HTX</span><span>HTX Rau Sạch Củ Chi<small>Nhân viên trang trại</small></span></div>
        <button className="icon-button desktop-toggle" title={collapsed ? "Mở rộng điều hướng" : "Thu gọn điều hướng"} aria-label={collapsed ? "Mở rộng điều hướng" : "Thu gọn điều hướng"} aria-expanded={!collapsed} aria-controls="main-navigation" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={21} /> : <PanelLeftClose size={21} />}</button>
        <button className="icon-button mobile-toggle" title="Điều hướng" aria-label={mobileOpen ? "Đóng điều hướng" : "Mở điều hướng"} aria-expanded={mobileOpen} aria-controls="main-navigation" onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X size={21} /> : <PanelLeftOpen size={21} />}</button>
      </header>
      <div className="layout">
        {mobileOpen && <button className="nav-backdrop" aria-label="Đóng điều hướng" onClick={() => setMobileOpen(false)} />}
        <aside className="sidebar" id="main-navigation">
          <p className="sidebar-heading">Không gian quản lý</p>
          <nav className="nav-list" aria-label="Điều hướng chính">
            {navigation.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href.split("/").slice(0, 2).join("/"));
              return <Link className="nav-link" href={href} key={href} title={label} aria-current={active ? "page" : undefined} onClick={() => setMobileOpen(false)}><Icon size={21} /><span>{label}</span></Link>;
            })}
          </nav>
          <div className="sidebar-network"><Blocks size={22} /><div><strong>Hyperledger Fabric</strong><span>Dữ liệu truy xuất chuỗi khối</span></div></div>
        </aside>
        <main className="content"><div className="page-content" key={pathname}>{children}</div><footer className="footer"><span>AgriTrace</span><span>Nguồn gốc rõ ràng. Hành trình minh bạch.</span></footer></main>
      </div>
    </div>
  );
}

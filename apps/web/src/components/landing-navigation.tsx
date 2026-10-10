"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  ArrowRight,
  Leaf,
  Menu,
  Package,
  ScanLine,
  Store,
  Truck,
  X,
} from "lucide-react";

const links = [
  ["#how", "Cách hoạt động"],
  ["#evidence", "Sự minh bạch"],
  ["#roles", "Dành cho ai"],
];

export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  return (
    <header className="site-header topbar">
      <div className="container nav-shell">
        <Link className="brand" href="/" aria-label="AgriTrace — Trang chủ">
          <Image
            className="brand-logo"
            src="/agritrace/brand/agritrace-logo.svg"
            alt="AgriTrace"
            width={156}
            height={44}
            priority
          />
          <span className="brand-sub">Truy xuất nguồn gốc nông sản</span>
        </Link>
        <nav className="desktop-nav" aria-label="Điều hướng chính">
          {links.map(([href, label]) => (
            <a href={href} key={href}>
              {label}
            </a>
          ))}
        </nav>
        <div className="nav-actions">
          <Link className="button small" href="/scan">
            <ScanLine size={18} /> Quét QR
          </Link>
          <button
            className="menu-button"
            ref={menuButton}
            type="button"
            aria-label={open ? "Đóng menu" : "Mở menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      <nav
        id="mobile-nav"
        className="mobile-nav"
        aria-label="Điều hướng di động"
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            menuButton.current?.focus();
          }
        }}
      >
        {links.map(([href, label]) => (
          <a href={href} key={href} onClick={() => setOpen(false)}>
            {label}
          </a>
        ))}
      </nav>
    </header>
  );
}

const stages = [
  {
    label: "Canh tác",
    kicker: "01 / CHU KỲ SẢN XUẤT",
    title: "Nhật ký từ những ngày đầu",
    text: "Nông trại ghi nhận gieo trồng và chăm sóc theo chu kỳ. Các lần thu hoạch sau đó vẫn liên kết về cùng nguồn gốc này.",
    icon: Leaf,
  },
  {
    label: "Thu hoạch",
    kicker: "02 / LÔ NÔNG SẢN",
    title: "Mỗi lần thu hoạch, một lô riêng",
    text: "Sản lượng, thời điểm và dữ liệu liên quan được gắn với lần thu hoạch. Mỗi lô có mã QR để tiếp tục theo dấu hành trình.",
    icon: Package,
  },
  {
    label: "Vận chuyển",
    kicker: "03 / CHUYẾN GIAO HÀNG",
    title: "Kết nối từ nơi đi đến nơi nhận",
    text: "Chuyến vận chuyển liên kết đúng lô, đơn vị vận chuyển và điểm nhận. Các mốc di chuyển giữ lại dấu vết giao nhận.",
    icon: Truck,
  },
  {
    label: "Tiếp nhận",
    kicker: "04 / ĐIỂM BÁN",
    title: "Rõ ràng khi hàng đến nơi",
    text: "Nhà bán lẻ ghi nhận nhận hoặc từ chối lô. Người tiêu dùng tra cứu lịch sử công khai và trạng thái bằng chứng bằng QR.",
    icon: Store,
  },
];

export function JourneyStages() {
  const [selected, setSelected] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const stage = stages[selected];
  const Icon = stage.icon;
  return (
    <>
      <div
        className="journey-tabs"
        role="tablist"
        aria-label="Các chặng trong hành trình nông sản"
      >
        {stages.map((item, index) => (
          <button
            key={item.label}
            id={`journey-tab-${index}`}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            className={selected === index ? "active" : ""}
            role="tab"
            aria-selected={selected === index}
            aria-controls="journey-panel"
            tabIndex={selected === index ? 0 : -1}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % stages.length
                  : event.key === "ArrowLeft"
                    ? (index + stages.length - 1) % stages.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? stages.length - 1
                        : null;
              if (next !== null) {
                event.preventDefault();
                setSelected(next);
                buttons.current[next]?.focus();
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        id="journey-panel"
        className="stage-panel"
        role="tabpanel"
        aria-labelledby={`journey-tab-${selected}`}
        tabIndex={0}
      >
        <div className="stage-icon">
          <Icon size={22} />
        </div>
        <div>
          <span className="micro-label">{stage.kicker}</span>
          <h3>{stage.title}</h3>
          <p>{stage.text}</p>
        </div>
      </div>
    </>
  );
}

export function PublicHeader() {
  return (
    <header className="public-header">
      <Link className="brand" href="/" aria-label="AgriTrace — Trang chủ">
        <Image
          className="brand-logo"
          src="/agritrace/brand/agritrace-logo.svg"
          alt="AgriTrace"
          width={156}
          height={44}
        />
      </Link>
      <Link className="text-link" href="/scan">
        <ScanLine size={18} />
        <span>Tra cứu QR</span>
        <ArrowRight size={16} />
      </Link>
    </header>
  );
}

"use client";
import { Tabs as TabsRoot, TabsList, TabsTrigger } from "@/components/ui/tabs";

import Link from "next/link";
import { useState, type ReactNode } from "react";

/** Row of headline numbers; each may open the list behind it. */
export function Metrics({
  label,
  items,
}: {
  label: string;
  items: { label: string; value: ReactNode; href?: string; hint?: string }[];
}) {
  return (
    <div className="manage-metrics" aria-label={label}>
      {items.map((item) =>
        item.href ? (
          <Link className="manage-metric" key={item.label} href={item.href}>
            <span>{item.label}</span>
            <strong>{item.value ?? "—"}</strong>
            <small>{item.hint ?? "Mở danh sách"}</small>
          </Link>
        ) : (
          <div className="manage-metric" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value ?? "—"}</strong>
            {item.hint && <small>{item.hint}</small>}
          </div>
        ),
      )}
    </div>
  );
}

/** Simple horizontal bars for a short monthly or categorical series. */
export function BarList({
  label,
  rows,
  format = (value) => value.toLocaleString("vi-VN"),
}: {
  label: string;
  rows: { label: string; value: number }[];
  format?(value: number): string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="admin-bars" aria-label={label}>
      {rows.map((row) => (
        <li key={row.label}>
          <span className="admin-bars-label">{row.label}</span>
          <span className="admin-bars-track" aria-hidden="true">
            <span style={{ width: `${(row.value / max) * 100}%` }} />
          </span>
          <span className="admin-bars-value">{format(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Inline form asking for a written reason before an audited action. */
export function ReasonAction({
  label,
  placeholder = "Lý do (tối thiểu 10 ký tự, ghi vào nhật ký kiểm toán)",
  danger = false,
  disabled,
  extra,
  onSubmit,
}: {
  label: string;
  placeholder?: string;
  danger?: boolean;
  disabled?: boolean;
  extra?: ReactNode;
  onSubmit(reason: string): Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <button
        type="button"
        className={danger ? "button danger" : "button secondary"}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
    );
  return (
    <form
      className="admin-reason"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await onSubmit(reason.trim());
        if (result !== false) {
          setOpen(false);
          setReason("");
        }
      }}
    >
      {extra}
      <textarea
        className="input"
        aria-label={`Lý do: ${label}`}
        required
        minLength={10}
        maxLength={1000}
        value={reason}
        placeholder={placeholder}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="actions">
        <button className={danger ? "button danger" : "button"} disabled={disabled || reason.trim().length < 10}>
          Xác nhận
        </button>
        <button type="button" className="button secondary" onClick={() => setOpen(false)}>
          Hủy
        </button>
      </div>
    </form>
  );
}

/** Tabs that keep their state in the component only. */
export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: string; label: string; count?: number }[];
  value: string;
  onChange(value: string): void;
}) {
  return (
    <TabsRoot value={value} onValueChange={onChange}>
      <TabsList aria-label="Nhóm dữ liệu">{tabs.map(tab => <TabsTrigger key={tab.value} value={tab.value}>{tab.label}{tab.count !== undefined && <span>{tab.count}</span>}</TabsTrigger>)}</TabsList>
    </TabsRoot>
  );
}

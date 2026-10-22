"use client";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useWorkspaceData, labels, type Items } from "@/lib/workspace";
import type { components } from "@/lib/generated/api";

export type PartnerMatch = components["schemas"]["PartnerSearchItemDto"];
const GROUPS: [PartnerMatch["matched"], string][] = [
  ["TAX", "Trùng mã số thuế"],
  ["NAME", "Trùng tên doanh nghiệp"],
  ["CODE", "Trùng mã AgriTrace"],
];

/** Debounced partner search shared by the invite and external forms. */
export function usePartnerSearch(query: string) {
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const state = useWorkspaceData<Items<PartnerMatch>>(
    term.length >= 2
      ? `/enterprise-workspace/partners/search?q=${encodeURIComponent(term)}`
      : null,
  );
  return { term, items: state.data?.items ?? [], loading: state.loading && term.length >= 2 };
}

/** Matches listed right under the input, grouped by what they match. */
export function PartnerMatches({
  items,
  term,
  loading,
  onPick,
  onView,
  pickLabel = "Chọn",
}: {
  items: PartnerMatch[];
  term: string;
  loading?: boolean;
  onPick?: (item: PartnerMatch) => void;
  onView?: (item: PartnerMatch) => void;
  pickLabel?: string;
}) {
  if (term.length < 2) return null;
  if (loading) return <p className="partner-matches-empty muted">Đang tìm…</p>;
  if (!items.length)
    return (
      <p className="partner-matches-empty muted">
        Không có doanh nghiệp nào trùng “{term}”.
      </p>
    );
  return (
    <div className="partner-matches" role="listbox" aria-label="Doanh nghiệp trùng khớp">
      {GROUPS.map(([group, title]) => {
        const rows = items.filter((i) => i.matched === group);
        if (!rows.length) return null;
        return (
          <section key={group}>
            <h3>{title}</h3>
            <ul>
              {rows.map((item) => (
                <li key={`${item.registered}-${item.id}`}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      MST {item.taxCode ?? "—"}
                      {item.agriTraceCode ? ` · ${item.agriTraceCode}` : ""} ·{" "}
                      {labels[item.kind] ?? item.kind}
                    </small>
                  </div>
                  <span className={`workspace-badge ${item.registered ? "" : "muted"}`}>
                    {item.registered ? "Trên AgriTrace" : "Hồ sơ ngoài hệ thống"}
                  </span>
                  {onView && item.registered && (
                    <Button type="button" className="button secondary small" onClick={() => onView(item)}>
                      Xem hồ sơ
                    </Button>
                  )}
                  {onPick && item.registered && (
                    <Button
                      type="button"
                      className="button secondary small"
                      onClick={() => onPick(item)}
                    >
                      {pickLabel}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

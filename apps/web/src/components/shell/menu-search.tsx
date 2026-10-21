"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NavGroup, NavItem } from "@/lib/management-routes";
import { fieldIndex } from "@/lib/search-index";
import { foldText } from "@/lib/text-fold";
import { requestFieldFocus } from "./field-focus";

type Entry = {
  key: string;
  href: string;
  /** What the row names: a page, or a field / column inside one. */
  label: string;
  /** Tree leading to it, e.g. ["Quản trị", "Quản lý thành viên", "Thêm thành viên"]. */
  path: string[];
  field?: string;
  text: string;
};

/** Finds the management pages visible to the signed-in viewer and the fields,
 * columns and sub-pages inside them; it never searches business data. Every
 * word of the query must match the entry or its path. */
export function MenuSearch({ groups, extra = [] }: { groups: NavGroup[]; extra?: NavItem[] }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const entries = useMemo(() => {
    const list: Entry[] = [];
    const seen = new Set<string>();
    const add = (entry: Omit<Entry, "text">) => {
      if (seen.has(entry.key)) return;
      seen.add(entry.key);
      list.push({ ...entry, text: foldText(`${entry.label} ${entry.path.join(" ")}`) });
    };
    const pages = [
      ...groups.flatMap((group) => group.items.map((item) => ({ item, group: group.title }))),
      ...extra.map((item) => ({ item, group: "Tài khoản" })),
    ];
    for (const { item, group } of pages)
      add({ key: item.href, href: item.href, label: item.label, path: [group] });
    for (const { item, group } of pages)
      for (const section of fieldIndex[item.href] ?? []) {
        const href = section.href ?? item.href;
        const path = [group, item.label, ...(section.page ? [section.page] : [])];
        if (section.page)
          add({ key: href, href, label: section.page, path: [group, item.label] });
        for (const field of section.fields)
          add({ key: `${href}#${field}`, href, label: field, path, field });
      }
    return list;
  }, [groups, extra]);

  const words = foldText(query.trim()).split(/\s+/).filter(Boolean);
  const results = words.length
    ? entries
        .filter((entry) => words.every((word) => entry.text.includes(word)))
        .map((entry) => {
          const label = foldText(entry.label);
          const phrase = words.join(" ");
          // Pages before fields; names that start with the query first.
          const rank =
            (entry.field ? 2 : 0) +
            (label.startsWith(phrase) ? 0 : label.includes(phrase) ? 0.5 : 1);
          return { entry, rank };
        })
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 14)
        .map(({ entry }) => entry)
    : [];

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setQuery("");
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const open = (entry: Entry) => {
    setQuery("");
    if (entry.field) requestFieldFocus(entry.field, entry.href);
  };

  return (
    <div className="header-search menu-search" ref={box}>
      <input
        type="search"
        aria-label="Tìm chức năng"
        placeholder="Tìm chức năng hoặc trường, ví dụ: điện thoại…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setQuery("");
          else if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((n) => Math.min(n + 1, results.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((n) => Math.max(n - 1, 0));
          } else if (event.key === "Enter" && results[active]) {
            event.preventDefault();
            router.push(results[active].href);
            open(results[active]);
          }
        }}
      />
      {words.length > 0 && (
        <div className="search-results" role="listbox" aria-label="Kết quả tìm chức năng">
          {results.length ? (
            results.map((entry, index) => (
              <Link
                href={entry.href}
                key={entry.key}
                role="option"
                aria-selected={index === active}
                data-active={index === active || undefined}
                data-kind={entry.field ? "field" : "page"}
                onClick={() => open(entry)}
                onMouseEnter={() => setActive(index)}
              >
                <strong>{entry.label}</strong>
                <span className="search-path">
                  {entry.path.map((part, i) => (
                    <span key={i}>{part}</span>
                  ))}
                </span>
              </Link>
            ))
          ) : (
            <p>Không tìm thấy chức năng phù hợp.</p>
          )}
        </div>
      )}
    </div>
  );
}

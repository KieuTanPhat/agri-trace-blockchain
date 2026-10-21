import type { ReactNode } from "react";

/** Page container for every management page; `form` narrows it for editing. */
export function ManagePage({
  form = false,
  className,
  children,
}: {
  form?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={["manage-console", form && "manage-console--form", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

/** Bordered block with an optional heading row. */
export function Section({
  title,
  overline,
  help,
  actions,
  label,
  children,
}: {
  title?: string;
  overline?: string;
  help?: ReactNode;
  actions?: ReactNode;
  /** Accessible name when the section has no visible title. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <section className="manage-section" aria-label={title ? undefined : label}>
      {(title || actions) && (
        <div className="manage-section-heading">
          <div>
            {overline && <p className="manage-overline">{overline}</p>}
            {title && <h2>{title}</h2>}
            {help && <p>{help}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="manage-filter-bar">{children}</div>;
}

export function SearchField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <div className="manage-search-field">

      <input
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button
          type="button"
          aria-label="Xóa từ khóa tìm kiếm"
          onClick={() => onChange("")}
        >

        </button>
      )}
    </div>
  );
}

/** Label/value pairs for detail pages. */
export function DetailList({
  items,
}: {
  items: [label: string, value: ReactNode][];
}) {
  return (
    <dl className="manage-detail-list">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

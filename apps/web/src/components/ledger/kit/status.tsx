import { cn } from "@/lib/ledger/utils";
import { label, type Tone } from "@/lib/ledger/labels";

const toneClass: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  info: "bg-info-bg text-info",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  neutral: "bg-neutral-bg text-neutral",
  brand: "bg-brand-weak text-brand-ink",
};
const dotClass: Record<Tone, string> = {
  ok: "bg-ok",
  info: "bg-info",
  warn: "bg-warn-dot",
  danger: "bg-danger",
  neutral: "bg-neutral",
  brand: "bg-brand",
};

export function Badge({ tone = "neutral", children, dot = true, className }: { tone?: Tone; children: React.ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-2 text-[12px] font-medium", toneClass[tone], className)}>
      {dot && <span aria-hidden className={cn("size-1.5 rounded-full", dotClass[tone])} />}
      {children}
    </span>
  );
}

export function Status({ group, value, className }: { group: Parameters<typeof label>[0]; value?: string | null; className?: string }) {
  const [text, tone] = label(group, value);
  return (
    <Badge tone={tone} className={className}>
      {text}
    </Badge>
  );
}

/** Nhãn mã kỹ thuật (enum, operation…) đơn cách, nền xám nhạt. */
export function Code({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-sm bg-sunken px-1.5 py-0.5 font-mono text-[11.5px] text-ink", className)}>{children}</span>;
}

export function Due({ overdue, children }: { overdue: boolean; children: React.ReactNode }) {
  return <span className={cn("text-[12px] font-medium whitespace-nowrap", overdue ? "text-danger" : "text-ink-2")}>{children}</span>;
}

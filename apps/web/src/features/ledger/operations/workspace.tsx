"use client";

import { createContext, useContext, useState } from "react";
import { useLedgerInfiniteQuery as useInfiniteQuery, useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/ledger/operations-api";
import { useLedgerSession } from "@/lib/ledger/platform-access";
import type { BindingHealthItem, HoldItem, LedgerJobItem, MailItem, OutboxItem, Paged } from "@/lib/ledger/operations-types";
import { fmtDateTime, fmtNumber, fmtSeconds } from "@/lib/ledger/format";
import { Button } from "@/components/ledger/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ledger/ui/tabs";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { FilterSelect } from "@/components/ledger/kit/filters";
import { Guard } from "@/components/ledger/kit/guard";
import { Callout, EmptyState, ErrorState, LoadingRows, PageBody, PageHeader, ReadOnlyNote, Section, Stat, StatRow } from "@/components/ledger/kit/page";
import { Badge, Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
export function OperationsPage() {
  return (
    <Guard permission="operations.read">
      <Operations />
    </Guard>
  );
}

function Scope({ by }: { by: string[] }) {
  const filters=useContext(OpsContext);
  const unsupported=(filters.chainId&&!by.includes("chain"))||(filters.organizationId&&!by.includes("organization"));
  return <span className="text-[11px] text-ink-2">{tr("lọc được theo:")} {by.map((b) => (b === "chain" ? tr("chuỗi") : tr("tổ chức"))).join(", ")}{unsupported&&<span className="block text-warn">{tr("Không lọc được theo bộ lọc này")}</span>}</span>;
}

const OpsContext=createContext<import("@/lib/ledger/operations-types").OpsFilters>({});
function Operations() {
  const { can } = useLedgerSession();
  const [chainId, setChain] = useState("");
  const [organizationId, setOrg] = useState("");
  const filters = { chainId: chainId || undefined, organizationId: organizationId || undefined };
  const summary = useQuery({ queryKey: ["ops-summary", filters], queryFn: () => api.ops.summary(filters) });
  const chains = useQuery({ queryKey: ["chains"], queryFn: api.enterprises.chains });
  const orgs = useQuery({ queryKey: ["organizations"], queryFn: api.enterprises.organizations });
  const s = summary.data;
  return (
    <>
      <PageHeader
        title={tr("Tình trạng hệ thống")}
        description={tr("Đếm và metadata đọc trực tiếp từ bảng tại thời điểm generatedAt — không phải bằng chứng Fabric. Không có route ghi: không phát lại outbox, không sửa binding, không giải phóng hold.")}
        actions={
          <Button variant="outline" size="sm" onClick={() => summary.refetch()} disabled={summary.isFetching}>
            <RefreshCw className={cn(summary.isFetching && "animate-spin")} /> {tr("Làm mới")}
          </Button>
        }
      />
      <PageBody wide><OpsContext.Provider value={filters}>
        <div className="flex flex-wrap gap-2">
              <FilterSelect label={tr("Chuỗi")} value={chainId} onChange={setChain} options={(chains.data ?? []).map((c) => ({ value: c.id, label: c.name }))} className="min-w-[220px]" />
              <FilterSelect label={tr("Tổ chức")} value={organizationId} onChange={setOrg} options={(orgs.data ?? []).filter(o=>o.type!=="AUDITOR").map((o) => ({ value: o.id, label: o.name }))} className="min-w-[220px]" />
            </div>
<Tabs defaultValue="summary" className="gap-4">
          <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="summary">{tr("Tổng hợp")}</TabsTrigger>
            <TabsTrigger value="outbox">Outbox</TabsTrigger>
            <TabsTrigger value="holds">Hold</TabsTrigger>
            <TabsTrigger value="jobs">Ledger job</TabsTrigger>
            <TabsTrigger value="health">Binding</TabsTrigger>
            <TabsTrigger value="mail">{tr("Email hệ thống")}</TabsTrigger>
            <TabsTrigger value="credentials">{tr("Chứng thư & khóa ký")}</TabsTrigger>
            {can("monitoring.read") && <TabsTrigger value="monitoring">{tr("Giám sát")}</TabsTrigger>}
            {can("backup.read") && <TabsTrigger value="backup">{tr("Sao lưu")}</TabsTrigger>}
          </TabsList>
          <TabsContent value="summary" className="flex flex-col gap-4">

            {(chainId || organizationId) && <Callout tone="info">{tr("Phần không lọc được theo bộ lọc đã chọn vẫn là số liệu toàn nền tảng — xem dòng “lọc được theo” dưới mỗi khối.")}</Callout>}
            {summary.error ? (
              <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
            ) : !s ? (
              <LoadingRows />
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <Section title="Outbox blockchain" aside={<Scope by={s.outbox.scopedBy} />}>
                    <dl className="grid grid-cols-5 divide-x divide-line/70 text-center">
                      {(["PENDING", "PROCESSING", "RETRY", "DEAD_LETTER", "COMPLETED"] as const).map((k) => (
                        <div key={k} className="px-1 py-3">
                          <dt className="text-[11px] text-ink-2">{k === "DEAD_LETTER" ? tr("Lỗi") : k === "COMPLETED" ? "Xong" : k === "PROCESSING" ? tr("Đang gửi") : k === "RETRY" ? tr("Thử lại") : tr("Chờ")}</dt>
                          <dd className={cn("font-mono text-[18px]", k === "DEAD_LETTER" && s.outbox.counts[k] && "text-danger", k === "RETRY" && s.outbox.counts[k] && "text-warn")}>{fmtNumber(s.outbox.counts[k])}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="border-t border-line/70 px-4 py-2 text-[12px] text-ink-2">{tr("Cũ nhất chưa xong:")} {fmtSeconds(s.outbox.oldestUnfinishedAgeSeconds)} {tr("· lỡ lượt &gt;5 phút:")} {s.outbox.overdue}</p>
                  </Section>
                  <Section title="Ledger control job" aside={<Scope by={s.ledgerJobs.scopedBy} />}>
                    <dl className="grid grid-cols-4 divide-x divide-line/70 text-center">
                      {(["PENDING", "PROCESSING", "FAILED", "COMPLETED"] as const).map((k) => (
                        <div key={k} className="py-3">
                          <dt className="text-[11px] text-ink-2">{{ PENDING: tr("Chờ"), PROCESSING: tr("Đang chạy"), FAILED: tr("Lỗi"), COMPLETED: "Xong" }[k]}</dt>
                          <dd className={cn("font-mono text-[18px]", k === "FAILED" && s.ledgerJobs.counts[k] && "text-danger")}>{fmtNumber(s.ledgerJobs.counts[k])}</dd>
                        </div>
                      ))}
                    </dl>
                  </Section>
                  <Section title={tr("Email hệ thống")} aside={<Scope by={s.mail.scopedBy} />}>
                    <dl className="grid grid-cols-3 divide-x divide-line/70 text-center">
                      {(["PENDING", "SENT", "CANCELLED"] as const).map((k) => (
                        <div key={k} className="py-3">
                          <dt className="text-[11px] text-ink-2">{{ PENDING: tr("Chờ gửi"), SENT: tr("Đã gửi"), CANCELLED: tr("Hủy") }[k]}</dt>
                          <dd className="font-mono text-[18px]">{fmtNumber(s.mail.counts[k])}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="border-t border-line/70 px-4 py-2 text-[12px] text-ink-2">{tr("Đã thử lỗi (PENDING, ≥2 lần):")} {s.mail.retrying} {tr("· quá hạn:")} {s.mail.overdue}{tr(". Không hiển thị người nhận hay nội dung.")}</p>
                  </Section>
                </div>
                <StatRow>
                  <Stat label={tr("Hold giao nhận đang mở")} value={s.holds.open} tone={s.holds.open ? "warn" : undefined} hint={<>{tr("cũ nhất {p0}", { p0: fmtSeconds(s.holds.oldestOpenAgeSeconds) })}<Scope by={s.holds.scopedBy}/></>} />
                  <Stat label={tr("Binding không khỏe")} value={`${s.bindingHealth.unhealthy}/${s.bindingHealth.total}`} tone={s.bindingHealth.unhealthy ? "danger" : "ok"} hint={<>{tr("cũ khi >10 phút chưa kiểm")}<Scope by={s.bindingHealth.scopedBy}/></>} />
                  <Stat label={tr("Phiên đang hoạt động")} value={fmtNumber(s.accounts.activeSessions)} hint={<Scope by={s.accounts.scopedBy}/>} />
                  <Stat label={tr("Tài khoản khóa / vô hiệu")} value={`${s.accounts.lockedAccounts} / ${s.accounts.disabledAccounts}`} hint={<Scope by={s.accounts.scopedBy}/>} />
                </StatRow>
                <p className="font-mono text-[11.5px] text-ink-2">generatedAt {fmtDateTime(s.generatedAt)}</p>
              </>
            )}
          </TabsContent>
          <TabsContent value="outbox">
            <Outbox />
          </TabsContent>
          <TabsContent value="holds">
            <Holds />
          </TabsContent>
          <TabsContent value="jobs">
            <LedgerJobs />
          </TabsContent>
          <TabsContent value="health">
            <BindingHealth />
          </TabsContent>
          <TabsContent value="mail">
            <Mail />
          </TabsContent>
          <TabsContent value="credentials">
            <Credentials />
          </TabsContent>
          {can("monitoring.read") && <TabsContent value="monitoring">
            <Monitoring />
          </TabsContent>}
          {can("backup.read") && <TabsContent value="backup">
            <Backup />
          </TabsContent>}
        </Tabs>
      </OpsContext.Provider></PageBody>
    </>
  );
}

function Outbox() {
 const filters=useContext(OpsContext);
  const [status, setStatus] = useState("");
  const q = useInfiniteQuery({ queryKey: ["outbox", filters, status], queryFn: ({ pageParam }) => api.ops.outbox({ ...filters, status: status || undefined, cursor: pageParam }), initialPageParam: undefined as string | undefined, getNextPageParam: (l) => l.nextCursor ?? undefined });
  const rows = q.data?.pages.flatMap((p) => p.items);
  const columns: Column<OutboxItem>[] = [
    { key: "type", header: tr("Sự kiện"), cell: (o) => <span className="flex flex-col"><span className="font-mono text-[12px]">{o.eventType}</span><span className="font-mono text-[11px] text-ink-2">{o.eventId.slice(-12)}</span></span> },
    { key: "scope", header: tr("Chuỗi / Tổ chức"), cell: (o) => <span className="flex flex-col text-[12px]"><span>{o.chainName ?? "—"}</span><span className="text-ink-2">{o.organization?.name ?? "—"}</span></span> },
    { key: "att", header: tr("Lượt thử"), cell: (o) => <span className="font-mono text-[12px]">{o.attemptCount}{o.leased && <Badge tone="brand" dot={false} className="ml-1.5 h-5">{tr("đang giữ")}</Badge>}</span> },
    { key: "age", header: tr("Tuổi"), sort: (o) => o.ageSeconds, cell: (o) => <span className="font-mono text-[12px]">{fmtSeconds(o.ageSeconds)}</span> },
    { key: "err", header: tr("Lỗi gần nhất (≤300 ký tự)"), hideBelow: "md", cell: (o) => <span className="line-clamp-2 font-mono text-[11.5px] text-ink-2">{o.lastError ?? "—"}</span> },
    { key: "status", header: tr("Trạng thái"), cell: (o) => <Status group="outbox" value={o.status} /> },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <FilterSelect label={tr("Trạng thái")} value={status} onChange={setStatus} options={["PENDING", "PROCESSING", "RETRY", "DEAD_LETTER", "COMPLETED"].map((v) => ({ value: v, label: v }))} />
        <span className="text-[12px] text-ink-2">{tr("Mặc định chỉ liệt kê việc cần xử lý; trạng thái đã xong chỉ hiện khi lọc rõ.")}</span>
      </div>
      <div className="overflow-hidden rounded-md border border-line bg-card">
        <DataTable
          rows={rows}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          columns={columns}
          rowKey={(o) => o.id}
          pageSize={null}
          empty={<EmptyState title={tr("Không có việc tồn đọng")} />}
          footer={q.hasNextPage ? <Button size="xs" variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage && <Loader2 className="animate-spin" />} {tr("Tải thêm")}</Button> : <span>{tr("Hết")}</span>}
        />
      </div>
      <ReadOnlyNote>{tr("Khắc phục (phát lại, giải phóng hold) do operator thực hiện theo Hybrid runbook — không có nút trong giao diện vì API không hỗ trợ.")}</ReadOnlyNote>
    </div>
  );
}

/** Bảng phân trang cursor dùng chung cho các danh sách chỉ đọc của platform-operations. */
function CursorTable<R>({ queryKey, fetch, columns, rowKey, empty, filters, note }: { queryKey: unknown[]; fetch: (cursor?: string) => Promise<Paged<R>>; columns: Column<R>[]; rowKey: (r: R) => string; empty: string; filters?: React.ReactNode; note?: string }) {
  const q = useInfiniteQuery({ queryKey, queryFn: ({ pageParam }) => fetch(pageParam), initialPageParam: undefined as string | undefined, getNextPageParam: (l) => l.nextCursor ?? undefined });
  return (
    <div className="flex flex-col gap-3">
      {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
      <div className="overflow-hidden rounded-md border border-line bg-card">
        <DataTable
          rows={q.data?.pages.flatMap((p) => p.items)}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          columns={columns}
          rowKey={rowKey}
          pageSize={null}
          empty={<EmptyState title={empty} />}
          footer={q.hasNextPage ? <Button size="xs" variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage && <Loader2 className="animate-spin" />} {tr("Tải thêm")}</Button> : <span>{tr("Hết")}</span>}
        />
      </div>
      {note && <ReadOnlyNote>{note}</ReadOnlyNote>}
    </div>
  );
}

function useChainName() {
  const chains = useQuery({ queryKey: ["chains"], queryFn: api.enterprises.chains });
  return (id: string) => chains.data?.find((c) => c.id === id)?.name ?? id.slice(0, 8);
}

function Holds() {
 const filters=useContext(OpsContext);
  const chainName = useChainName();
  const columns: Column<HoldItem>[] = [
    { key: "scope", header: tr("Phạm vi"), cell: (h) => <Badge tone="warn" dot={false}>{h.scope}</Badge> },
    { key: "chain", header: tr("Chuỗi"), cell: (h) => <span className="text-[13px]">{chainName(h.chainId)}</span> },
    { key: "reason", header: tr("Lý do"), cell: (h) => <span className="line-clamp-2 text-[12.5px]">{h.reason}</span> },
    { key: "event", header: tr("Sự kiện"), hideBelow: "md", cell: (h) => <span className="font-mono text-[11.5px] text-ink-2">{h.eventId?.slice(-12) ?? "—"}</span> },
    { key: "age", header: tr("Mở từ"), sort: (h) => h.ageSeconds, cell: (h) => <span className="flex flex-col font-mono text-[12px]"><span>{fmtSeconds(h.ageSeconds)}</span><span className="text-[11px] text-ink-2">{fmtDateTime(h.openedAt)}</span></span> },
  ];
  return <CursorTable queryKey={["ops-holds", filters]} fetch={(cursor) => api.ops.holds({ ...filters, cursor })} columns={columns} rowKey={(h) => h.id} empty={tr("Không có hold đang mở")} note={tr("Hold chặn giao nhận trên binding/quyền/sự kiện tới khi operator giải phóng theo runbook. API chỉ đọc, chỉ liệt kê hold chưa giải quyết.")} />;
}

function LedgerJobs() {
 const filters=useContext(OpsContext);
  const chainName = useChainName();
  const [status, setStatus] = useState("");
  const columns: Column<LedgerJobItem>[] = [
    { key: "op", header: tr("Thao tác"), cell: (j) => <span className="font-mono text-[12px]">{j.operation}</span> },
    { key: "chain", header: tr("Chuỗi"), cell: (j) => <span className="text-[13px]">{chainName(j.chainId)}</span> },
    { key: "att", header: tr("Lượt thử"), cell: (j) => <span className="font-mono text-[12px]">{j.attemptCount}</span> },
    { key: "age", header: tr("Tuổi"), sort: (j) => j.ageSeconds, cell: (j) => <span className="font-mono text-[12px]">{fmtSeconds(j.ageSeconds)}</span> },
    { key: "err", header: tr("Lỗi gần nhất (≤300 ký tự)"), hideBelow: "md", cell: (j) => <span className="line-clamp-2 font-mono text-[11.5px] text-ink-2">{j.lastError ?? "—"}</span> },
    { key: "status", header: tr("Trạng thái"), cell: (j) => <Status group="ledgerJob" value={j.status} /> },
  ];
  return (
    <CursorTable
      queryKey={["ops-jobs", filters, status]}
      fetch={(cursor) => api.ops.ledgerJobs({ ...filters, status: status || undefined, cursor })}
      columns={columns}
      rowKey={(j) => j.id}
      empty={tr("Không có việc tồn đọng")}
      filters={
        <>
          <FilterSelect label={tr("Trạng thái")} value={status} onChange={setStatus} options={["PENDING", "PROCESSING", "FAILED", "COMPLETED"].map((v) => ({ value: v, label: v }))} />
          <span className="text-[12px] text-ink-2">{tr("Mặc định chỉ liệt kê việc cần xử lý; trạng thái đã xong chỉ hiện khi lọc rõ.")}</span>
        </>
      }
      note={tr("Ledger control job đồng bộ quyền, khóa ký và hàng rào giao nhận lên Fabric. Chạy lại do worker/operator, không có nút trong giao diện.")}
    />
  );
}

function BindingHealth() {
 const filters=useContext(OpsContext);
  const chainName = useChainName();
  const columns: Column<BindingHealthItem>[] = [
    { key: "digest", header: "Binding", cell: (b) => <span className="font-mono text-[12px]">{b.bindingDigest}</span> },
    { key: "chain", header: tr("Chuỗi"), cell: (b) => <span className="text-[13px]">{chainName(b.chainId)}</span> },
    { key: "checked", header: tr("Kiểm tra"), sort: (b) => b.lastCheckedAt, cell: (b) => <span className="font-mono text-[12px]">{fmtDateTime(b.lastCheckedAt)}</span> },
    { key: "healthy", header: tr("Khỏe lần cuối"), cell: (b) => <span className="font-mono text-[12px]">{fmtDateTime(b.lastHealthyAt)}</span> },
    { key: "cert", header: tr("Chứng thư hết hạn"), hideBelow: "md", cell: (b) => <span className="font-mono text-[12px]">{fmtDateTime(b.certificateExpiresAt)}</span> },
    { key: "state", header: tr("Tình trạng"), cell: (b) => (b.lastErrorCode ? <Badge tone="danger">{b.lastErrorCode}</Badge> : b.stale ? <Badge tone="warn">{tr("Cũ (>10 phút)")}</Badge> : <Badge tone="ok">{tr("Khỏe")}</Badge>) },
  ];
  return <CursorTable queryKey={["ops-health", filters]} fetch={(cursor) => api.ops.bindingHealth({...filters,cursor})} columns={columns} rowKey={(b) => b.bindingDigest} empty={tr("Chưa có binding")} note={tr("Chỉ trả 16 ký tự đầu của digest; worker ghi lần kiểm tra và hạn chứng thư quan sát được. Binding coi là cũ khi quá 10 phút chưa kiểm tra.")} />;
}

function Mail() {
 const filters=useContext(OpsContext);
  const [status, setStatus] = useState("");
  const columns: Column<MailItem>[] = [
    { key: "kind", header: tr("Loại"), cell: (m) => <span className="font-mono text-[12px]">{m.kind}</span> },
    { key: "org", header: tr("Tổ chức"), cell: (m) => <span className="text-[13px]">{m.organization?.name ?? "—"}</span> },
    { key: "att", header: tr("Lượt thử"), cell: (m) => <span className="font-mono text-[12px]">{m.attempts}</span> },
    { key: "age", header: tr("Tuổi"), sort: (m) => m.ageSeconds, cell: (m) => <span className="font-mono text-[12px]">{fmtSeconds(m.ageSeconds)}</span> },
    { key: "next", header: tr("Lần gửi tới / đã gửi"), hideBelow: "md", cell: (m) => <span className="font-mono text-[12px]">{fmtDateTime(m.sentAt ?? m.nextAttemptAt)}</span> },
    { key: "status", header: tr("Trạng thái"), cell: (m) => <Status group="mail" value={m.status} /> },
  ];
  return (
    <CursorTable
      queryKey={["ops-mail", filters, status]}
      fetch={(cursor) => api.ops.mail({ ...filters, status: status || undefined, cursor })}
      columns={columns}
      rowKey={(m) => m.id}
      empty={tr("Không có email trong trạng thái này")}
      filters={
        <>
          <FilterSelect label={tr("Trạng thái")} value={status} onChange={setStatus} options={[{ value: "RETRYING", label: tr("Đang thử lại (≥2 lần)") }, { value: "SENT", label: tr("Đã gửi") }, { value: "CANCELLED", label: tr("Đã hủy") }]} />
          <span className="text-[12px] text-ink-2">{tr("Mặc định: email đang chờ gửi.")}</span>
        </>
      }
      note={tr("Chỉ metadata: người nhận, tiêu đề và nội dung không rời bảng email.")}
    />
  );
}

function Credentials() {
 const filters=useContext(OpsContext);
  const q = useQuery({ queryKey: ["credentials", filters], queryFn: () => api.ops.credentials(filters) });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  if (!d) return <LoadingRows />;
  return (
    <div className="flex flex-col gap-4">
      <StatRow>
        <Stat label={tr("Chứng thư đã hết hạn")} value={d.certificates.expired} tone={d.certificates.expired ? "danger" : undefined} />
        <Stat label={tr("Hết hạn ≤ 7 ngày")} value={d.certificates.within7Days} tone={d.certificates.within7Days ? "danger" : undefined} />
        <Stat label={tr("≤ 14 ngày")} value={d.certificates.within14Days} tone={d.certificates.within14Days ? "warn" : undefined} />
        <Stat label={tr("≤ 30 ngày")} value={d.certificates.within30Days} />
        <Stat label={tr("Chưa rõ hạn")} value={d.certificates.unknownExpiry} hint={tr("Không coi là còn hạn")} />
      </StatRow>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={tr("Chứng thư theo binding")} aside={tr("Hạn do Worker quan sát")}>
          <ul className="divide-y divide-line/70">
            {d.certificates.items.map((c) => (
              <li key={c.bindingDigest} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] sm:px-5">
                <span className="font-mono text-[12px]">{c.bindingDigest}</span>
                <span className="text-[12px]">{fmtDateTime(c.certificateExpiresAt)}</span>
                <Badge tone={c.bucket === "EXPIRED" || c.bucket === "7_DAYS" ? "danger" : c.bucket === "14_DAYS" ? "warn" : "info"}>{c.daysLeft<0?tr("Quá hạn {p0} ngày",{p0:-c.daysLeft}):tr("còn {p0} ngày",{p0:c.daysLeft})}</Badge>
              </li>
            ))}
          </ul>
        </Section>
        <Section title={tr("Khóa ký Ed25519")} aside={tr("ACTIVE {p0} · chờ ledger {p1} · thu hồi {p2}", { p0: d.signingKeys.counts.ACTIVE, p1: d.signingKeys.counts.PENDING_LEDGER, p2: d.signingKeys.counts.REVOKED })}>
          {!d.signingKeys.expiryTracked && <p className="px-4 py-2.5 text-[12px] text-warn sm:px-5">{tr("Schema không có cột hết hạn cho khóa ký — chỉ theo dõi thu hồi (expiryTracked: false).")}</p>}
          <ul className="divide-y divide-line/70">
            {d.signingKeys.items.map((k) => (
              <li key={k.keyRef} className="flex flex-col gap-0.5 px-4 py-2.5 text-[13px] sm:px-5">
                <span className="flex justify-between gap-2"><span>{k.label}</span><span className="text-[12px] text-ink-2">{k.organization.name}</span></span>
                <span className="text-[12px] text-ink-2">{tr("thu hồi")} {fmtDateTime(k.revokedAt)} · {k.revokeReason}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <Section title={tr("Vân tay chứng thư đã duyệt")} aside={tr("đã duyệt {p0} · thu hồi {p1}", { p0: d.credentials.approved, p1: d.credentials.revoked })}>
        <ul className="divide-y divide-line/70">
          {d.credentials.items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px] sm:px-5">
              <span className="font-mono text-[12px]">{c.fingerprint}</span>
              <span className="text-[12px] text-ink-2">binding {c.bindingDigest} {tr("· thu hồi")} {fmtDateTime(c.revokedAt)}</span>
            </li>
          ))}
        </ul>
      </Section>
      <p className="text-[12px] text-ink-2">{tr("Chỉ trả 16 ký tự đầu của digest/vân tay; không có khóa công khai, chữ ký chứng minh sở hữu hay chứng thư.")}</p>
    </div>
  );
}

export function Monitoring() {
  const q = useQuery({ queryKey: ["monitoring"], queryFn: api.ops.monitoring });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  if (!d) return <LoadingRows />;
  return (
    <div className="flex flex-col gap-4">
      <StatRow>
        <Stat label="API uptime" value={fmtSeconds(d.api.uptimeSeconds)} />
        <Stat label="Node" value={<span className="text-[16px]">{d.api.node}</span>} />
        <Stat label="Heap / RSS" value={<span className="text-[16px]">{d.api.heapUsedMb} / {d.api.rssMb} MB</span>} />
        <Stat label={tr("Phiên hoạt động")} value={d.activeSessions} />
      </StatRow>
      <Section title={tr("Kiểm tra")} aside={tr("lúc {p0}", { p0: fmtDateTime(d.generatedAt) })}>
        <ul className="divide-y divide-line/70">
          {d.checks.map((c) => (
            <li key={c.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] sm:px-5">
              <span>{c.name}</span>
              <span className="flex items-center gap-3">
                <span className="max-w-[260px] truncate font-mono text-[12px] text-ink-2">{c.detail}</span>
                <Status group="check" value={c.status} />
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

export function Backup() {
  const q = useQuery({ queryKey: ["backup"], queryFn: api.ops.backup });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows />;
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <Callout tone={q.data.available ? "ok" : "warn"} title={q.data.available ? tr("Có biên nhận sao lưu") : tr("Chưa có biên nhận sao lưu")}>
        {q.data.note}
      </Callout>
      {q.data.receipt && (
        <Section title={tr("Biên nhận")}>
          <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-y-1.5 px-5 py-3 text-[13px]">
            {Object.entries(q.data.receipt).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-2">{k}</dt>
                <dd className="font-mono text-[12px]">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
      <ReadOnlyNote>{tr("API không chạy hay khôi phục sao lưu; chỉ đọc biên nhận do operator công bố vào tệp chỉ đọc.")}</ReadOnlyNote>
    </div>
  );
}

"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  CommandState,
  InfoDialog,
  LoadState,
  PageHeader,
} from "@/components/manage";
import {
  useWorkspaceCommand,
  useWorkspaceData,
  type Overview,
  type Row,
} from "@/lib/workspace";
import {
  buildInboxItems,
  inboxDate,
  inboxKindLabels,
  searchInbox,
  type InboxItem,
  type InboxKind,
  type InboxTasks,
} from "@/lib/inbox";
import {
  caseActionLabels,
  caseSeverityLabels,
  type EnterpriseCase,
} from "@/lib/platform-governance";
import { NOTIFICATIONS_CHANGED_EVENT } from "@/lib/task-labels";

function CaseReply({
  record,
  onSaved,
  onBusy,
}: {
  record: EnterpriseCase;
  onSaved(message: string): void;
  onBusy(id: string, busy: boolean): void;
}) {
  const command = useWorkspaceCommand();
  const inputId = useId();
  const [note, setNote] = useState("");
  const [validation, setValidation] = useState("");
  const [lastAction, setLastAction] = useState<"ACKNOWLEDGE" | "RESPOND">(
    "ACKNOWLEDGE",
  );
  const allowed = record.status === "CLOSED" ? [] : record.allowedActions;
  useEffect(() => {
    onBusy(record.id, command.pending || command.frozen);
    return () => onBusy(record.id, false);
  }, [record.id, command.pending, command.frozen, onBusy]);
  async function execute(action: "ACKNOWLEDGE" | "RESPOND") {
    const success = await command.run(
      `/enterprise-cases/${record.id}/${action === "ACKNOWLEDGE" ? "acknowledge" : "respond"}`,
      {
        version: record.version,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
    );
    if (success) {
      setNote("");
      onSaved(
        action === "ACKNOWLEDGE"
          ? `Đã xác nhận nhận hồ sơ #${record.caseNumber}.`
          : `Đã gửi phản hồi cho hồ sơ #${record.caseNumber}.`,
      );
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (command.pending || command.frozen) return;
    const clicked = (
      (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    )?.value;
    const action =
      clicked === "RESPOND"
        ? "RESPOND"
        : clicked === "ACKNOWLEDGE" || allowed.includes("ACKNOWLEDGE")
          ? "ACKNOWLEDGE"
          : "RESPOND";
    if (!allowed.includes(action)) return;
    if (action === "RESPOND" && note.trim().length < 10) {
      setValidation("Nội dung phản hồi cần ít nhất 10 ký tự.");
      return;
    }
    setValidation("");
    setLastAction(action);
    await execute(action);
  }
  if (!allowed.length && !command.frozen) return null;
  return (
    <form
      className="inbox-response"
      onSubmit={submit}
      aria-label={`Phản hồi hồ sơ #${record.caseNumber}`}
    >
      <label className="inbox-note" htmlFor={inputId}>
        <span className="sr-only">
          Ghi chú hoặc phản hồi cho hồ sơ #{record.caseNumber}
        </span>
        <Input
          id={inputId}
          className="input"
          value={note}
          maxLength={2000}
          disabled={command.pending || command.frozen}
          placeholder="Ghi chú / phản hồi…"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {command.frozen ? (
        <Button
          className="button"
          type="button"
          disabled={command.pending}
          onClick={() => void execute(lastAction)}
        >
          {command.pending ? "Đang đối soát…" : "Thử lại yêu cầu cũ"}
        </Button>
      ) : (
        <>
          {allowed.includes("ACKNOWLEDGE") && (
            <Button
              className="button secondary"
              type="submit"
              value="ACKNOWLEDGE"
              disabled={command.pending}
            >
              Xác nhận đã nhận
            </Button>
          )}
          {allowed.includes("RESPOND") && (
            <Button
              className="button"
              type="submit"
              value="RESPOND"
              disabled={command.pending}
            >
              Gửi phản hồi
            </Button>
          )}
        </>
      )}
      {validation && (
        <p className="notice error" role="alert">
          {validation}
        </p>
      )}
      <CommandState command={command} />
    </form>
  );
}

function InboxCard({
  item,
  hidden,
  permissions,
  onCaseSaved,
  onBusy,
}: {
  item: InboxItem;
  hidden: boolean;
  permissions: string[];
  onCaseSaved(message: string): void;
  onBusy(id: string, busy: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  const record = item.caseRecord;
  const mayReadLot = [
    "trace.read",
    "production.read",
    "distribution.read",
  ].some((permission) => permissions.includes(permission));
  const mayManageStock = ["inventory.manage", "quarantine.manage"].some(
    (permission) => permissions.includes(permission),
  );
  const href =
    item.kind === "stock" && !mayManageStock
      ? permissions.includes("reports.read")
        ? "/enterprise/reports"
        : undefined
      : item.href;
  const linkLabel =
    item.kind === "stock" && !mayManageStock
      ? "Mở báo cáo tồn kho"
      : item.linkLabel;
  const relatedHref = mayReadLot ? item.relatedHref : undefined;
  const warning =
    item.overdue ||
    item.priority === "HIGH" ||
    item.priority === "CRITICAL" ||
    item.status === "stock:RECALL" ||
    item.status === "stock:EXPIRED";
  return (
    <article
      className={`inbox-card inbox-card-${item.kind}`}
      hidden={hidden}
      aria-label={item.title}
    >
      <div className="inbox-card-body">
        <div className="inbox-card-summary">
          <span className={`inbox-category inbox-category-${item.kind}`}>
            {inboxKindLabels[item.kind]}
          </span>
          <div className="inbox-card-title">
            <h2>{item.title}</h2>
            <span
              className={`inbox-status${warning ? " inbox-status-warning" : ""}`}
            >
              {item.overdue ? "Quá hạn phản hồi" : item.statusLabel}
            </span>
          </div>
          <p>{item.description}</p>
          {record?.responseDueAt && (
            <p
              className={
                item.overdue ? "inbox-deadline inbox-overdue" : "inbox-deadline"
              }
            >
              Hạn phản hồi: {inboxDate(record.responseDueAt)}
            </p>
          )}
        </div>
        <dl className="inbox-card-metadata">
          {item.metadata.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value || "Chưa ghi nhận"}</dd>
            </div>
          ))}
        </dl>
      </div>
      <footer className="inbox-card-actions">
        <Button
          className="button secondary"
          type="button"
          onClick={() => setOpen(true)}
        >
          Xem chi tiết
        </Button>
        {record ? (
          <CaseReply record={record} onSaved={onCaseSaved} onBusy={onBusy} />
        ) : (
          href && (
            <Link className="button" href={href}>
              {linkLabel}
            </Link>
          )
        )}
      </footer>
      <InfoDialog
        open={open}
        title={item.title}
        rows={item.details}
        onClose={() => setOpen(false)}
        actions={
          <>
            <Button
              className="button secondary"
              type="button"
              onClick={() => setOpen(false)}
            >
              Đóng
            </Button>
            {relatedHref && (
              <Link className="button secondary" href={relatedHref}>
                {item.relatedLabel}
              </Link>
            )}
            {href && (
              <Link className="button" href={href}>
                {linkLabel}
              </Link>
            )}
          </>
        }
      >
        <section className="inbox-detail-section">
          <h3>Nội dung công việc</h3>
          <p>{item.description || "Chưa có ghi chú."}</p>
        </section>
        {record && (
          <section className="inbox-detail-section">
            <h3>Lịch sử trao đổi</h3>
            {record.events.length ? (
              <ol className="inbox-history">
                {record.events.map((event) => (
                  <li key={event.id}>
                    <div>
                      <strong>
                        {caseActionLabels[event.action] ?? event.action}
                      </strong>
                      <time dateTime={event.createdAt}>
                        {inboxDate(event.createdAt)}
                      </time>
                    </div>
                    <p>{event.note}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p>Chưa có trao đổi.</p>
            )}
          </section>
        )}
      </InfoDialog>
    </article>
  );
}

type Tab = "all" | InboxKind | "closed";
const tabs: { key: Tab; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "transfer", label: "Giao nhận chờ bạn" },
  { key: "case", label: "Yêu cầu từ nền tảng" },
  { key: "stock", label: "Lô cần xử lý" },
  { key: "ownership", label: "Chuyển quyền" },
  { key: "closed", label: "Đã đóng" },
];

export function InboxWorkspace() {
  const overview = useWorkspaceData<Overview>("/enterprise-workspace");
  const tasks = useWorkspaceData<InboxTasks>("/distribution/tasks");
  const ownership = useWorkspaceData<{ items: Row[] }>(
    "/enterprise-workspace/ownership-transfers",
  );
  const canReadCases = !!overview.data?.permissions.includes("cases.read");
  const cases = useWorkspaceData<EnterpriseCase[]>(
    canReadCases ? "/enterprise-cases" : null,
  );
  const [tab, setTab] = useState<Tab>("all"),
    [status, setStatus] = useState("ALL"),
    [priority, setPriority] = useState("ALL"),
    [search, setSearch] = useState("");
  const [message, setMessage] = useState(""),
    [loadedAt, setLoadedAt] = useState("");
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const items = useMemo(
    () =>
      buildInboxItems({
        tasks: tasks.data,
        ownership: ownership.data?.items ?? [],
        memberId: overview.data?.member.id,
        cases: canReadCases ? (cases.data ?? []) : [],
      }),
    [
      tasks.data,
      ownership.data,
      overview.data?.member.id,
      canReadCases,
      cases.data,
    ],
  );
  const sources = [
    { label: "Thông tin tài khoản", ...overview },
    { label: "Giao nhận và tồn kho", ...tasks },
    { label: "Chuyển quyền", ...ownership },
    ...(canReadCases ? [{ label: "Hồ sơ từ nền tảng", ...cases }] : []),
  ];
  const loading = sources.some((source) => source.loading),
    errors = sources.filter((source) => source.error),
    complete =
      !loading &&
      !errors.length &&
      !!overview.data &&
      !!tasks.data &&
      !!ownership.data &&
      (!canReadCases || cases.data !== null);
  useEffect(() => {
    if (complete) setLoadedAt(inboxDate(new Date().toISOString()));
  }, [complete, tasks.data, ownership.data, cases.data]);
  const onBusy = useCallback(
    (id: string, blocked: boolean) =>
      setBusy((current) => {
        if (current.has(id) === blocked) return current;
        const next = new Set(current);
        if (blocked) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  const reloadCases = cases.reload;
  const onCaseSaved = useCallback(
    (notice: string) => {
      setMessage(notice);
      reloadCases();
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
    },
    [reloadCases],
  );
  const openItems = items.filter((item) => !item.closed),
    closed = items.filter((item) => item.closed);
  const toRespond = openItems.filter(
    (item) =>
      item.kind === "ownership" ||
      item.caseRecord?.allowedActions.includes("RESPOND"),
  );
  const statuses = [
    ...new Map(
      items
        .filter((item) =>
          tab === "closed"
            ? item.closed
            : !item.closed && (tab === "all" || tab === item.kind),
        )
        .map((item) => [item.status, item.statusLabel]),
    ).entries(),
  ];
  const matches = (item: InboxItem) =>
    (tab === "closed"
      ? item.closed
      : !item.closed && (tab === "all" || tab === item.kind)) &&
    (status === "ALL" ||
      (status === "OVERDUE" ? item.overdue : item.status === status)) &&
    (priority === "ALL" || item.priority === priority) &&
    searchInbox(item, search);
  const visible = items.filter(matches);
  function reload() {
    if (busy.size) return;
    overview.reload();
    tasks.reload();
    ownership.reload();
    cases.reload();
  }
  function clearFilters() {
    setTab("all");
    setStatus("ALL");
    setPriority("ALL");
    setSearch("");
  }
  return (
    <div className="manage-console inbox-workspace">
      <div className="inbox-heading">
        <PageHeader
          back="/enterprise"
          backLabel="Doanh nghiệp"
          title="Hộp công việc"
        />
        <div className="inbox-refresh">
          {loadedAt && <span>Tải dữ liệu lúc {loadedAt}</span>}
          <Button
            className="button secondary"
            type="button"
            disabled={loading || busy.size > 0}
            onClick={reload}
          >
            {loading ? "Đang tải…" : "Tải lại"}
          </Button>
        </div>
      </div>
      <section className="inbox-stats" aria-label="Thống kê công việc">
        <div>
          <h2>Chờ xử lý</h2>
          <strong>{complete ? openItems.length : "—"}</strong>
          <p>Công việc đang mở trong phạm vi của bạn</p>
        </div>
        <div className="inbox-stat-response">
          <h2>Cần phản hồi</h2>
          <strong>{complete ? toRespond.length : "—"}</strong>
          <p>Hồ sơ và yêu cầu đang chờ bạn phản hồi</p>
        </div>
        <div>
          <h2>Hồ sơ đã đóng</h2>
          <strong>{complete ? closed.length : "—"}</strong>
          <p>Hồ sơ từ nền tảng đã kết thúc</p>
        </div>
      </section>
      <div className="inbox-toolbar">
        <div className="inbox-tabs" role="group" aria-label="Loại công việc">
          {tabs
            .filter(
              (entry) =>
                entry.key === "all" ||
                (entry.key === "closed" && canReadCases) ||
                items.some((item) => item.kind === entry.key),
            )
            .map((entry) => {
              const count =
                entry.key === "all"
                  ? openItems.length
                  : entry.key === "closed"
                    ? closed.length
                    : openItems.filter((item) => item.kind === entry.key)
                        .length;
              return (
                <Button
                  type="button"
                  key={entry.key}
                  aria-pressed={tab === entry.key}
                  onClick={() => {
                    setTab(entry.key);
                    setStatus("ALL");
                  }}
                >
                  {entry.label} <span>({count})</span>
                </Button>
              );
            })}
        </div>
        <div className="inbox-filters">
          <NativeSelect
            className="input"
            aria-label="Lọc trạng thái công việc"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="ALL">Tất cả trạng thái</option>
            <option value="OVERDUE">Quá hạn phản hồi</option>
            {statuses.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            className="input"
            aria-label="Lọc mức ưu tiên"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <option value="ALL">Tất cả mức ưu tiên</option>
            {Object.entries(caseSeverityLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
            <option value="NONE">Chưa phân mức</option>
          </NativeSelect>
          <Input
            className="input"
            type="search"
            aria-label="Tìm kiếm công việc"
            placeholder="Tìm kiếm công việc…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {busy.size > 0 && (
        <p className="notice" role="status">
          Có yêu cầu đang gửi hoặc cần đối soát. Giữ trang này để hoàn tất yêu
          cầu cũ.
        </p>
      )}
      {loading && <LoadState loading error="" />}
      {errors.map((source) => (
        <p className="notice error" role="alert" key={source.label}>
          {source.label}: {source.error}
        </p>
      ))}
      <p className="inbox-result-count" role="status" aria-live="polite">
        {loading
          ? "Đang tải công việc…"
          : `${visible.length} công việc${errors.length ? " · Dữ liệu chưa đầy đủ" : ""}`}
      </p>
      {!loading && !visible.length && (
        <div className="inbox-empty">
          <h2>
            {items.length
              ? "Không có công việc phù hợp"
              : errors.length
                ? "Chưa tải đủ công việc"
                : "Chưa có công việc đang chờ"}
          </h2>
          <p>
            {items.length
              ? "Thử đổi trạng thái, mức ưu tiên hoặc từ khóa tìm kiếm."
              : errors.length
                ? "Bấm Tải lại để kiểm tra các nguồn dữ liệu bị lỗi."
                : "Các việc được giao sẽ xuất hiện tại đây."}
          </p>
          {items.length > 0 && (
            <Button
              className="button secondary"
              type="button"
              onClick={clearFilters}
            >
              Xóa bộ lọc
            </Button>
          )}
        </div>
      )}
      <div className="inbox-list">
        {items.map((item) => (
          <InboxCard
            key={item.key}
            item={item}
            hidden={!matches(item)}
            permissions={overview.data?.permissions ?? []}
            onCaseSaved={onCaseSaved}
            onBusy={onBusy}
          />
        ))}
      </div>
    </div>
  );
}

"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import {
  formatAge,
  formatDateTime,
  type CredentialsOverview,
  type OperationsSummary,
} from "@/lib/platform-governance";
import { errorMessage } from "@/lib/workspace";
import { EmptyState, PageHeader, ReloadButton } from "@/components/manage";

type Section =
  | "outbox"
  | "holds"
  | "ledger-jobs"
  | "binding-health"
  | "credentials"
  | "mail";
type Row = Record<string, unknown> & { id?: string };
type Page = { items: Row[]; nextCursor: string | null };
type Named = { id: string; name: string };

const sections: { key: Section; label: string }[] = [
  { key: "outbox", label: "Hàng đợi ghi sổ cái" },
  { key: "holds", label: "Hold giao nhận" },
  { key: "ledger-jobs", label: "Tác vụ điều khiển sổ cái" },
  { key: "binding-health", label: "Sức khỏe kết nối" },
  { key: "credentials", label: "Chứng thư & khóa ký" },
  { key: "mail", label: "Hàng đợi thư" },
];
const statusOptions: Partial<Record<Section, [string, string][]>> = {
  outbox: [
    ["", "Cần xử lý (mặc định)"],
    ["PENDING", "Chờ gửi"],
    ["PROCESSING", "Đang xử lý"],
    ["RETRY", "Đang thử lại"],
    ["DEAD_LETTER", "Dead-letter"],
    ["COMPLETED", "Đã xong"],
  ],
  "ledger-jobs": [
    ["", "Cần xử lý (mặc định)"],
    ["FAILED", "Lỗi"],
    ["PENDING", "Chờ"],
    ["PROCESSING", "Đang xử lý"],
    ["COMPLETED", "Đã xong"],
  ],
  mail: [
    ["", "Chờ gửi (mặc định)"],
    ["RETRYING", "Đã thử lỗi"],
    ["SENT", "Đã gửi"],
    ["CANCELLED", "Đã hủy"],
  ],
};

function filterQuery(
  chainId: string,
  organizationId: string,
  status: string,
  cursor?: string,
) {
  const params = new URLSearchParams();
  if (chainId) params.set("chainId", chainId);
  if (organizationId) params.set("organizationId", organizationId);
  if (status) params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  const text = params.toString();
  return text ? `?${text}` : "";
}

const text = (value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : String(value);
const when = (value: unknown) =>
  typeof value === "string" ? formatDateTime(value) : "—";
const age = (value: unknown) =>
  typeof value === "number" ? formatAge(value) : "—";
const orgName = (value: unknown) =>
  value && typeof value === "object" && "name" in value
    ? String((value as { name: unknown }).name)
    : "—";

export default function OperationsPage() {
  const auth = useAuth();
  const userId = auth.user?.id;
  const [chainId, setChainId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [chains, setChains] = useState<Named[]>([]);
  const [organizations, setOrganizations] = useState<Named[]>([]);
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [credentials, setCredentials] = useState<CredentialsOverview | null>(
    null,
  );
  const [summaryError, setSummaryError] = useState("");
  const [section, setSection] = useState<Section>("outbox");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);

  useEffect(() => {
    if (!userId) return;
    // Filter choices are a convenience; the dashboard works without them.
    request<Named[]>("/supply-chains")
      .then(setChains)
      .catch(() => setChains([]));
    request<(Named & { type: string })[]>("/organizations")
      .then((list) =>
        setOrganizations(list.filter((o) => o.type !== "AUDITOR")),
      )
      .catch(() => setOrganizations([]));
  }, [userId]);

  const loadSummary = useCallback(async () => {
    setSummaryError("");
    try {
      const query = filterQuery(chainId, organizationId, "");
      const [overview, certificates] = await Promise.all([
        request<OperationsSummary>(`/platform-operations/summary${query}`),
        request<CredentialsOverview>(
          `/platform-operations/credentials${query}`,
        ),
      ]);
      setSummary(overview);
      setCredentials(certificates);
    } catch (cause) {
      setSummaryError(errorMessage(cause));
    }
  }, [chainId, organizationId]);

  const loadRows = useCallback(
    async (cursor?: string) => {
      if (section === "credentials") {
        // Rendered from the credentials overview, not a paged list.
        setRows([]);
        setNext(null);
        setLoading(false);
        return;
      }
      const run = ++generation.current;
      setLoading(true);
      setError("");
      try {
        const page = await request<Page>(
          `/platform-operations/${section}${filterQuery(chainId, organizationId, status, cursor)}`,
        );
        if (run !== generation.current) return;
        setRows((current) =>
          cursor ? [...current, ...page.items] : page.items,
        );
        setNext(page.nextCursor);
      } catch (cause) {
        if (run === generation.current) setError(errorMessage(cause));
      } finally {
        if (run === generation.current) setLoading(false);
      }
    },
    [section, chainId, organizationId, status],
  );

  useEffect(() => {
    if (userId) void loadSummary();
  }, [loadSummary, userId]);
  useEffect(() => {
    if (userId) void loadRows();
  }, [loadRows, userId]);

  const refresh = () => {
    void loadSummary();
    void loadRows();
  };
  const filtered = !!chainId || !!organizationId;
  const unscoped = (scopedBy: string[]) =>
    filtered &&
    ((chainId && !scopedBy.includes("chain")) ||
      (organizationId && !scopedBy.includes("organization")));
  const unfinishedOutbox = summary
    ? summary.outbox.counts.PENDING +
      summary.outbox.counts.PROCESSING +
      summary.outbox.counts.RETRY
    : 0;
  const metrics = summary
    ? [
        {
          label: "Ghi sổ cái chưa xong",
          value: unfinishedOutbox,
          hint: `${summary.outbox.counts.DEAD_LETTER} dead-letter · ${summary.outbox.overdue} quá hạn · cũ nhất ${age(summary.outbox.oldestUnfinishedAgeSeconds)}`,
          alert: summary.outbox.counts.DEAD_LETTER > 0,
          scopedBy: summary.outbox.scopedBy,
        },
        {
          label: "Hold giao nhận đang mở",
          value: summary.holds.open,
          hint: `Cũ nhất ${age(summary.holds.oldestOpenAgeSeconds)}`,
          alert: summary.holds.open > 0,
          scopedBy: summary.holds.scopedBy,
        },
        {
          label: "Tác vụ sổ cái lỗi",
          value: summary.ledgerJobs.counts.FAILED,
          hint: `${summary.ledgerJobs.counts.PENDING + summary.ledgerJobs.counts.PROCESSING} đang chờ/xử lý`,
          alert: summary.ledgerJobs.counts.FAILED > 0,
          scopedBy: summary.ledgerJobs.scopedBy,
        },
        {
          label: "Kết nối bất thường",
          value: summary.bindingHealth.unhealthy,
          hint: `Trên ${summary.bindingHealth.total} kết nối`,
          alert: summary.bindingHealth.unhealthy > 0,
          scopedBy: summary.bindingHealth.scopedBy,
        },
        {
          label: "Thư chờ gửi",
          value: summary.mail.counts.PENDING,
          hint: `${summary.mail.retrying} đã thử lỗi · ${summary.mail.overdue} quá hạn`,
          alert: summary.mail.retrying > 0,
          scopedBy: summary.mail.scopedBy,
        },
        {
          label: "Phiên đang hoạt động",
          value: summary.accounts.activeSessions,
          hint: `${summary.accounts.lockedAccounts} khóa tạm · ${summary.accounts.disabledAccounts} vô hiệu hóa`,
          alert: summary.accounts.lockedAccounts > 0,
          scopedBy: summary.accounts.scopedBy,
        },
        ...(credentials
          ? [
              {
                label: "Chứng thư cần chú ý",
                value:
                  credentials.certificates.expired +
                  credentials.certificates.within7Days,
                hint: `${credentials.certificates.expired} đã hết hạn · ${credentials.certificates.within14Days} còn ≤ 14 ngày · ${credentials.certificates.within30Days} còn ≤ 30 ngày`,
                alert:
                  credentials.certificates.expired +
                    credentials.certificates.within7Days >
                  0,
                scopedBy: credentials.certificates.scopedBy,
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className="manage-console">
      <PageHeader
        title="Vận hành hệ thống"
        description="Bức tranh chỉ đọc về hàng đợi ghi sổ cái, hold, tác vụ điều khiển, kết nối Fabric, thư và phiên. Không có thao tác sửa hay thử lại tại đây."
        back="/admin"
      />
      <section className="manage-section" aria-label="Bộ lọc vận hành">
        <div className="manage-filter-bar manage-audit-filters">
          <NativeSelect
            className="manage-filter-select"
            aria-label="Lọc theo chuỗi"
            value={chainId}
            onChange={(event) => setChainId(event.target.value)}
          >
            <option value="">Mọi chuỗi</option>
            {chains.map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            className="manage-filter-select"
            aria-label="Lọc theo tổ chức"
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
          >
            <option value="">Mọi tổ chức</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </NativeSelect>
          <ReloadButton onClick={refresh} />
        </div>
        <div className="manage-results-summary" role="status">
          {summary
            ? `Cập nhật lúc ${formatDateTime(summary.generatedAt)}`
            : "Đang tải số liệu…"}
        </div>
      </section>
      {summaryError && (
        <p className="notice error" role="alert">
          {summaryError}
        </p>
      )}
      {summary && (
        <div
          className="manage-metrics manage-metrics--ops"
          aria-label="Chỉ số vận hành"
        >
          {metrics.map((metric) => (
            <div
              className={`manage-metric${metric.alert ? " manage-metric--alert" : ""}`}
              key={metric.label}
            >
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.hint}</small>
              {unscoped(metric.scopedBy) && (
                <small className="manage-metric-note">
                  Không lọc được theo bộ lọc này: số liệu toàn nền tảng
                </small>
              )}
            </div>
          ))}
        </div>
      )}
      <section className="manage-section" aria-label="Chi tiết vận hành">
        <div
          className="manage-filter-tabs"
          role="group"
          aria-label="Nhóm chi tiết"
        >
          {sections.map((item) => (
            <Button
              type="button"
              key={item.key}
              aria-pressed={section === item.key}
              onClick={() => {
                setSection(item.key);
                setStatus("");
                setRows([]);
                setNext(null);
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
        {statusOptions[section] && (
          <div className="manage-filter-bar">
            <NativeSelect
              className="manage-filter-select"
              aria-label="Lọc trạng thái"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {statusOptions[section]!.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div className="manage-results-summary" role="status">
          {loading && !rows.length
            ? "Đang tải…"
            : section === "credentials"
              ? "Chỉ đọc · chứng thư hết hạn trong 30 ngày tới và các mục đã thu hồi"
              : `${rows.length} mục${next ? " (còn nữa)" : ""}`}
        </div>
        {section === "credentials" ? (
          credentials && <CredentialsPanel data={credentials} />
        ) : rows.length ? (
          <div className="manage-table-scroll">
            <Table className="manage-table">
              <OperationsTable section={section} rows={rows} />
            </Table>
          </div>
        ) : (
          !loading &&
          !error && (
            <EmptyState
              title="Không có mục nào"
              description="Không có mục phù hợp bộ lọc hiện tại."
            />
          )
        )}
        {next && (
          <Button
            className="manage-section-footer"
            type="button"
            disabled={loading}
            onClick={() => void loadRows(next)}
          >
            {loading ? "Đang tải…" : "Tải thêm"}
          </Button>
        )}
      </section>
    </div>
  );
}

function OperationsTable({ section, rows }: { section: Section; rows: Row[] }) {
  if (section === "outbox")
    return (
      <>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Sự kiện</TableHead>
            <TableHead scope="col">Trạng thái</TableHead>
            <TableHead scope="col">Số lần thử</TableHead>
            <TableHead scope="col">Lần thử tới</TableHead>
            <TableHead scope="col">Tuổi</TableHead>
            <TableHead scope="col">Tổ chức / chuỗi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={String(row.id)}>
              <TableCell data-label="Sự kiện">
                <strong>{text(row.eventType)}</strong>
                <small>{text(row.lastError)}</small>
              </TableCell>
              <TableCell data-label="Trạng thái">
                {text(row.status)}
                {row.leased === true && <small>Đang được Worker giữ</small>}
              </TableCell>
              <TableCell data-label="Số lần thử">{text(row.attemptCount)}</TableCell>
              <TableCell data-label="Lần thử tới">{when(row.nextAttemptAt)}</TableCell>
              <TableCell data-label="Tuổi">{age(row.ageSeconds)}</TableCell>
              <TableCell data-label="Tổ chức / chuỗi">
                {orgName(row.organization)}
                <small>{text(row.chainName)}</small>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </>
    );
  if (section === "holds")
    return (
      <>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Phạm vi</TableHead>
            <TableHead scope="col">Lý do</TableHead>
            <TableHead scope="col">Mở lúc</TableHead>
            <TableHead scope="col">Tuổi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={String(row.id)}>
              <TableCell data-label="Phạm vi">{text(row.scope)}</TableCell>
              <TableCell data-label="Lý do">{text(row.reason)}</TableCell>
              <TableCell data-label="Mở lúc">{when(row.openedAt)}</TableCell>
              <TableCell data-label="Tuổi">{age(row.ageSeconds)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </>
    );
  if (section === "ledger-jobs")
    return (
      <>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Tác vụ</TableHead>
            <TableHead scope="col">Trạng thái</TableHead>
            <TableHead scope="col">Số lần thử</TableHead>
            <TableHead scope="col">Lần thử tới</TableHead>
            <TableHead scope="col">Tuổi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={String(row.id)}>
              <TableCell data-label="Tác vụ">
                <strong>{text(row.operation)}</strong>
                <small>{text(row.lastError)}</small>
              </TableCell>
              <TableCell data-label="Trạng thái">{text(row.status)}</TableCell>
              <TableCell data-label="Số lần thử">{text(row.attemptCount)}</TableCell>
              <TableCell data-label="Lần thử tới">{when(row.nextAttemptAt)}</TableCell>
              <TableCell data-label="Tuổi">{age(row.ageSeconds)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </>
    );
  if (section === "binding-health")
    return (
      <>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Kết nối</TableHead>
            <TableHead scope="col">Kiểm tra gần nhất</TableHead>
            <TableHead scope="col">Khỏe gần nhất</TableHead>
            <TableHead scope="col">Lỗi</TableHead>
            <TableHead scope="col">Chứng thư hết hạn</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={String(row.bindingDigest)}>
              <TableCell data-label="Kết nối">
                <strong>{text(row.bindingDigest)}…</strong>
                {row.stale === true && (
                  <small>Quá lâu chưa được kiểm tra</small>
                )}
              </TableCell>
              <TableCell data-label="Kiểm tra gần nhất">{when(row.lastCheckedAt)}</TableCell>
              <TableCell data-label="Khỏe gần nhất">{when(row.lastHealthyAt)}</TableCell>
              <TableCell data-label="Lỗi">{text(row.lastErrorCode)}</TableCell>
              <TableCell data-label="Chứng thư hết hạn">
                {when(row.certificateExpiresAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </>
    );
  return (
    <>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Loại thư</TableHead>
          <TableHead scope="col">Trạng thái</TableHead>
          <TableHead scope="col">Số lần thử</TableHead>
          <TableHead scope="col">Lần thử tới</TableHead>
          <TableHead scope="col">Tuổi</TableHead>
          <TableHead scope="col">Tổ chức</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={String(row.id)}>
            <TableCell data-label="Loại thư">{text(row.kind)}</TableCell>
            <TableCell data-label="Trạng thái">{text(row.status)}</TableCell>
            <TableCell data-label="Số lần thử">{text(row.attempts)}</TableCell>
            <TableCell data-label="Lần thử tới">{when(row.nextAttemptAt)}</TableCell>
            <TableCell data-label="Tuổi">{age(row.ageSeconds)}</TableCell>
            <TableCell data-label="Tổ chức">{orgName(row.organization)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </>
  );
}

function CredentialsPanel({ data }: { data: CredentialsOverview }) {
  const cert = data.certificates;
  const bands: [string, number][] = [
    ["Đã hết hạn", cert.expired],
    ["Còn ≤ 7 ngày", cert.within7Days],
    ["Còn ≤ 14 ngày", cert.within14Days],
    ["Còn ≤ 30 ngày", cert.within30Days],
  ];
  const bandLabel: Record<string, string> = {
    EXPIRED: "Đã hết hạn",
    "7_DAYS": "≤ 7 ngày",
    "14_DAYS": "≤ 14 ngày",
    "30_DAYS": "≤ 30 ngày",
  };
  return (
    <div className="manage-credentials">
      <p className="manage-section-help">
        Ngày hết hạn chứng thư lấy từ lần kiểm tra gần nhất của Worker trên từng
        kết nối. Vân tay chứng thư đã duyệt và khóa ký Ed25519{" "}
        {data.signingKeys.expiryTracked
          ? ""
          : "chưa có ngày hết hạn trong hệ thống nên "}
        chỉ hiện thông tin thu hồi. Chỉ đọc: thu hồi hay thay chứng thư do
        operator thực hiện theo runbook.
      </p>
      <ul className="manage-band-list" aria-label="Phân nhóm hạn chứng thư">
        {bands.map(([label, count]) => (
          <li key={label} data-alert={count > 0 ? "true" : undefined}>
            <strong>{count}</strong> {label}
          </li>
        ))}
        {cert.unknownExpiry > 0 && (
          <li>
            <strong>{cert.unknownExpiry}</strong> chưa báo ngày hết hạn
          </li>
        )}
      </ul>
      <h3>Chứng thư hết hạn hoặc sắp hết hạn (30 ngày)</h3>
      {cert.items.length ? (
        <div className="manage-table-scroll">
          <Table className="manage-table">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Kết nối</TableHead>
                <TableHead scope="col">Hết hạn</TableHead>
                <TableHead scope="col">Còn lại</TableHead>
                <TableHead scope="col">Nhóm</TableHead>
                <TableHead scope="col">Kiểm tra gần nhất</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cert.items.map((item) => (
                <TableRow key={item.bindingDigest}>
                  <TableCell data-label="Kết nối">{item.bindingDigest}…</TableCell>
                  <TableCell data-label="Hết hạn">
                    {when(item.certificateExpiresAt)}
                  </TableCell>
                  <TableCell data-label="Còn lại">
                    {item.daysLeft < 0
                      ? `Quá hạn ${-item.daysLeft} ngày`
                      : `${item.daysLeft} ngày`}
                  </TableCell>
                  <TableCell data-label="Nhóm">
                    {bandLabel[item.bucket] ?? item.bucket}
                  </TableCell>
                  <TableCell data-label="Kiểm tra gần nhất">
                    {when(item.lastCheckedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title="Không có chứng thư sắp hết hạn"
          description="Mọi chứng thư đã báo đều còn hạn hơn 30 ngày."
        />
      )}
      <h3>
        Chứng thư đã thu hồi ({data.credentials.revoked}) · đang duyệt{" "}
        {data.credentials.approved}
      </h3>
      {data.credentials.items.length > 0 && (
        <div className="manage-table-scroll">
          <Table className="manage-table">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Kết nối</TableHead>
                <TableHead scope="col">Vân tay (đầu)</TableHead>
                <TableHead scope="col">Thu hồi lúc</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.credentials.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell data-label="Kết nối">{item.bindingDigest}…</TableCell>
                  <TableCell data-label="Vân tay (đầu)">{item.fingerprint}…</TableCell>
                  <TableCell data-label="Thu hồi lúc">{when(item.revokedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <h3>
        Khóa ký ({data.signingKeys.counts.ACTIVE} đang dùng ·{" "}
        {data.signingKeys.counts.PENDING_LEDGER} chờ sổ cái ·{" "}
        {data.signingKeys.counts.REVOKED} đã thu hồi)
      </h3>
      {data.signingKeys.items.length > 0 && (
        <div className="manage-table-scroll">
          <Table className="manage-table">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Khóa</TableHead>
                <TableHead scope="col">Tổ chức</TableHead>
                <TableHead scope="col">Thu hồi lúc</TableHead>
                <TableHead scope="col">Lý do</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.signingKeys.items.map((item) => (
                <TableRow key={item.keyRef}>
                  <TableCell data-label="Khóa">{item.label}</TableCell>
                  <TableCell data-label="Tổ chức">{orgName(item.organization)}</TableCell>
                  <TableCell data-label="Thu hồi lúc">{when(item.revokedAt)}</TableCell>
                  <TableCell data-label="Lý do">{text(item.revokeReason)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

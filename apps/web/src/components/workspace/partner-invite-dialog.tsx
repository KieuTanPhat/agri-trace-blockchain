"use client";
import Link from "next/link";
import { useState } from "react";
import { CommandState, InfoDialog, LoadState } from "@/components/manage";
import { labels, useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import type { components } from "@/lib/generated/api";
import { PartnerMatches, usePartnerSearch, type PartnerMatch } from "./partner-lookup";

type Profile = components["schemas"]["PartnerDirectoryProfileDto"];
const linkLabel: Record<string, string> = {
  INVITED: "Đang chờ chấp nhận",
  ACTIVE: "Đã liên kết",
  REJECTED: "Đã từ chối",
  REVOKED: "Đã thu hồi",
};

/** Invite an AgriTrace enterprise from the partner list without leaving it:
 * search, read the enterprise's business profile, then send the invitation. */
export function PartnerInviteDialog({ open, onClose, onInvited }: { open: boolean; onClose: () => void; onInvited: () => void }) {
  const command = useWorkspaceCommand();
  const [query, setQuery] = useState("");
  const search = usePartnerSearch(open ? query : "");
  const [viewing, setViewing] = useState<PartnerMatch | null>(null);
  const [inviting, setInviting] = useState<PartnerMatch | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const profile = useWorkspaceData<Profile>(viewing ? `/enterprise-workspace/partners/directory/${viewing.id}` : null);
  const busy = profile.data?.linkStatus === "INVITED" || profile.data?.linkStatus === "ACTIVE";

  function close() {
    setQuery("");
    setViewing(null);
    setInviting(null);
    setNote("");
    setSent(null);
    onClose();
  }
  async function invite() {
    if (!inviting) return;
    const result = await command.run(
      "/enterprise-workspace/partners",
      { businessId: inviting.agriTraceCode ?? inviting.businessId, ...(note.trim() ? { note: note.trim() } : {}) },
      "POST",
      { confirmed: true },
    );
    if (!result) return;
    setSent(inviting.name);
    setInviting(null);
    setViewing(null);
    setNote("");
    onInvited();
  }

  const value = (v: string | null | undefined) => v || "—";
  return (
    <InfoDialog
      open={open}
      title={inviting ? "Gửi lời mời liên kết" : viewing ? "Hồ sơ doanh nghiệp" : "Mời doanh nghiệp liên kết"}
      rows={[]}
      onClose={close}
      actions={
        <button type="button" className="button secondary" disabled={command.pending} onClick={close}>
          Đóng
        </button>
      }
    >
      <div className="partner-invite">
        <CommandState command={command} />
        {sent && <p className="notice" role="status">Đã gửi lời mời tới {sent}. Liên kết hoạt động khi doanh nghiệp đó chấp nhận.</p>}

        {inviting ? (
          <div className="workspace-form">
            <div className="partner-picked">
              <div>
                <strong>{inviting.name}</strong>
                <small>
                  MST {inviting.taxCode ?? "—"} · {inviting.agriTraceCode} · {labels[inviting.kind] ?? inviting.kind}
                </small>
              </div>
              <button type="button" className="text-link" onClick={() => setInviting(null)}>
                Quay lại
              </button>
            </div>
            <label>
              Lời nhắn (không bắt buộc)
              <textarea className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <p className="notice">Doanh nghiệp được mời cần chấp nhận lời mời. Liên kết không tự cấp quyền vào chuỗi.</p>
            <div className="dialog-actions">
              <button type="button" className="button" disabled={command.pending} onClick={() => void invite()}>
                {command.pending ? "Đang gửi…" : "Gửi lời mời"}
              </button>
            </div>
          </div>
        ) : viewing ? (
          <div className="workspace-form">
            <LoadState {...profile} />
            {profile.data && (
              <>
                <dl className="detail-grid">
                  {(
                    [
                      ["Tên doanh nghiệp", profile.data.name],
                      ["Mã AgriTrace", profile.data.agriTraceCode],
                      ["Mã số thuế", value(profile.data.taxCode)],
                      ["Loại hình", labels[profile.data.kind] ?? profile.data.kind],
                      ["Năng lực đã duyệt", profile.data.capabilities.map((c) => labels[c] ?? c).join(", ") || "—"],
                      ["Người đại diện", value(profile.data.representative)],
                      ["Điện thoại", value(profile.data.phone)],
                      ["Email liên hệ", value(profile.data.contactEmail)],
                      ["Địa chỉ", [profile.data.address, profile.data.ward, profile.data.province].filter(Boolean).join(", ") || "—"],
                      ["Website", value(profile.data.website)],
                      ["Ngành nghề", profile.data.activities.map((a) => labels[a] ?? a).join(", ") || "—"],
                      ["Giới thiệu", value(profile.data.description)],
                      ["Liên kết với bạn", profile.data.linkStatus ? `${linkLabel[profile.data.linkStatus] ?? profile.data.linkStatus}${profile.data.linkDirection === "RECEIVED" ? " (họ mời bạn)" : ""}` : "Chưa liên kết"],
                    ] as [string, string][]
                  ).map(([label, text]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{text}</dd>
                    </div>
                  ))}
                </dl>
                <div className="dialog-actions">
                  <button type="button" className="button secondary" onClick={() => setViewing(null)}>
                    Quay lại kết quả
                  </button>
                  <button type="button" className="button" disabled={busy} onClick={() => setInviting(viewing)}>
                    {busy ? linkLabel[profile.data.linkStatus ?? ""] : "Mời liên kết"}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="workspace-form partner-search">
            <label>
              Tìm doanh nghiệp trên AgriTrace
              <input
                className="input"
                autoFocus
                placeholder="Nhập MST, tên doanh nghiệp hoặc mã AGT-…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSent(null);
                }}
              />
            </label>
            <PartnerMatches
              {...search}
              onView={(item) => setViewing(item)}
              onPick={(item) => setInviting(item)}
              pickLabel="Mời liên kết"
            />
            <div className="partner-search-foot">
              <span className="muted">Doanh nghiệp chưa dùng AgriTrace?</span>
              <Link className="button secondary small" href="/enterprise/partners/new?mode=external">
                Ghi nhận doanh nghiệp ngoài hệ thống
              </Link>
            </div>
          </div>
        )}
      </div>
    </InfoDialog>
  );
}

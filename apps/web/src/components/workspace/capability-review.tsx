"use client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { useState } from "react";
import type { Enrollment } from "@/lib/enterprise-onboarding";
import { useWorkspaceCommand } from "@/lib/workspace";
import { CommandState, StatusBadge } from "@/components/manage";
import { capabilityLabels, label, participationLabels, processTypeLabels } from "@/lib/platform-admin";

type Request = Enrollment["capabilityRequests"][number];

function Details({ request }: { request: Request }) {
  const details = request.details as {
    processing?: { processingTypes?: string[]; foodSafetyCertificateNumber?: string; foodSafetyCertificateExpiry?: string; facilityCode?: string; dailyCapacityKg?: number; certifications?: string[] };
    production?: { productGroups?: string[]; certifications?: string[] };
  };
  if (details.processing) {
    const p = details.processing;
    return (
      <p className="muted">
        Loại chế biến: {(p.processingTypes ?? []).map((t) => label(processTypeLabels, t)).join(", ")} · Giấy chứng nhận ATTP {p.foodSafetyCertificateNumber}, hết hạn {p.foodSafetyCertificateExpiry}
        {p.facilityCode ? ` · Mã cơ sở ${p.facilityCode}` : ""}
        {p.dailyCapacityKg ? ` · Công suất ${p.dailyCapacityKg} kg/ngày` : ""}
        {p.certifications?.length ? ` · ${p.certifications.join(", ")}` : ""}
      </p>
    );
  }
  if (details.production)
    return (
      <p className="muted">
        Nhóm sản phẩm: {(details.production.productGroups ?? []).join(", ")}
        {details.production.certifications?.length ? ` · Chứng nhận: ${details.production.certifications.join(", ")}` : ""}
      </p>
    );
  return null;
}

/** Each registered capability is approved or rejected on its own; approval
 * after activation grants the capability in the same audited command. */
export function CapabilityReview({ enrollment, onDone }: { enrollment: Enrollment; onDone(): void }) {
  const command = useWorkspaceCommand();
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!enrollment.capabilityRequests.length) return null;
  async function decide(request: Request, decision: "APPROVE" | "REJECT") {
    const note = (notes[request.id] ?? "").trim();
    if ((await command.run(`/capability-requests/${request.id}/review`, { decision, note, version: request.version })) !== false) onDone();
  }
  return (
    <section className="manage-section manage-detail-section">
      <h2>Duyệt từng năng lực</h2>
      <p className="manage-section-help">
        Mô hình tham gia: <strong>{label(participationLabels, enrollment.participationModel)}</strong>.{" "}
        {enrollment.payingParticipant
          ? "Tổ chức trả phí: cần thanh toán gói dịch vụ trước khi kích hoạt và được quyền tạo chuỗi."
          : "Tổ chức tham gia chuỗi: không mua gói, không tạo chuỗi, chỉ ghi nghiệp vụ khi được mời."}{" "}
        Năng lực chế biến chỉ duyệt khi giấy chứng nhận an toàn thực phẩm còn hiệu lực.
      </p>
      <CommandState command={command} />
      <ul className="manage-capability-list">
        {enrollment.capabilityRequests.map((request) => (
          <li key={request.id} className="manage-section">
            <div className="manage-section-heading">
              <div>
                <h3>{label(capabilityLabels, request.code)}</h3>
                <Details request={request} />
                {request.reviewNote && <p>Ghi chú: {request.reviewNote}</p>}
              </div>
              <StatusBadge value={request.status === "PENDING" ? "PENDING_REVIEW" : request.status} />
            </div>
            {request.status === "PENDING" && (
              <div className="admin-reason">
                <Textarea
                  className="input"
                  aria-label={`Căn cứ duyệt năng lực ${label(capabilityLabels, request.code)}`}
                  placeholder="Căn cứ quyết định (tối thiểu 10 ký tự)"
                  minLength={10}
                  value={notes[request.id] ?? ""}
                  onChange={(e) => setNotes({ ...notes, [request.id]: e.target.value })}
                />
                <div className="actions">
                  <Button className="button" type="button" disabled={command.pending || (notes[request.id] ?? "").trim().length < 10} onClick={() => void decide(request, "APPROVE")}>
                    Duyệt năng lực
                  </Button>
                  <Button className="button secondary" type="button" disabled={command.pending || (notes[request.id] ?? "").trim().length < 10} onClick={() => void decide(request, "REJECT")}>
                    Từ chối
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

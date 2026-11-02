"use client";
import { z } from "zod";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { wapi } from "@/lib/ledger/enterprise-coordination-api";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { PERMISSION_SYNC_EVENT } from "@/lib/permission-sync";
import { t as tr } from "@/lib/ledger/i18n";
import { CommandForm } from "@/components/ledger/kit/command-dialog";
import { SelectField, TextField } from "@/components/ledger/kit/form-fields";
import { Section, Callout } from "@/components/ledger/kit/page";
import { CAPABILITY_LABEL } from "@/lib/ledger/labels";
import { EvidencePick } from "@/components/ledger/workspace/evidence-pick";

const GOODS_OWNING = ["FARM", "PROCESSOR", "DISTRIBUTOR", "RETAILER"];
const CODES = ["FARM", "PROCESSOR", "TRANSPORTER", "DISTRIBUTOR", "RETAILER"] as const;
const capabilitySchema = z
  .object({
    code: z.enum(CODES),
    productGroups: z.string().trim().max(1000).optional(),
    foodSafetyCertificateNumber: z.string().trim().max(100).optional(),
    foodSafetyCertificateExpiry: z.string().optional(),
    evidenceIds: z.array(z.string()).max(10),
  })
  .superRefine((v, ctx) => {
    if (v.code === "FARM" && !v.productGroups)
      ctx.addIssue({ code: "custom", path: ["productGroups"], message: tr("Nhập nhóm sản phẩm, ngăn cách bằng dấu phẩy") });
    if (v.code === "PROCESSOR" && (!v.foodSafetyCertificateNumber || !v.foodSafetyCertificateExpiry))
      ctx.addIssue({ code: "custom", path: ["foodSafetyCertificateNumber"], message: tr("Nhập số và hạn giấy chứng nhận an toàn thực phẩm") });
    if (v.code === "PROCESSOR" && !v.evidenceIds.length)
      ctx.addIssue({ code: "custom", path: ["evidenceIds"], message: tr("Đính kèm giấy chứng nhận an toàn thực phẩm") });
  });

/** ADR-005: a member upgrades to chain owner keeping account and data, and an
 * activated organization asks for another capability (reviewed by admin). */
export function ParticipationPanel() {
  const { owner } = useWorkspaceAccess();
  const enrollment = useQuery({ queryKey: ["ws-enrollment"], queryFn: wapi.enrollment });
  const e = enrollment.data;
  if (!owner || !e || e.status !== "APPROVED") return null;
  const approved = e.capabilityRequests.filter((c) => c.status === "APPROVED").map((c) => c.code);
  const pending = e.capabilityRequests.filter((c) => c.status === "PENDING").map((c) => c.code);
  const missing = CODES.filter((c) => !approved.includes(c) && !pending.includes(c));
  const member = e.participationStatus !== "CHAIN_OWNER";
  return (
    <>
      {member && (
        <Section title={tr("Nâng cấp lên chủ chuỗi")} bodyClassName="p-4">
          {approved.some((c) => GOODS_OWNING.includes(c)) ? (
            <CommandForm
              title={tr("Đứng tên sản phẩm và tạo chuỗi")}
              endpoint="POST /enterprise-service/upgrade"
              schema={z.object({})}
              defaultValues={{}}
              version={e.version}
              submitLabel={tr("Nâng cấp lên chủ chuỗi")}
              invalidate={[["ws-enrollment"], ["ws-service"], ["enterprise-access"]]}
              run={(_, cmd) => wapi.upgradeToChainOwner({ version: e.version }, cmd)}
              onDone={() => window.dispatchEvent(new Event(PERMISSION_SYNC_EVENT))}
            >
              {() => (
                <p className="text-[13px] text-ink-2">
                  {tr("Tài khoản, nhân viên và dữ liệu giữ nguyên. Sau khi nâng cấp, chọn gói và thanh toán; quyền tạo chuỗi có hiệu lực khi gói được kích hoạt.")}
                </p>
              )}
            </CommandForm>
          ) : (
            <Callout tone="warn">{tr("Chủ chuỗi cần ít nhất một năng lực sở hữu hàng đã được duyệt (sản xuất, chế biến, phân phối hoặc bán lẻ). Xin thêm năng lực trước.")}</Callout>
          )}
        </Section>
      )}
      {!!e.serviceActivatedAt && missing.length > 0 && (
        <Section title={tr("Xin thêm năng lực")} bodyClassName="p-4">
          {pending.length > 0 && <Callout>{tr("Đang chờ duyệt")}: {pending.map((c) => CAPABILITY_LABEL[c] ?? c).join(", ")}</Callout>}
          <CommandForm
            title={tr("Năng lực mới được quản trị nền tảng xét duyệt")}
            endpoint="POST /capability-requests"
            schema={capabilitySchema}
            defaultValues={{ code: missing[0], productGroups: "", foodSafetyCertificateNumber: "", foodSafetyCertificateExpiry: "", evidenceIds: [] as string[] }}
            submitLabel={tr("Gửi yêu cầu")}
            invalidate={[["ws-enrollment"]]}
            run={(v, cmd) =>
              wapi.requestCapability(
                {
                  code: v.code,
                  evidenceIds: v.evidenceIds,
                  ...(v.code === "FARM"
                    ? { production: { sector: "CROP", productGroups: (v.productGroups ?? "").split(",").map((s) => s.trim()).filter(Boolean), certifications: [] } }
                    : {}),
                  ...(v.code === "PROCESSOR"
                    ? { processing: { processingTypes: ["PRELIMINARY"], foodSafetyCertificateNumber: v.foodSafetyCertificateNumber!, foodSafetyCertificateExpiry: v.foodSafetyCertificateExpiry!, certifications: [] } }
                    : {}),
                },
                cmd,
              )
            }
          >
            {(f) => (
              <>
                <SelectField control={f.control} name="code" label={tr("Năng lực")} options={missing.map((c) => ({ value: c, label: CAPABILITY_LABEL[c] ?? c }))} />
                <TextField control={f.control} name="productGroups" label={tr("Nhóm sản phẩm (khi xin sản xuất)")} />
                <TextField control={f.control} name="foodSafetyCertificateNumber" label={tr("Số giấy chứng nhận ATTP (khi xin chế biến)")} />
                <TextField control={f.control} name="foodSafetyCertificateExpiry" label={tr("Hạn giấy chứng nhận ATTP")} type="date" />
                <EvidencePick control={f.control} name="evidenceIds" label={tr("Giấy chứng nhận (bắt buộc khi xin chế biến)")} entityType="PROFILE" entityId={e.organizationId} kind="CERTIFICATE_IMAGE" min={0} />
              </>
            )}
          </CommandForm>
        </Section>
      )}
    </>
  );
}

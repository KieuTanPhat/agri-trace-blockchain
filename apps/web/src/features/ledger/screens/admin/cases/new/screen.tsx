"use client";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale } from "@/components/ledger/locale";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { useLedgerQuery } from "@/lib/ledger/data";
import { api } from "@/lib/ledger/cases-api";
import { CASE_CATEGORY_LABEL, CASE_SOURCE_LABEL } from "@/lib/ledger/labels";
import { t as tr } from "@/lib/ledger/i18n";
import { futureDateTime, localToIso } from "../schemas";
import { Guard } from "@/components/ledger/kit/guard";
import {
  PageHeader,
  PageBody,
  Section,
  Callout,
  ErrorState,
} from "@/components/ledger/kit/page";
import { CommandForm } from "@/components/ledger/kit/command-dialog";
import {
  TextField,
  TextAreaField,
  SelectField,
} from "@/components/ledger/kit/form-fields";
const createSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, { error: () => tr("Tối thiểu 5 ký tự") })
    .max(200),
  description: z
    .string()
    .trim()
    .min(10, { error: () => tr("Tối thiểu 10 ký tự") })
    .max(4000),
  category: z.enum(["QUALITY", "SAFETY", "LABELING", "COUNTERFEIT", "OTHER"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  source: z.enum(["CONSUMER", "ENTERPRISE", "AUDITOR", "INTERNAL"]),
  ownerOrganizationId: z.union([z.literal(""), z.uuid()]).optional(),
  lotId: z.union([z.literal(""), z.uuid()]).optional(),
  responseDueAt: futureDateTime,
});

export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-cases-new">
      <Guard permission="cases.write">
        <CreateCase />
      </Guard>
    </LedgerRouteScreen>
  );
}

function CreateCase() {
  const router = useRouter();
  const options = useLedgerQuery({
    queryKey: ["case-orgs"],
    queryFn: api.cases.organizationOptions,
  });
  return (
    <div data-testid="ledger-case-create">
      <PageHeader
        title={tr("Tạo hồ sơ sự cố")}
        crumbs={[
          { href: "/admin/cases", label: tr("Hồ sơ sự cố") },
          { label: tr("Tạo mới") },
        ]}
      />
      <PageBody>
        <Callout>
          {tr(
            "Có tổ chức phụ trách thì hồ sơ ở trạng thái Đã giao; gắn lô mà không chọn tổ chức thì giao cho doanh nghiệp sản xuất lô. Mô tả hiển thị cho doanh nghiệp — không ghi dữ liệu cá nhân của người khiếu nại.",
          )}
        </Callout>
        {options.error && (
          <ErrorState
            error={options.error}
            onRetry={() => void options.refetch()}
          />
        )}
        <Section title={tr("Thông tin hồ sơ")}>
          <div className="max-w-3xl p-5">
            <CommandForm
              title={tr("Tạo hồ sơ sự cố")}
              endpoint="POST /platform-cases"
              schema={createSchema}
              defaultValues={{
                title: "",
                description: "",
                category: "QUALITY",
                severity: "MEDIUM",
                source: "INTERNAL",
              }}
              submitLabel={tr("Tạo hồ sơ sự cố")}
              invalidate={[["cases"], ["inbox"]]}
              run={async (v, cmd) => {
                const result = await api.cases.create(
                  {
                    ...v,
                    ownerOrganizationId: v.ownerOrganizationId || undefined,
                    lotId: v.lotId || undefined,
                    responseDueAt: localToIso(v.responseDueAt),
                  },
                  cmd,
                );
                router.push("/admin/cases/" + result.id);
                return result;
              }}
            >
              {(f) => (
                <>
                  <TextField
                    control={f.control}
                    name="title"
                    label={tr("Tiêu đề")}
                    max={200}
                  />
                  <TextAreaField
                    control={f.control}
                    name="description"
                    label={tr("Mô tả")}
                    max={4000}
                    rows={4}
                  />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <SelectField
                      control={f.control}
                      name="category"
                      label={tr("Loại")}
                      options={Object.entries(CASE_CATEGORY_LABEL).map(
                        ([value, label]) => ({ value, label }),
                      )}
                    />
                    <SelectField
                      control={f.control}
                      name="severity"
                      label={tr("Mức độ")}
                      options={[
                        { value: "LOW", label: tr("Thấp") },
                        { value: "MEDIUM", label: tr("Trung bình") },
                        { value: "HIGH", label: "Cao" },
                        { value: "CRITICAL", label: tr("Nghiêm trọng") },
                      ]}
                    />
                    <SelectField
                      control={f.control}
                      name="source"
                      label={tr("Nguồn")}
                      options={Object.entries(CASE_SOURCE_LABEL).map(
                        ([value, label]) => ({ value, label }),
                      )}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SelectField
                      control={f.control}
                      name="ownerOrganizationId"
                      label={tr("Tổ chức phụ trách (tùy chọn)")}
                      options={(options.data ?? []).map((o) => ({
                        value: o.id,
                        label: o.name,
                      }))}
                    />
                    <TextField
                      control={f.control}
                      name="responseDueAt"
                      label={tr("Hạn phản hồi (tùy chọn)")}
                      type="datetime-local"
                    />
                  </div>
                  <TextField
                    control={f.control}
                    name="lotId"
                    label={tr("Lô liên quan (tùy chọn)")}
                    hint={tr(
                      "Gắn lô mà không chọn tổ chức thì giao cho doanh nghiệp sản xuất lô",
                    )}
                  />
                </>
              )}
            </CommandForm>
          </div>
        </Section>
      </PageBody>
    </div>
  );
}

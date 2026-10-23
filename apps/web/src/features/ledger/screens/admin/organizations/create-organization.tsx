"use client";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { api } from "@/lib/ledger/platform-api";
import { CommandForm } from "@/components/ledger/kit/command-dialog";
import { TextField } from "@/components/ledger/kit/form-fields";
import {
  Callout,
  PageBody,
  PageHeader,
  Section,
} from "@/components/ledger/kit/page";
import { t } from "@/lib/ledger/i18n";
const schema = z.object({ name: z.string().trim().min(1).max(255) });
export function CreateAuditorOrganization() {
  const router = useRouter();
  return (
    <>
      <PageHeader
        title={t("Tạo tổ chức kiểm định")}
        crumbs={[
          { href: "/admin/organizations", label: t("Danh bạ tổ chức") },
          { label: t("Tạo mới") },
        ]}
      />
      <PageBody>
        <Callout>
          {t(
            "Tổ chức kiểm định được quản trị nền tảng tạo trực tiếp. Doanh nghiệp tham gia qua quy trình đăng ký và xét hồ sơ.",
          )}
        </Callout>
        <Section title={t("Thông tin tổ chức")}>
          <div className="max-w-2xl p-5">
            <CommandForm
              title={t("Tổ chức kiểm định")}
              endpoint="POST /organizations"
              schema={schema}
              defaultValues={{ name: "" }}
              submitLabel={t("Tạo tổ chức kiểm định")}
              invalidate={[["organizations"], ["directory"]]}
              run={(v, cmd) =>
                api.enterprises.createOrganization(
                  { ...v, type: "AUDITOR" },
                  cmd,
                )
              }
              onDone={() => router.push("/admin/organizations")}
            >
              {(f) => (
                <TextField
                  control={f.control}
                  name="name"
                  label={t("Tên tổ chức")}
                  max={255}
                />
              )}
            </CommandForm>
          </div>
        </Section>
      </PageBody>
    </>
  );
}

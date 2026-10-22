"use client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { useState, type FormEvent } from "react";
import {
  useWorkspaceData,
  useWorkspaceCommand,
  type Row,
  type Overview,
} from "@/lib/workspace";
import { CommandState, LoadState, PageHeader } from "@/components/manage";
export default function NoticesPage() {
  const state = useWorkspaceData<{ lots: Row[] }>("/distribution/reports"),
    overview = useWorkspaceData<Overview>("/enterprise-workspace"),
    cmd = useWorkspaceCommand(),
    [saved, setSaved] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    if (await cmd.run("/distribution/notices", data)) setSaved(true);
  }
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        back="/enterprise"
        backLabel="Doanh nghiệp"
        title="Cảnh báo & thu hồi"
        description="Doanh nghiệp sản xuất phát thông báo công khai theo lô nguồn. Thu hồi sẽ chặn các bước giao nhận tiếp theo."
      />
      <LoadState {...state} />
      {saved ? (
        <p className="notice" role="status">
          Đã ghi nhận thông báo. Người tra cứu QR của lô sẽ thấy nội dung này.
        </p>
      ) : (
        <form className="panel workspace-form" onSubmit={submit}>
          <CommandState command={cmd} />
          <fieldset
            disabled={cmd.pending || cmd.frozen}
            className="enterprise-fields"
          >
            <label>
              Lô nguồn
              <NativeSelect className="input" name="lotId" required>
                <option value="">Chọn lô do doanh nghiệp sản xuất</option>
                {state.data?.lots
                  .filter((l) => l.farmOrgId === overview.data?.organization.id)
                  .map((l) => (
                    <option value={String(l.lotId)} key={String(l.lotId)}>
                      {String(l.lotCode)} · {String(l.productName)}
                    </option>
                  ))}
              </NativeSelect>
            </label>
            <label>
              Loại thông báo
              <NativeSelect className="input" name="kind">
                <option value="WARNING">Cảnh báo truy xuất</option>
                <option value="RECALL">Thu hồi toàn bộ lô nguồn</option>
              </NativeSelect>
            </label>
            <label>
              Nội dung công khai
              <Textarea
                className="input"
                name="message"
                required
                minLength={10}
                maxLength={500}
                rows={5}
              />
              <small>
                Không đưa số điện thoại riêng, email cá nhân hoặc thông tin nội
                bộ vào thông báo.
              </small>
            </label>
            <p className="notice">
              Thông báo được ghi nối tiếp trong lịch sử truy xuất. Kiểm tra nội
              dung và mã lô trước khi phát hành.
            </p>
          </fieldset>
          <Button className="button" disabled={cmd.pending} type="submit">
            {cmd.pending
              ? "Đang ghi…"
              : "Phát hành thông báo"}
          </Button>
        </form>
      )}
    </div>
  );
}

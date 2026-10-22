"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  useWorkspaceData,
  useWorkspaceCommand,
  textValue,
  type Row,
} from "@/lib/workspace";
import { CommandState, LoadState, PageHeader } from "@/components/manage";
export default function AdjustQuantityPage() {
  const router = useRouter(),
    state = useWorkspaceData<{ lots: Row[] }>("/distribution/reports"),
    cmd = useWorkspaceCommand(),
    [lotId, setLotId] = useState("");
  const lot = state.data?.lots.find((l) => l.lotId === lotId);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    if (
      await cmd.run("/distribution/quantities", {
        ...form,
        fromQuarantine:form.fromQuarantine==='true',
        version: lot?.version,
        unit: lot?.unit,
      })
    )
      router.push("/enterprise/reports");
  }
  return (
    <div className="manage-console">
      <PageHeader actionKind="create" backLabel="Quay lại danh sách"
        title="Ghi giảm lượng hàng"
        description="Ghi nhận lượng bán ra hoặc hao hụt thực tế theo lô. Chức năng phục vụ đối soát truy xuất và không ghi nhận tiền hay đơn bán hàng."
        back="/enterprise/reports"
      />
      <LoadState {...state} />
      <form className="panel workspace-form" onSubmit={submit}>
        <CommandState command={cmd} />
        <fieldset
          disabled={cmd.pending || cmd.frozen}
          className="enterprise-fields"
        >
          <label>
            Lô đang giữ
            <NativeSelect
              className="input"
              name="lotId"
              value={lotId}
              required
              onChange={(e) => setLotId(e.target.value)}
            >
              <option value="">Chọn lô</option>
              {state.data?.lots
                .filter((l) => Number(l.held) > 0)
                .map((l) => (
                  <option key={String(l.lotId)} value={String(l.lotId)}>
                    {textValue(l.lotCode)} · có thể ghi giảm{" "}
                    {textValue(l.unreserved ?? l.available)} {textValue(l.unit)}
                  </option>
                ))}
            </NativeSelect>
          </label>
          <label>
            Cơ sở giữ hàng
            <NativeSelect className="input" name="siteId" required key={lotId}><option value="">Chọn cơ sở</option>{(lot?.siteHoldings as Row[]|undefined)?.map(s=><option key={String(s.siteId)} value={String(s.siteId)}>{textValue(s.siteName)} · khả dụng {textValue(s.available)} {textValue(lot?.unit)}</option>)}</NativeSelect>
          </label>
          <label>
            Loại ghi nhận
            <NativeSelect className="input" name="kind">
              <option value="SALE">Bán ra — doanh nghiệp bán lẻ</option>
              <option value="DAMAGE">Hao hụt / hư hỏng</option>
            </NativeSelect>
          </label>
          <label>
            Số lượng ({textValue(lot?.unit)})
            <Input
              className="input"
              name="quantity"
              required
              pattern="[0-9]+(\.[0-9]{1,3})?"
              inputMode="decimal"
            />
          </label>
          <label>
            Lý do
            <Input
              className="input"
              name="reason"
              required
              minLength={3}
              maxLength={500}
            />
          </label>
          <label><Input type="checkbox" name="fromQuarantine" value="true"/>Ghi hư hỏng từ lượng đang cách ly (cần quyền quản lý cách ly)</label>
        </fieldset>
        <p className="notice">
          Chỉ ghi giảm lượng doanh nghiệp đang giữ và chưa dành giao. Lịch sử số
          lượng được giữ nguyên để đối soát.
        </p>
        <Button className="button" type="submit" disabled={cmd.pending}>
          {cmd.pending
            ? "Đang ghi…"
            : "Ghi nhận số lượng"}
        </Button>
      </form>
    </div>
  );
}

"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { generateDistributionKey } from "@/lib/distribution-signer";
import {
  errorMessage,
  useWorkspaceData,
  useWorkspaceCommand,
  textValue,
  type Row,
  type Overview,
} from "@/lib/workspace";
import {
  CommandState,
  LoadState,
  PageHeader,
  StatusBadge,
} from "@/components/manage";
export default function SigningPage() {
  const state = useWorkspaceData<{ items: Row[] }>("/distribution/keys"),
    overview = useWorkspaceData<Overview>("/enterprise-workspace"),
    cmd = useWorkspaceCommand(),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false);
  async function create() {
    if (!overview.data) return;
    setCreating(true);
    setError("");
    try {
      const body = await generateDistributionKey(
        overview.data.organization.id,
        "Khóa bàn giao trên trình duyệt",
      );
      if (await cmd.run("/distribution/keys", body)) state.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCreating(false);
    }
  }
  async function revoke(id: string) {
    if (await cmd.run(`/distribution/keys/${id}/revoke`, {})) state.reload();
  }
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        back="/enterprise"
        backLabel="Doanh nghiệp"
        title="Khóa ký bàn giao"
        description="Doanh nghiệp dùng khóa Ed25519 để xác nhận nội dung giao nhận. Khóa riêng nằm trên thiết bị tạo khóa."
      />
      <LoadState {...state} />
      <CommandState command={cmd} />
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <p>
          Tài khoản cấp 1 đăng ký khóa cho doanh nghiệp. Khi thu hồi khóa, các
          bàn giao chưa hoàn tất cần được đối soát.
        </p>
        <Button
          className="button"
          disabled={
            creating ||
            cmd.pending ||
            cmd.frozen ||
            !overview.data?.member.primary
          }
          onClick={() => void create()}
        >
          {creating ? "Đang tạo khóa…" : "Tạo khóa trên thiết bị này"}
        </Button>
      </section>
      <div className="manage-section manage-table-scroll">
        <Table className="manage-table">
          <TableHeader>
            <TableRow>
              <TableHead>Khóa</TableHead>
              <TableHead>Ngày tạo</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead>Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.data?.items.map((k) => (
              <TableRow key={String(k.id)}>
                <TableCell data-label="Khóa">
                  {textValue(k.label)}
                  <small>{textValue(k.id)}</small>
                </TableCell>
                <TableCell data-label="Ngày tạo">
                  {new Date(String(k.createdAt)).toLocaleDateString("vi-VN")}
                </TableCell>
                <TableCell data-label="Trạng thái">
                  <StatusBadge value={String(k.status)} />
                </TableCell>
                <TableCell data-label="Thao tác">
                  {k.status === "ACTIVE" && overview.data?.member.primary && (
                    <Button
                      className="text-link"
                      disabled={cmd.pending}
                      onClick={() => void revoke(String(k.id))}
                    >
                      Thu hồi
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import Image from "next/image";
import { z } from "zod";
import { useLedgerQuery } from "@/lib/ledger/data";
import { ledgerRequest } from "@/lib/ledger/request";
import type { LedgerCommandContext } from "@/lib/ledger/command-context";
import type { components } from "@/lib/generated/api";
import {
  CommandDialog,
  useDialog,
} from "@/components/ledger/kit/command-dialog";
import { TextField, TextAreaField } from "@/components/ledger/kit/form-fields";
import { PageHeader, PageBody } from "@/components/ledger/kit/page";
import { Guard } from "@/components/ledger/kit/guard";
import { Button } from "@/components/ledger/ui/button";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
type News = components["schemas"]["AdminNewsDto"];
const editSchema = z.object({
  title: z.string().trim().min(3).max(255),
  summary: z.string().trim().min(3).max(1000),
  body: z.string().trim().min(3).max(50000),
  coverBase64: z.string().max(524288).optional(),
  coverMimeType: z.string().optional(),
  removeCover: z.boolean().optional(),
});
const statusSchema = z.object({});
function SavedCover({ id }: { id: string }) {
  const q = useLedgerQuery({
    queryKey: ["admin-news-cover", id],
    queryFn: () =>
      ledgerRequest<components["schemas"]["PublicNewsImageDto"]>(
        `/platform-admin/news/${id}/cover`,
      ),
  });
  return q.data ? (
    <Image
      unoptimized
      width={1000}
      height={500}
      alt="Ảnh bìa hiện tại"
      src={`data:${q.data.mimeType};base64,${q.data.dataBase64}`}
      className="mb-3 max-h-52 w-full rounded-lg object-cover"
    />
  ) : null;
}
function post<T>(path: string, body: unknown, cmd: LedgerCommandContext) {
  return ledgerRequest<T>(path, {
    method: "POST",
    headers: { "Idempotency-Key": cmd.idempotencyKey },
    body: JSON.stringify(body),
  });
}
function NewsManager() {
  const q = useLedgerQuery({
    queryKey: ["admin-news"],
    queryFn: async () =>
      (await ledgerRequest<{ items: News[] }>("/platform-admin/news")).items,
  });
  const editor = useDialog<News | "new">();
  const decision = useDialog<{
    news: News;
    action: "PUBLISH" | "WITHDRAW" | "ARCHIVE";
  }>();
  const [uploadError, setUploadError] = useState("");
  const columns: Column<News>[] = [
    {
      key: "title",
      header: "Bản tin",
      cell: (n) => (
        <div className="max-w-xl">
          <p className="font-medium">{n.title}</p>
          <p className="line-clamp-2 text-sm text-ink-2">{n.summary}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Hiển thị trên mobile",
      cell: (n) => (
        <span className={n.isPublished ? "text-green-700" : "text-ink-2"}>
          {n.isPublished ? "Đã đăng" : "Bản nháp / Đã ẩn"}
        </span>
      ),
    },
    {
      key: "updated",
      header: "Cập nhật",
      cell: (n) => new Date(n.updatedAt).toLocaleString("vi-VN"),
    },
    {
      key: "actions",
      header: "Thao tác",
      cell: (n) => (
        <div className="flex flex-wrap gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setUploadError("");
              editor.open(n);
            }}
          >
            Sửa / Xem trước
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              decision.open({
                news: n,
                action: n.isPublished ? "WITHDRAW" : "PUBLISH",
              })
            }
          >
            {n.isPublished ? "Ẩn tin" : "Đăng tin"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => decision.open({ news: n, action: "ARCHIVE" })}
          >
            Lưu trữ
          </Button>
        </div>
      ),
    },
  ];
  const current = editor.target === "new" ? null : editor.target;
  return (
    <>
      <PageHeader
        title="Quản lí bản tin"
        description="Soạn bài và đăng lên trang chủ, bảng tin của ứng dụng người tiêu dùng."
        actions={
          <Button
            onClick={() => {
              setUploadError("");
              editor.open("new");
            }}
          >
            Thêm bản tin
          </Button>
        }
      />
      <PageBody>
        <div className="rounded-xl border border-line bg-card">
          <DataTable
            rows={q.data}
            loading={q.isLoading}
            error={q.error}
            columns={columns}
            rowKey={(n) => n.id}
          />
        </div>
      </PageBody>
      {editor.target && (
        <CommandDialog
          {...editor.props}
          title={current ? "Sửa bản tin" : "Thêm bản tin"}
          wide
          endpoint={
            current
              ? "POST /platform-admin/news/:id"
              : "POST /platform-admin/news"
          }
          schema={editSchema}
          defaultValues={{
            title: current?.title ?? "",
            summary: current?.summary ?? "",
            body: current?.body ?? "",
          }}
          version={current?.version}
          submitLabel="Lưu bản tin"
          invalidate={[["admin-news"], ["admin-news-cover"]]}
          run={(v, cmd) =>
            post(
              "/platform-admin/news" + (current ? "/" + current.id : ""),
              { ...v, ...(current ? { version: current.version } : {}) },
              cmd,
            )
          }
        >
          {(f) => (
            <div className="space-y-4">
              <TextField control={f.control} name="title" label="Tiêu đề" />
              <TextAreaField
                control={f.control}
                name="summary"
                label="Mô tả ngắn"
              />
              <TextAreaField
                control={f.control}
                name="body"
                label="Nội dung bài viết"
              />
              <label className="flex flex-col gap-2 text-sm">
                Ảnh bìa (JPG, PNG, WebP; tối đa 384 KB và 2048 px)
                <input
                  aria-label="Ảnh bìa"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploadError("");
                    if (file.size > 393216) {
                      setUploadError("Ảnh lớn hơn 384 KB. Chọn ảnh nhỏ hơn.");
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => {
                      f.setValue(
                        "coverBase64",
                        String(reader.result).split(",")[1],
                        { shouldDirty: true },
                      );
                      f.setValue("coverMimeType", file.type);
                      f.setValue("removeCover", false);
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {uploadError && (
                <p role="alert" className="text-red-700">
                  {uploadError}
                </p>
              )}
              {(current?.hasCover || f.watch("coverBase64")) && (
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    {...f.register("removeCover")}
                    onChange={(e) => {
                      f.setValue("removeCover", e.target.checked);
                      if (e.target.checked) {
                        f.setValue("coverBase64", undefined);
                        f.setValue("coverMimeType", undefined);
                      }
                    }}
                  />
                  Xóa ảnh bìa
                </label>
              )}
              <div className="rounded-xl bg-slate-50 p-5">
                <p className="mb-3 text-xs uppercase text-ink-2">Xem trước</p>
                {!f.watch("removeCover") &&
                  (f.watch("coverBase64") ? (
                    <Image
                      unoptimized
                      width={1000}
                      height={500}
                      alt="Ảnh bìa xem trước"
                      src={
                        "data:" +
                        f.watch("coverMimeType") +
                        ";base64," +
                        f.watch("coverBase64")
                      }
                      className="mb-3 max-h-52 w-full rounded-lg object-cover"
                    />
                  ) : current?.hasCover ? (
                    <SavedCover id={current.id} />
                  ) : null)}
                <h3 className="text-xl font-semibold">{f.watch("title")}</h3>
                <p className="my-2 font-medium">{f.watch("summary")}</p>
                <p className="whitespace-pre-wrap text-sm leading-6">
                  {f.watch("body")}
                </p>
              </div>
            </div>
          )}
        </CommandDialog>
      )}
      {decision.target && (
        <CommandDialog
          {...decision.props}
          title={
            {
              PUBLISH: "Đăng bản tin lên mobile",
              WITHDRAW: "Ẩn bản tin trên mobile",
              ARCHIVE: "Lưu trữ bản tin",
            }[decision.target.action]
          }
          description={decision.target.news.title}
          endpoint="POST /platform-admin/news/:id/status"
          schema={statusSchema}
          defaultValues={{}}
          version={decision.target.news.version}
          submitLabel="Xác nhận"
          invalidate={[["admin-news"], ["admin-news-cover"]]}
          run={(_, cmd) =>
            post(
              "/platform-admin/news/" + decision.target!.news.id + "/status",
              {
                action: decision.target!.action,
                version: decision.target!.news.version,
              },
              cmd,
            )
          }
        >
          {() => (
            <p className="text-sm text-ink-2">
              {decision.target?.action === "PUBLISH"
                ? "Người dùng sẽ thấy bài viết ở trang chủ và bảng tin."
                : "Bài viết sẽ ngừng hiển thị với người dùng."}
            </p>
          )}
        </CommandDialog>
      )}
    </>
  );
}
export default function LedgerScreen({ route }: LedgerScreenProps) {
  return (
    <LedgerRouteScreen route={route} name="admin-news">
      <Guard permission="news.read">
        <NewsManager />
      </Guard>
    </LedgerRouteScreen>
  );
}

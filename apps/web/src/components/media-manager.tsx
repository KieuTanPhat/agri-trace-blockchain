"use client";
import { useEffect, useState } from "react";
import { request } from "@/lib/api-client";
import { useRemote, apiBase, queryString } from "@/lib/workspace-api";
import {
  mediaBlob,
  uploadMedia,
  validateFile,
  type MediaFile,
} from "@/lib/media-api";
import { RemoteState } from "./workspace-controls";
function Preview({ file, token }: { file: MediaFile; token?: string }) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true,
      objectUrl = "";
    setError("");
    setUrl("");
    if (token) {
      setUrl(
        apiBase +
          "/public/trace/" +
          encodeURIComponent(token) +
          "/media/" +
          file.id +
          "/content",
      );
      return;
    }
    mediaBlob(file.id)
      .then((blob) => {
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, token, revision]);
  return (
    <>
      <RemoteState
        loading={!url && !error}
        error={error}
        retry={() => setRevision((v) => v + 1)}
      />
      {url && (
        <>
          {file.mime.startsWith("image/") && (
            <img
              className="media-preview"
              src={url}
              alt={file.name}
              onError={() =>
                setError(
                  "Không tải được ảnh. Tệp có thể đã bị thu hồi quyền công khai.",
                )
              }
            />
          )}
          <a href={url} target="_blank" rel="noreferrer">
            {file.mime === "application/pdf" ? "Xem trước PDF" : "Mở ảnh"}:{" "}
            {file.name}
          </a>
        </>
      )}
    </>
  );
}
export function MediaManager({
  targetType,
  targetId,
  canWrite = false,
  publicToken,
}: {
  targetType?: string;
  targetId?: string;
  canWrite?: boolean;
  publicToken?: string;
}) {
  const [uploadKey, setUploadKey] = useState("");
  const [revision, setRevision] = useState(0),
    [file, setFile] = useState<File | null>(null),
    [progress, setProgress] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState("");
  const path = publicToken
    ? "/public/trace/" + encodeURIComponent(publicToken) + "/media"
    : targetId
      ? "/media?" + queryString({ targetType: targetType!, targetId })
      : null;
  const remote = useRemote<MediaFile[]>(path, revision, !publicToken);
  async function upload() {
    if (!file || !targetId || !targetType) return;
    setBusy(true);
    setError("");
    setDone("");
    setProgress(0);
    try {
      await uploadMedia(file, targetType, targetId, setProgress, uploadKey);
      setFile(null);
      setDone("Đã lưu tệp ở chế độ riêng tư.");
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function change(item: MediaFile, remove = false) {
    if (remove && !window.confirm("Xóa tài liệu “" + item.name + "”?")) return;
    setBusy(true);
    setError("");
    try {
      await request("/media/" + item.id, {
        method: remove ? "DELETE" : "PATCH",
        ...(!remove
          ? { body: JSON.stringify({ isPublic: !item.isPublic }) }
          : {}),
      });
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Ảnh và tài liệu {publicToken ? "công khai" : ""}</h2>
      {canWrite && (
        <div className="workspace-toolbar">
          <label>
            Chọn JPEG, PNG, WebP hoặc PDF (tối đa 5 MB)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              disabled={busy}
              onChange={(e) => {
                const selected = e.target.files?.[0] ?? null;
                setDone("");
                setError(selected ? validateFile(selected) : "");
                setFile(selected);
                setUploadKey(crypto.randomUUID());
              }}
            />
          </label>
          <button
            className="button"
            disabled={!file || busy || !!(file && validateFile(file))}
            onClick={upload}
          >
            {busy ? "Đang tải…" : error ? "Thử tải lại" : "Tải lên"}
          </button>
          {busy && (
            <label>
              Tiến độ tải {progress}%<progress value={progress} max={100} />
              {progress === 100 && <span> Đang lưu trên máy chủ…</span>}
            </label>
          )}
        </div>
      )}
      {canWrite && (
        <p className="muted">
          Tệp mới mặc định riêng tư. Chứng nhận chỉ được công khai khi đã duyệt
          và được phép công khai.
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {done && <p role="status">{done}</p>}
      <RemoteState
        loading={remote.loading}
        error={remote.error}
        empty={remote.data?.length === 0}
        retry={() => setRevision((v) => v + 1)}
      />
      <div className="media-grid">
        {remote.data?.map((item) => (
          <article className="media-card" key={item.id}>
            <Preview file={item} token={publicToken} />
            <p>
              {(item.size / 1024).toFixed(1)} KB
              {!publicToken &&
                ` · ${item.isPublic ? "Cho phép công khai" : "Riêng tư"}`}
            </p>
            {canWrite && (
              <div className="workspace-toolbar">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => change(item)}
                >
                  {item.isPublic ? "Chuyển riêng tư" : "Cho phép công khai"}
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => change(item, true)}
                >
                  Xóa
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

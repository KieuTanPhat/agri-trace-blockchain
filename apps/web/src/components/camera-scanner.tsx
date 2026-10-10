"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getTracePath } from "@/lib/trace-input";
import { Camera, ScanLine, Upload } from "lucide-react";

export function CameraScanner({ onTrace }: { onTrace(path: string): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const frame = useRef<number | null>(null);
  const generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [readingImage, setReadingImage] = useState(false);
  const [phase, setPhase] = useState<"idle" | "starting" | "scanning">("idle");
  const [message, setMessage] = useState("");
  const release = useCallback(() => {
    generation.current += 1;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) {
      video.current.pause();
      video.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    function hidden() {
      if (document.hidden) {
        release();
        setPhase("idle");
        setMessage(
          "Camera đã tắt khi bạn rời trang. Bấm mở camera để quét tiếp.",
        );
      }
    }
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      release();
    };
  }, [release]);

  async function readImage(file?: File) {
    if (!file) return;
    release();
    setPhase("idle");
    const current = generation.current;
    if (
      !/^image\/(png|jpeg|webp|gif)$/.test(file.type) ||
      file.size > 20 * 1024 * 1024
    ) {
      setMessage("Chọn ảnh PNG, JPG, WebP hoặc GIF nhỏ hơn 20 MB.");
      return;
    }
    setReadingImage(true);
    setMessage("Đang đọc ảnh QR…");
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const { default: decode } = await import("jsqr");
      if (current !== generation.current) return;
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Không đọc được ảnh.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const result = decode(pixels.data, pixels.width, pixels.height, {
        inversionAttempts: "attemptBoth",
      });
      const path = result && getTracePath(result.data);
      if (path) {
        setMessage("Đã đọc mã truy xuất.");
        onTrace(path);
      } else
        setMessage(
          "Chưa tìm thấy mã truy xuất hợp lệ. Chọn ảnh QR rõ hơn hoặc nhập mã bên cạnh.",
        );
    } catch {
      if (current === generation.current)
        setMessage("Không đọc được ảnh. Chọn ảnh khác hoặc nhập mã truy xuất.");
    } finally {
      URL.revokeObjectURL(url);
      setReadingImage(false);
    }
  }

  async function start() {
    release();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setMessage(
        "Camera cần kết nối HTTPS và trình duyệt hỗ trợ. Bạn có thể nhập mã ở bên dưới.",
      );
      return;
    }
    const current = generation.current;
    setPhase("starting");
    setMessage("");
    try {
      const { default: decode } = await import("jsqr");
      if (current !== generation.current) return;
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (current !== generation.current || !video.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      video.current.srcObject = media;
      await video.current.play();
      if (current !== generation.current) return;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Không đọc được hình ảnh camera.");
      setPhase("scanning");
      let last = -Infinity;
      let invalid = "";
      function scan(now: number) {
        if (current !== generation.current) return;
        const element = video.current;
        try {
          if (
            element &&
            element.readyState >= 2 &&
            element.videoWidth &&
            element.videoHeight &&
            now - last >= 150
          ) {
            last = now;
            const scale = Math.min(1, 960 / element.videoWidth);
            canvas.width = Math.round(element.videoWidth * scale);
            canvas.height = Math.round(element.videoHeight * scale);
            context!.drawImage(element, 0, 0, canvas.width, canvas.height);
            const pixels = context!.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            );
            const result = decode(pixels.data, pixels.width, pixels.height, {
              inversionAttempts: "attemptBoth",
            });
            if (result) {
              const path = getTracePath(result.data);
              if (path) {
                release();
                setPhase("idle");
                onTrace(path);
                return;
              }
              if (invalid !== result.data) {
                invalid = result.data;
                setMessage(
                  "Mã QR chưa có token truy xuất hợp lệ. Hãy chọn mã trên bao bì AgriTrace.",
                );
              }
            }
          }
        } catch {
          release();
          setPhase("idle");
          setMessage(
            "Camera đã dừng do không đọc được hình ảnh. Bạn có thể mở lại camera hoặc nhập mã.",
          );
          return;
        }
        frame.current = requestAnimationFrame(scan);
      }
      frame.current = requestAnimationFrame(scan);
    } catch (cause) {
      if (current !== generation.current) return;
      release();
      setPhase("idle");
      const denied =
        cause instanceof DOMException &&
        ["NotAllowedError", "SecurityError"].includes(cause.name);
      setMessage(
        denied
          ? "Chưa được cấp quyền camera. Cho phép camera trong trình duyệt hoặc nhập mã thủ công."
          : "Không mở được camera. Kiểm tra thiết bị hoặc nhập mã thủ công.",
      );
    }
  }

  return (
    <section className="panel camera-panel" aria-label="Quét QR bằng camera">
      <h2>Quét QR bằng camera</h2>
      <p className="muted">
        Đưa mã QR vào khung hình. Hình ảnh được xử lý trên thiết bị.
      </p>
      <div className="camera-preview">
        {phase !== "scanning" && (
          <div className="camera-placeholder">
            <ScanLine size={72} strokeWidth={1.2} />
            <strong>Đặt mã QR vào khung hình</strong>
            <span>Camera chỉ bật khi bạn chọn mở camera.</span>
          </div>
        )}
        <video
          ref={video}
          muted
          playsInline
          aria-label="Khung camera quét mã QR"
          style={{
            display: phase === "scanning" ? "block" : "none",
            width: "100%",
            maxHeight: 380,
            background: "#10291f",
            borderRadius: 12,
          }}
        />
      </div>
      <div className="scanner-controls">
        {phase === "idle" ? (
          <button
            type="button"
            className="button"
            disabled={readingImage}
            onClick={() => void start()}
          >
            <Camera size={18} /> Mở camera
          </button>
        ) : (
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              release();
              setPhase("idle");
              setMessage("");
            }}
          >
            Tắt camera
          </button>
        )}
        <button
          type="button"
          className="button secondary"
          disabled={readingImage}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={18} /> Tải ảnh QR
        </button>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          aria-label="Chọn ảnh mã QR"
          onChange={(event) => {
            void readImage(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      <p className="muted scanner-privacy">
        Ảnh và camera được xử lý trên thiết bị của bạn.
      </p>
      {phase === "starting" && <p role="status">Đang mở camera…</p>}
      {phase === "scanning" && <p role="status">Đang tìm mã QR…</p>}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { prepareDeviceCredential } from "@/lib/device-credentials";
import { onboardingError } from "@/lib/enterprise-onboarding";
import { PendingCommandsPanel } from "@/components/pending-commands-panel";
import type { components } from "@/lib/generated/api";

type Device = components["schemas"]["IotDeviceRecordDto"];
type Credential = components["schemas"]["DeviceCredentialMetadataDto"];
type Command = {
  path: string;
  method: "POST" | "PATCH";
  body: string;
  key: string;
  token?: string;
};

export default function DevicesPage() {
  const auth = useAuth();
  if (
    !auth.user ||
    (auth.privateAccessStatus && auth.privateAccessStatus !== "ready")
  )
    return <p role="status">Đăng nhập và chờ kiểm tra quyền truy cập.</p>;
  return <DeviceFleet key={getAuthorizationScope(auth.user)} />;
}

function DeviceFleet() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [credentials, setCredentials] = useState<Record<string, Credential[]>>(
    {},
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Command | null>(null);
  const [secret, setSecret] = useState("");
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    try {
      const rows = await request<Device[]>("/iot/devices/managed");
      if (alive.current) {
        setDevices(rows);
        setCredentials({});
        setError("");
      }
    } catch (cause) {
      if (alive.current) {
        setDevices([]);
        setCredentials({});
        setSecret("");
        setError(onboardingError(cause));
      }
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function send(command: Command) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setPending(command);
    try {
      await request(command.path, {
        method: command.method,
        body: command.body,
        headers: { "idempotency-key": command.key },
      });
      if (!alive.current) return;
      setSecret(command.token ?? "");
      setPending(null);
      await refresh();
    } catch (cause) {
      if (!alive.current) return;
      setError(onboardingError(cause));
      // Only recovery's definitive rejection permits a different command/key.
      if ((cause as { canRestart?: boolean })?.canRestart) setPending(null);
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function command(
    path: string,
    body: object,
    method: "POST" | "PATCH" = "POST",
    token?: string,
  ) {
    return {
      path,
      body: JSON.stringify(body),
      method,
      key: crypto.randomUUID(),
      token,
    };
  }
  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || busy) return;
    const form = new FormData(event.currentTarget);
    void send(
      command("/iot/devices", {
        name: String(form.get("name")),
        deviceCode: String(form.get("deviceCode")),
        sourceType: "WOKWI_SIMULATED",
      }),
    );
  }
  async function issue(device: Device, rotate: boolean) {
    if (pending || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setSecret("");
    try {
      const prepared = await prepareDeviceCredential(device.version);
      if (!alive.current) return;
      inFlight.current = false;
      await send(
        command(
          `/iot/devices/${device.id}/credentials${rotate ? "/rotate" : ""}`,
          prepared.input,
          "POST",
          prepared.token,
        ),
      );
    } catch (cause) {
      if (alive.current) setError(onboardingError(cause));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function loadCredentials(device: Device) {
    try {
      const rows = await request<Credential[]>(
        `/iot/devices/${device.id}/credentials`,
      );
      if (alive.current)
        setCredentials((old) => ({ ...old, [device.id]: rows }));
    } catch (cause) {
      if (alive.current) {
        setCredentials({});
        setSecret("");
        setError(onboardingError(cause));
      }
    }
  }
  return (
    <div className="grid">
      <section className="page-header">
        <div>
          <p className="eyebrow">TÀI SẢN DOANH NGHIỆP</p>
          <h1>Thiết bị giám sát</h1>
          <p>Dành cho ORG_ADMIN của doanh nghiệp vận chuyển đã được duyệt.</p>
        </div>
        <Link href="/enterprise" className="text-link">
          Doanh nghiệp
        </Link>
      </section>
      <PendingCommandsPanel
        onSettled={() => {
          void refresh();
        }}
      />
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {pending && (
        <section className="panel">
          <p>
            Giữ nguyên yêu cầu đang chờ. Khi mất phản hồi, đối soát trước khi
            thực hiện thao tác khác.
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={() => void send(pending)}
          >
            Đối soát / thử lại yêu cầu gốc
          </button>
        </section>
      )}
      {secret && (
        <section className="panel">
          <h2>Credential vừa cấp</h2>
          <p>
            Chỉ hiện trong phiên này. Lưu riêng để cấu hình thiết bị; mất
            credential thì xoay khóa. Không đưa vào project Wokwi công khai.
          </p>
          <label className="field">
            Token thiết bị
            <input
              className="input"
              readOnly
              value={secret}
              autoComplete="off"
            />
          </label>
          <button className="button secondary" onClick={() => setSecret("")}>
            Ẩn credential
          </button>
        </section>
      )}
      <section className="panel">
        <h2>Đăng ký thiết bị Wokwi</h2>
        <form onSubmit={register}>
          <fieldset className="grid" disabled={busy || !!pending}>
            <label className="field">
              Tên thiết bị
              <input className="input" name="name" required maxLength={255} />
            </label>
            <label className="field">
              Mã thiết bị
              <input
                className="input"
                name="deviceCode"
                required
                maxLength={120}
              />
            </label>
            <button className="button" type="submit">
              Đăng ký thiết bị
            </button>
          </fieldset>
        </form>
      </section>
      <section className="panel">
        <h2>Thiết bị của tổ chức</h2>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Tải lại danh sách
        </button>
        <p>
          Tối đa 200 thiết bị gần nhất. Nguồn mô phỏng không phải dữ liệu cảm
          biến thực.
        </p>
        {!devices.length && <p>Chưa có thiết bị được phép quản lý.</p>}
        {devices.map((device) => (
          <article className="panel" key={device.id}>
            <h3>{device.name}</h3>
            <p>
              {device.deviceCode} ·{" "}
              {device.sourceType === "WOKWI_SIMULATED"
                ? "Mô phỏng Wokwi"
                : "Nguồn chưa xác định"}{" "}
              · {device.status === "ACTIVE" ? "Hoạt động" : "Ngừng hoạt động"}
            </p>
            <p>ID: {device.id}</p>
            <button
              className="button secondary"
              disabled={busy || !!pending}
              onClick={() =>
                void send(
                  command(
                    `/iot/devices/${device.id}/status`,
                    {
                      version: device.version,
                      status:
                        device.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                    },
                    "PATCH",
                  ),
                )
              }
            >
              {device.status === "ACTIVE"
                ? "Ngừng thiết bị"
                : "Kích hoạt thiết bị"}
            </button>{" "}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void loadCredentials(device)}
            >
              Xem credential
            </button>
            {credentials[device.id] && (
              <div>
                <p>
                  Credential demo hết hạn trong tối đa 2 giờ. API chỉ hiển thị
                  metadata; không khôi phục token.
                </p>
                <button
                  className="button"
                  disabled={busy || !!pending || device.status !== "ACTIVE"}
                  onClick={() =>
                    void issue(
                      device,
                      credentials[device.id].some((c) => !c.revokedAt),
                    )
                  }
                >
                  {credentials[device.id].some((c) => !c.revokedAt)
                    ? "Xoay credential"
                    : "Cấp credential"}
                </button>
                {credentials[device.id].map((c) => (
                  <p key={c.id}>
                    {c.id} ·{" "}
                    {c.revokedAt
                      ? "Đã thu hồi"
                      : new Date(c.expiresAt) <= new Date()
                        ? "Hết hạn"
                        : "Còn hiệu lực"}{" "}
                    · hết hạn {new Date(c.expiresAt).toLocaleString("vi-VN")}
                    {!c.revokedAt && (
                      <button
                        className="button secondary"
                        disabled={busy || !!pending}
                        onClick={() =>
                          void send(
                            command(
                              `/iot/devices/${device.id}/credentials/${c.id}/revoke`,
                              { version: device.version },
                            ),
                          )
                        }
                      >
                        Thu hồi
                      </button>
                    )}
                  </p>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

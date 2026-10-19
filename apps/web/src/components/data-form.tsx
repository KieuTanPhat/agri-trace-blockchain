"use client";
import { FormEvent, useId, useRef, useState } from "react";
import { request, retryPendingCommand } from "@/lib/api-client";
import { importantAction, useConfirm } from "@/lib/confirm";
export type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  requiredWhen?: { field: string; value: string };
  min?: number;
  maxLength?: number;
  pattern?: string;
  step?: number;
  minLength?: number;
  maxItems?: number;
  excludes?: string;
  /** Sent as this HTTP header instead of in the body (for example X-MFA-Code). */
  header?: string;
  /** Nests the value under this key of the JSON body. */
  nest?: string;
  dependsOn?: string;
  options?: { value: string; label: string; parentValue?: string }[];
};
export function DataForm({
  title,
  path,
  fields,
  extra = {},
  onSaved,
  method = "POST",
  freezeOnUnknown = false,
  initialValues = {},
}: {
  title: string;
  path: string;
  fields: Field[];
  extra?: Record<string, unknown>;
  onSaved(value: unknown): void;
  method?: "POST" | "PATCH";
  /** Keep sensitive, non-persisted command bodies in memory until reconciled. */
  freezeOnUnknown?: boolean;
  initialValues?: Record<string, string>;
}) {
  const formId = useId();
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [recoveryId, setRecoveryId] = useState("");
  const [canRestart, setCanRestart] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const busy = useRef(false);
  const confirm = useConfirm();
  const attempt = useRef({ body: "", path: "", key: "" });
  function failed(cause: unknown) {
    const status = (cause as { status?: number } | null)?.status;
    if (freezeOnUnknown && (!status || status >= 500 || status === 408))
      setUncertain(true);
    setRecoveryId(
      cause && typeof cause === "object" && "recoveryId" in cause
        ? String(cause.recoveryId)
        : "",
    );
    setCanRestart(
      Boolean(
        cause &&
        typeof cause === "object" &&
        "canRestart" in cause &&
        cause.canRestart,
      ),
    );
    setError(
      cause && typeof cause === "object" && "message" in cause
        ? String(cause.message)
        : "Không gửi được thao tác. Vui lòng thử lại.",
    );
  }
  async function recover() {
    if (busy.current || !recoveryId) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const result = await retryPendingCommand(recoveryId);
      setUncertain(false);
      setValues({});
      attempt.current = { body: "", path: "", key: "" };
      setRecoveryId("");
      setCanRestart(false);
      onSaved(result);
    } catch (cause) {
      failed(cause);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  function change(name: string, value: string) {
    if (uncertain && !fields.find((field) => field.name === name)?.header)
      return;
    setValues((current) => ({
      ...current,
      [name]: value,
      ...Object.fromEntries(
        fields.filter((f) => f.dependsOn === name || f.excludes === name).map((f) => [f.name, ""]),
      ),
    }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    if (uncertain && attempt.current.path !== method + path) {
      setError(
        "Yêu cầu trước chưa rõ kết quả. Đối soát hồ sơ ban đầu trước khi chuyển thao tác.",
      );
      return;
    }
    const filled = fields.filter((f) => values[f.name]?.trim());
    const convert = (f: Field) =>
      f.type === "number"
        ? Number(values[f.name])
        : f.type === "multiselect"
          ? values[f.name].split(",").filter(Boolean)
        : f.type === "checkbox"
          ? values[f.name] === "true"
          : f.type === "datetime-local"
            ? new Date(values[f.name]).toISOString()
            : f.type === "password"
              ? values[f.name]
              : values[f.name].trim();
    const nested: Record<string, Record<string, unknown>> = {};
    for (const f of filled)
      if (f.nest && !f.header) (nested[f.nest] ??= {})[f.name] = convert(f);
    const extraHeaders = Object.fromEntries(
      filled
        .filter((f) => f.header)
        .map((f) => [f.header as string, values[f.name].trim()]),
    );
    const merged: Record<string, unknown> = { ...extra };
    for (const [key, value] of Object.entries(nested))
      merged[key] = {
        ...((extra[key] as Record<string, unknown> | undefined) ?? {}),
        ...value,
      };
    const body = JSON.stringify({
      ...merged,
      ...Object.fromEntries(
        filled
          .filter((f) => !f.header && !f.nest)
          .map((f) => [f.name, convert(f)]),
      ),
    });
    const fresh =
      !uncertain &&
      (attempt.current.body !== body || attempt.current.path !== method + path);
    // A retry of an uncertain request was already confirmed; only new commands ask again.
    const warning = fresh ? importantAction(path) : null;
    if (warning && !(await confirm(warning, title))) return;
    if (fresh)
      attempt.current = { body, path: method + path, key: crypto.randomUUID() };
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const result = await request(path, {
        method,
        body: uncertain ? attempt.current.body : body,
        headers: { ...extraHeaders, "idempotency-key": attempt.current.key },
      });
      setValues({});
      attempt.current = { body: "", path: "", key: "" };
      setRecoveryId("");
      setCanRestart(false);
      setUncertain(false);
      onSaved(result);
    } catch (cause) {
      failed(cause);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <form className="panel" onSubmit={submit}>
      <h2>{title}</h2>
      <fieldset disabled={pending} className="management-fields">
        <div className="form-grid">
          {fields.map((f) => (
            <label className="field" key={f.name}>
              <span id={formId + f.name}>
                {f.label}
              </span>
              {f.options && f.type === "multiselect" ? (
                <select
                  multiple
                  size={Math.min(5, Math.max(2, f.options.length))}
                  disabled={uncertain && !f.header}
                  aria-labelledby={formId + f.name}
                  className="select"
                  value={(values[f.name] ?? "").split(",").filter(Boolean)}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions, (option) => option.value);
                    if (f.maxItems && selected.length > f.maxItems) {
                      setError(`Chọn tối đa ${f.maxItems} ảnh bổ sung.`);
                      return;
                    }
                    setError("");
                    change(f.name, selected.join(","));
                  }}
                >
                  {f.options.filter((o) => o.value !== values[f.excludes ?? ""]).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : f.options ? (
                <select
                  disabled={uncertain && !f.header}
                  aria-labelledby={formId + f.name}
                  className="select"
                  required={f.required || (f.requiredWhen && values[f.requiredWhen.field] === f.requiredWhen.value)}
                  value={values[f.name] ?? ""}
                  onChange={(e) => change(f.name, e.target.value)}
                >
                  <option value="">Chọn…</option>
                  {f.options
                    .filter(
                      (o) =>
                        !f.dependsOn || o.parentValue === values[f.dependsOn],
                    )
                    .map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                </select>
              ) : (
                <input
                  disabled={uncertain && !f.header}
                  aria-labelledby={formId + f.name}
                  className="input"
                  type={f.type ?? "text"}
                  min={f.min}
                  maxLength={f.maxLength}
                  pattern={f.pattern}
                  minLength={f.type === "password" ? 12 : f.minLength}
                  step={f.type === "number" ? (f.step ?? "any") : undefined}
                  required={f.required || (f.requiredWhen && values[f.requiredWhen.field] === f.requiredWhen.value)}
                  value={
                    f.type === "checkbox" ? undefined : (values[f.name] ?? "")
                  }
                  checked={
                    f.type === "checkbox"
                      ? values[f.name] === "true"
                      : undefined
                  }
                  onChange={(e) =>
                    change(
                      f.name,
                      f.type === "checkbox"
                        ? String(e.target.checked)
                        : e.target.value,
                    )
                  }
                />
              )}
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button className="button" disabled={pending}>
        {pending ? "Đang lưu…" : uncertain ? "Thử lại yêu cầu ban đầu" : title}
      </button>
      {uncertain && (
        <p className="notice">
          Giữ nguyên tab và yêu cầu để đối soát; chưa chuẩn bị yêu cầu mới khi
          kết quả chưa rõ.
        </p>
      )}
      {recoveryId && (
        <button
          className="button secondary"
          type="button"
          disabled={pending}
          onClick={() => void recover()}
        >
          Kiểm tra và thử lại yêu cầu trước
        </button>
      )}
      {canRestart && (
        <button
          className="button secondary"
          type="button"
          disabled={pending}
          onClick={() => {
            attempt.current = { body: "", path: "", key: "" };
            setCanRestart(false);
            setUncertain(false);
            setError("");
          }}
        >
          Chuẩn bị yêu cầu mới
        </button>
      )}
    </form>
  );
}

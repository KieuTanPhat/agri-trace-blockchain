"use client";
import { FormEvent, useId, useRef, useState } from "react";
import { request } from "@/lib/api-client";
export type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  min?: number;
  dependsOn?: string;
  options?: { value: string; label: string; parentValue?: string }[];
};
export function DataForm({
  title,
  path,
  fields,
  extra = {},
  onSaved,
}: {
  title: string;
  path: string;
  fields: Field[];
  extra?: Record<string, unknown>;
  onSaved(value: unknown): void;
}) {
  const formId = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const attempt = useRef({ body: "", path: "", key: "" });
  function change(name: string, value: string) {
    setValues((current) => ({
      ...current,
      [name]: value,
      ...Object.fromEntries(
        fields.filter((f) => f.dependsOn === name).map((f) => [f.name, ""]),
      ),
    }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const body = JSON.stringify({
      ...extra,
      ...Object.fromEntries(
        fields
          .filter((f) => values[f.name]?.trim())
          .map((f) => [
            f.name,
            f.type === "number"
              ? Number(values[f.name])
              : f.type === "datetime-local" || f.type === "date"
                ? new Date(values[f.name]).toISOString()
                : f.type === "password"
                  ? values[f.name]
                  : values[f.name].trim(),
          ]),
      ),
    });
    if (attempt.current.body !== body || attempt.current.path !== path)
      attempt.current = { body, path, key: crypto.randomUUID() };
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const result = await request(path, {
        method: "POST",
        body,
        headers: { "idempotency-key": attempt.current.key },
      });
      setValues({});
      attempt.current = { body: "", path: "", key: "" };
      onSaved(result);
    } catch (cause) {
      setError(
        typeof cause === "object" && cause && "message" in cause
          ? String(cause.message)
          : "Không gửi được thao tác. Vui lòng thử lại.",
      );
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
                {f.required ? " *" : ""}
              </span>
              {f.options ? (
                <select
                  aria-labelledby={formId + f.name}
                  className="select"
                  required={f.required}
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
                  aria-labelledby={formId + f.name}
                  className="input"
                  type={f.type ?? "text"}
                  min={f.min}
                  minLength={f.type === "password" ? 12 : undefined}
                  step={f.type === "number" ? "any" : undefined}
                  required={f.required}
                  value={values[f.name] ?? ""}
                  onChange={(e) => change(f.name, e.target.value)}
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
        {pending ? "Đang lưu…" : title}
      </button>
    </form>
  );
}

"use client";
import { Input } from "@/components/ledger/ui/input";
import { Label } from "@/components/ledger/ui/label";
import { Textarea } from "@/components/ledger/ui/textarea";
import { Checkbox } from "@/components/ledger/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ledger/ui/select";
import { t } from "@/lib/ledger/i18n";
import type { DocumentKind, RegistrationFiles } from "@/lib/registration-form";
export function RegistrationText({
  name,
  label,
  value,
  onChange,
  error,
  type = "text",
  wide,
  multiline,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  wide?: boolean;
  multiline?: boolean;
}) {
  const props = {
    id: name,
    value,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(event.target.value),
    "aria-invalid": !!error,
    "aria-describedby": `${name}-message`,
  };
  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 ${wide ? "sm:col-span-2" : ""}`}
    >
      <Label htmlFor={name} className="text-[13px] font-medium">
        {label}
      </Label>
      {multiline ? (
        <Textarea {...props} rows={3} />
      ) : (
        <Input {...props} type={type} />
      )}
      <span id={`${name}-message`} className="text-[12px] text-danger">
        {error}
      </span>
    </div>
  );
}
export function RegistrationSelect({
  name,
  label,
  value,
  onChange,
  options,
  error,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
  error?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={name} className="text-[13px] font-medium">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id={name}
          aria-invalid={!!error}
          aria-describedby={`${name}-message`}
          className="w-full bg-card"
        >
          <SelectValue placeholder={t("Chọn…")} />
        </SelectTrigger>
        <SelectContent>
          {options.map(([code, text]) => (
            <SelectItem key={code} value={code}>
              {t(text)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span id={`${name}-message`} className="text-[12px] text-danger">
        {error}
      </span>
    </div>
  );
}
export function RegistrationCheck({
  name,
  label,
  checked,
  onChange,
  disabled,
  error,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="flex items-start gap-2 text-[13px]">
        <Checkbox
          id={name}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onChange(value === true)}
          aria-invalid={!!error}
          aria-describedby={`${name}-message`}
        />
        <span>{label}</span>
      </label>
      <span id={`${name}-message`} className="text-[12px] text-danger">
        {error}
      </span>
    </div>
  );
}
export function RegistrationUpload({
  kind,
  label,
  files,
  onChange,
  error,
  onError,
}: {
  kind: DocumentKind;
  label: string;
  files: RegistrationFiles;
  onChange: (file: RegistrationFiles[DocumentKind]) => void;
  error?: string;
  onError: (message: string) => void;
}) {
  const logo = kind === "LOGO";
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
      <Label htmlFor={`upload-${kind}`} className="text-[13px] font-medium">
        {label}
      </Label>
      <Input
        id={`upload-${kind}`}
        type="file"
        className="max-w-full"
        accept={
          logo
            ? "image/jpeg,image/png,image/webp"
            : "application/pdf,image/jpeg,image/png"
        }
        aria-invalid={!!error}
        aria-describedby={`upload-${kind}-message`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) {
            onChange(undefined);
            return;
          }
          const allowed = logo
              ? ["image/jpeg", "image/png", "image/webp"]
              : ["application/pdf", "image/jpeg", "image/png"],
            limit = (logo ? 2 : 5) * 1024 * 1024;
          if (
            !allowed.includes(file.type) ||
            file.size === 0 ||
            file.size > limit
          ) {
            onError(
              logo
                ? t("Logo cần JPG/PNG/WebP tối đa 2 MB")
                : t("Tài liệu cần PDF/JPG/PNG tối đa 5 MB"),
            );
            event.target.value = "";
            return;
          }
          onChange({ id: crypto.randomUUID(), file });
        }}
      />
      <span className="min-w-0 break-all text-[12px] text-ink-2">
        {files[kind]?.file.name ??
          (logo ? t("Logo không bắt buộc") : t("Tài liệu được lưu riêng tư"))}
      </span>
      <span id={`upload-${kind}-message`} className="text-[12px] text-danger">
        {error}
      </span>
    </div>
  );
}

"use client";

import { createContext, useContext, useId } from "react";
import type { z } from "zod";
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { Input } from "@/components/ledger/ui/input";
import { Label } from "@/components/ledger/ui/label";
import { Textarea } from "@/components/ledger/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ledger/ui/select";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
interface Base<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  hint?: React.ReactNode;
  className?: string;
  /** Ghi đè khi schema không thể hiện được (bắt buộc theo điều kiện). */
  required?: boolean;
}

/** Schema của form đang mở; trường tự đọc để biết có bắt buộc không. */
export const FormSchemaContext = createContext<z.ZodType | null>(null);

type Def = { type?: string; innerType?: Def; in?: Def; shape?: Record<string, Def>; element?: Def; _zod?: { def: Def }; safeParse?: (v: unknown) => { success: boolean } };
const def = (s: Def | undefined) => s?._zod?.def;

/** Lần theo đường dẫn `a.0.b` trong schema object/array (bỏ qua pipe/optional). */
function fieldSchema(schema: Def | undefined, path: string) {
  let node = schema;
  for (const key of path.split(".")) {
    while (node && ["pipe", "optional", "nullable", "default"].includes(def(node)?.type ?? ""))
      node = def(node)!.in ?? def(node)!.innerType;
    if (!node) return undefined;
    const d = def(node);
    node = /^\d+$/.test(key) && d?.type === "array" ? d.element : d?.shape?.[key];
  }
  return node;
}

/** Bắt buộc khi cả giá trị rỗng lẫn undefined đều không qua schema. */
function useRequired(name: string, override?: boolean) {
  const schema = useContext(FormSchemaContext) as Def | null;
  if (override !== undefined) return override;
  const field = fieldSchema(schema ?? undefined, name);
  if (!field?.safeParse) return false;
  return !field.safeParse(undefined).success && !field.safeParse("").success;
}

function Shell({
  id,
  label,
  hint,
  error,
  counter,
  children,
  className,
  required,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string;
  counter?: string;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="gap-0.5 text-[13px] font-medium">
        {label}
        {required && <span aria-hidden className="text-danger after:content-['*']" />}
      </Label>
      {children}
      <div className="flex items-start justify-between gap-3 text-[12px]">
        <span id={`${id}-msg`} className={error ? "text-danger" : "text-ink-2"}>
          {error ?? hint}
        </span>
        {counter && (
          <span className="shrink-0 font-mono text-ink-2">{counter}</span>
        )}
      </div>
    </div>
  );
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  className,
  required,
  type = "text",
  placeholder,
  autoComplete,
  inputMode,
  max,
}: Base<T> & {
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  max?: number;
}) {
  const id = useId();
  const isRequired = useRequired(name, required);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Shell
          id={id}
          label={label}
          hint={hint}
          required={isRequired}
          error={fieldState.error?.message}
          className={className}
          counter={
            max ? `${String(field.value ?? "").length} / ${max}` : undefined
          }
        >
          <Input
            id={id}
            type={type}
            placeholder={placeholder}
            autoComplete={autoComplete}
            inputMode={inputMode}
            aria-invalid={!!fieldState.error}
            aria-required={isRequired || undefined}
            aria-describedby={`${id}-msg`}
            {...field}
            value={field.value ?? ""}
            onChange={(e) =>
              field.onChange(
                type === "number"
                  ? e.target.value === ""
                    ? ""
                    : Number(e.target.value)
                  : e.target.value,
              )
            }
          />
        </Shell>
      )}
    />
  );
}

export function TextAreaField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  className,
  required,
  max = 1000,
  rows = 3,
  placeholder,
}: Base<T> & { max?: number; rows?: number; placeholder?: string }) {
  const id = useId();
  const isRequired = useRequired(name, required);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Shell
          id={id}
          label={label}
          hint={hint}
          required={isRequired}
          error={fieldState.error?.message}
          className={className}
          counter={`${String(field.value ?? "").length} / ${max}`}
        >
          <Textarea
            id={id}
            rows={rows}
            placeholder={placeholder}
            aria-invalid={!!fieldState.error}
            aria-required={isRequired || undefined}
            aria-describedby={`${id}-msg`}
            {...field}
            value={field.value ?? ""}
          />
        </Shell>
      )}
    />
  );
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  className,
  required,
  options,
  placeholder = tr("Chọn…"),
  onValueChange,
}: Base<T> & {
  options: { value: string; label: string }[];
  placeholder?: string;
  onValueChange?: (value: string) => void;
}) {
  const id = useId();
  const isRequired = useRequired(name, required);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Shell
          id={id}
          label={label}
          hint={hint}
          required={isRequired}
          error={fieldState.error?.message}
          className={className}
        >
          <Select value={field.value ?? ""} onValueChange={value=>{field.onChange(value);onValueChange?.(value);}}>
            <SelectTrigger
              id={id}
              aria-describedby={`${id}-msg`}
              aria-invalid={!!fieldState.error}
            aria-required={isRequired || undefined}
              className="w-full"
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Shell>
      )}
    />
  );
}

/** Chọn nhiều mục bằng ô đánh dấu; giá trị là mảng theo thứ tự đã chọn. */
export function CheckListField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  className,
  required,
  options,
  empty,
}: Base<T> & {
  options: { value: string; label: string; help?: string }[];
  empty?: string;
}) {
  const id = useId();
  const isRequired = useRequired(name, required);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const picked = (field.value ?? []) as string[];
        return (
          <fieldset
            className={cn("flex flex-col gap-1.5", className)}
            aria-describedby={`${id}-msg`}
            aria-invalid={!!fieldState.error}
          >
            <legend className="mb-1.5 flex gap-0.5 text-[13px] font-medium">
              {label}
              {isRequired && <span aria-hidden className="text-danger after:content-['*']" />}
            </legend>
            <div className={cn("flex max-h-44 flex-col overflow-y-auto rounded-md border", fieldState.error ? "border-danger" : "border-line")}>
              {options.length === 0 && (
                <span className="px-3 py-2 text-[12.5px] text-ink-2">{empty ?? tr("Không có lựa chọn")}</span>
              )}
              {options.map((o) => (
                <label key={o.value} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-row-alt">
                  <input
                    type="checkbox"
                    className="accent-[var(--brand)]"
                    checked={picked.includes(o.value)}
                    onChange={(e) => {
                      field.onChange(e.target.checked ? [...picked, o.value] : picked.filter((v) => v !== o.value));
                      field.onBlur();
                    }}
                  />
                  <span className="flex-1">{o.label}</span>
                  {o.help && <span className="text-[12px] text-ink-2">{o.help}</span>}
                </label>
              ))}
            </div>
            <span id={`${id}-msg`} className={cn("text-[12px]", fieldState.error ? "text-danger" : "text-ink-2")}>
              {fieldState.error?.message ?? hint}
            </span>
          </fieldset>
        );
      }}
    />
  );
}

/** Nhóm lựa chọn dạng thẻ (radio) cho quyết định quan trọng. */
export function ChoiceField<T extends FieldValues>({
  control,
  name,
  label,
  options,
  className,
}: Base<T> & {
  options: { value: string; label: string; help?: string; tone?: "danger" }[];
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <fieldset className={cn("flex flex-col gap-2", className)}>
          <legend className="mb-1.5 text-[13px] font-medium">{label}</legend>
          {options.map((o) => {
            const on = field.value === o.value;
            return (
              <label
                key={o.value}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px] transition-colors",
                  on
                    ? o.tone === "danger"
                      ? "border-danger bg-danger-bg"
                      : "border-brand bg-brand-weak"
                    : "border-line hover:bg-row-alt",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={o.value}
                  checked={on}
                  onChange={() => field.onChange(o.value)}
                  className="mt-0.5 accent-[var(--brand)]"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{o.label}</span>
                  {o.help && (
                    <span className="text-[12px] text-ink-2">{o.help}</span>
                  )}
                </span>
              </label>
            );
          })}
          {fieldState.error && (
            <span className="text-[12px] text-danger">
              {fieldState.error.message}
            </span>
          )}
        </fieldset>
      )}
    />
  );
}

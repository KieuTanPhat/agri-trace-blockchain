"use client";

import { useId } from "react";
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
}

function Shell({
  id,
  label,
  hint,
  error,
  counter,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string;
  counter?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-[13px] font-medium">
        {label}
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
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Shell
          id={id}
          label={label}
          hint={hint}
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
  max = 1000,
  rows = 3,
  placeholder,
}: Base<T> & { max?: number; rows?: number; placeholder?: string }) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Shell
          id={id}
          label={label}
          hint={hint}
          error={fieldState.error?.message}
          className={className}
          counter={`${String(field.value ?? "").length} / ${max}`}
        >
          <Textarea
            id={id}
            rows={rows}
            placeholder={placeholder}
            aria-invalid={!!fieldState.error}
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
  options,
  placeholder = tr("Chọn…"),
}: Base<T> & {
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Shell
          id={id}
          label={label}
          hint={hint}
          error={fieldState.error?.message}
          className={className}
        >
          <Select value={field.value ?? ""} onValueChange={field.onChange}>
            <SelectTrigger
              id={id}
              aria-describedby={`${id}-msg`}
              aria-invalid={!!fieldState.error}
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

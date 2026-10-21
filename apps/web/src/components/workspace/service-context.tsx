"use client";
import { createContext, useContext, useState } from "react";
import type { components } from "@/lib/generated/api";
type Schemas = components["schemas"];
export type ServiceDraft = {
  input: Schemas["ServiceQuoteInput"];
  preview: Schemas["ServicePreviewView"];
};
const Context = createContext<{
  draft: ServiceDraft | null;
  setDraft: (draft: ServiceDraft | null) => void;
} | null>(null);
export function EnterpriseServiceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<ServiceDraft | null>(null);
  return (
    <Context.Provider value={{ draft, setDraft }}>{children}</Context.Provider>
  );
}
export function useServiceDraft() {
  const state = useContext(Context);
  if (!state) throw new Error("Service layout is required");
  return state;
}
export const money = (value: number) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
export function ServiceProgress({ step }: { step: number }) {
  return (
    <ol className="service-progress">
      {[
        "1. Chọn dịch vụ",
        "2. Xem hợp đồng",
        "3. Thanh toán",
        "4. Kết nối",
      ].map((label, i) => (
        <li aria-current={i === step ? "step" : undefined} key={label}>
          {label}
        </li>
      ))}
    </ol>
  );
}

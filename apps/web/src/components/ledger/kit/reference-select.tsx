"use client";

import { useWatch, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { ledgerRequest } from "@/lib/ledger/request";
import { t as tr } from "@/lib/ledger/i18n";
import { SelectField } from "./form-fields";

export type ReferenceCategory = "UNIT" | "PRODUCT_CATEGORY" | "CERTIFICATE_TYPE" | "VEHICLE_TYPE";
type Item = { code: string; label: string };

/** Units are stored by symbol ("kg"), as quantities and earlier records show them. */
const UNIT_SYMBOL: Record<string, string> = {
  G: "g", KG: "kg", TA: "tạ", TAN: "tấn", THUNG: "thùng", HOP: "hộp", GOI: "gói",
  BAO: "bao", CHAI: "chai", LIT: "lít", QUA: "quả", BO: "bó", CAY: "cây",
};

/** Active items of a platform reference list (managed by platform admins). */
export function useReferenceOptions(category: ReferenceCategory) {
  const q = useQuery({
    queryKey: ["reference-items", category],
    queryFn: () => ledgerRequest<{ items: Item[] }>(`/reference-data/items?category=${category}`),
    staleTime: 10 * 60_000,
  });
  return (q.data?.items ?? []).map((i) => {
    if (category !== "UNIT") return { value: i.label, label: i.label };
    const symbol = UNIT_SYMBOL[i.code] ?? i.label.toLocaleLowerCase("vi");
    return { value: symbol, label: symbol === i.label.toLocaleLowerCase("vi") ? i.label : `${i.label} (${symbol})` };
  });
}

/** Select from a reference list. A value saved before the list existed stays
 * selectable so editing an older record does not silently clear it. */
export function ReferenceSelectField<T extends FieldValues>({
  control,
  name,
  label,
  category,
  className,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  category: ReferenceCategory;
  className?: string;
}) {
  const options = useReferenceOptions(category);
  const current = useWatch({ control, name }) as string | undefined;
  const all = current && !options.some((o) => o.value === current)
    ? [...options, { value: current, label: tr("{p0} (giá trị cũ)", { p0: current }) }]
    : options;
  return <SelectField control={control} name={name} label={label} options={all} className={className} />;
}

"use client";
import Image from "next/image";
import { ChevronDown, MapPin } from "lucide-react";
import type { PublicLotTrace } from "@/lib/types";
import { fmtDate, fmtDateTime } from "@/lib/ledger/format";
const base =
  process.env.NEXT_PUBLIC_API_SAME_ORIGIN === "true"
    ? "/api"
    : (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api");
export function PublicJourney({
  groups,
}: {
  groups: PublicLotTrace["journey"];
}) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g, i) => (
        <details
          key={g.id}
          open={i === 0}
          className="group overflow-hidden rounded-2xl border border-line bg-card"
        >
          <summary className="flex cursor-pointer list-none items-center gap-3 p-5 [&::-webkit-details-marker]:hidden">
            {g.company?.logoUrl ? (
              <Image
                unoptimized
                src={base + g.company.logoUrl}
                alt={`Logo ${g.company.name}`}
                width={56}
                height={56}
                className="size-14 rounded-xl object-contain"
              />
            ) : (
              <MapPin className="size-8 shrink-0 text-brand" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-brand">
                {i + 1}. {g.stage}
              </p>
              <h3 className="font-semibold">{g.title}</h3>
              {g.address && <p className="text-sm text-ink-2">{g.address}</p>}
              <p className="mt-1 text-xs text-ink-2">
                {g.entries.length} hoạt động · {g.photos.length} ảnh
                {g.certificates.length
                  ? ` · ${g.certificates.length} chứng nhận`
                  : ""}
              </p>
            </div>
            <ChevronDown className="size-5 shrink-0 text-ink-2 group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-5 border-t border-line p-5">
            {g.company && (
              <div className="text-sm">
                <p className="font-medium">{g.company.name}</p>
                {g.company.phone && (
                  <p className="text-ink-2">Liên hệ: {g.company.phone}</p>
                )}
              </div>
            )}
            {!!g.facts.length && (
              <dl className="grid gap-3 rounded-xl bg-sunken p-4 sm:grid-cols-2">
                {g.facts.map((f, n) => (
                  <div key={n}>
                    <dt className="text-xs text-ink-2">{f.label}</dt>
                    <dd className="text-sm font-medium">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {!!g.photos.length && (
              <div className="flex snap-x gap-3 overflow-x-auto pb-2">
                {g.photos.map((p) => (
                  <figure key={p.id} className="w-64 shrink-0 snap-start">
                    <Image
                      unoptimized
                      src={base + p.url}
                      width={256}
                      height={170}
                      alt={p.caption}
                      className="h-40 w-full rounded-xl object-cover"
                    />
                    <figcaption className="mt-2 text-xs text-ink-2">
                      {p.caption}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            <ol className="flex flex-col gap-4">
              {g.entries.map((e) => (
                <li key={e.id} className="border-l-2 border-brand/25 pl-4">
                  <p className="text-sm font-semibold">{e.title}</p>
                  <p className="my-1 text-xs text-ink-2">
                    {fmtDateTime(e.time)}
                  </p>
                  {e.facts.map((f, n) => (
                    <p key={n} className="text-sm text-ink-2">
                      {f.label}: {f.value}
                    </p>
                  ))}
                </li>
              ))}
            </ol>
            {!!g.certificates.length && (
              <div className="flex flex-col gap-3">
                <h4 className="text-sm font-semibold">
                  Chứng nhận công khai tại đây
                </h4>
                {g.certificates.map((c, n) => (
                  <article key={n} className="rounded-xl bg-ok-bg p-4 text-sm">
                    <p className="font-medium">{c.type}</p>
                    <p>{c.issuer}</p>
                    <p className="text-xs text-ink-2">
                      {fmtDate(c.issueDate)}
                      {c.expiryDate ? ` → ${fmtDate(c.expiryDate)}` : ""}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

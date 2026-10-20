"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { LotTable } from "@/components/lot-table";
import { HarvestDialog } from "@/components/harvest-dialog";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { getLots } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import type { LotTrace } from "@/lib/types";
export default function LotsPage() {
  return (
    <Suspense>
      <Lots />
    </Suspense>
  );
}

function Lots() {
  // Opened from a product's detail page: only that product's lots.
  const product = useSearchParams().get("product") ?? "";
  const { user } = useAuth();
  const [lots, setLots] = useState<LotTrace[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    getLots()
      .then(setLots)
      .catch((cause) =>
        setError(cause?.message ?? "Không tải được danh sách lô."),
      );
  }, []);
  useEffect(load, [load]);

  return (
    <div className="grid">
      <section className="page-header">
        <div className="page-header-icon">

        </div>
        <div>
          <h1>Danh sách lô nông sản</h1>
        </div>
        <div className="header-actions">
          {user?.role.code === "FARM_STAFF" && (
            <HarvestDialog onCreated={load} />
          )}
        </div>
      </section>
      {error ? (
        <ErrorState
          status={503}
          title="Không tải được danh sách lô"
          message={error}
          actionLabel="Thử lại"
          onAction={load}
        />
      ) : lots ? (
        <>
          {product && (
            <p className="notice">
              <span>
                Đang xem lô của sản phẩm <strong>{product}</strong> ·{" "}
                <Link className="text-link" href="/lots">
                  Xem tất cả lô
                </Link>
              </span>
            </p>
          )}
          <LotTable
            lots={product ? lots.filter((lot) => lot.productName === product) : lots}
            withImages={!!user?.organizationId}
          />
        </>
      ) : (
        <LoadingState title="Đang tải danh sách lô" />
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { IconPackage } from "@/shared/ui/icons";
import { LotTable } from "@/features/lots/components/lot-table";
import { HarvestDialog } from "@/features/production-cycles/components/harvest-dialog";
import { LoadingState } from "@/shared/ui/loading-state";
import { ErrorState } from "@/shared/ui/error-state";
import { getLots } from "@/features/lots/api";
import { useAuth } from "@/features/auth/auth-store";
import type { LotTrace } from "@/shared/types/domain";

export default function LotsPage() {
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
    <div className="design-page lots-page">
      <section className="page-header">
        <div className="page-header-icon">
          <IconPackage size={32} />
        </div>
        <div>
          <p className="eyebrow">Quản lý lô</p>
          <h1>Danh sách lô nông sản</h1>
          <p className="muted">
            Theo dõi trạng thái, timeline và thao tác được backend cho phép trên
            từng lô.
          </p>
        </div>
        <div className="header-actions">
          {user && ["SYSTEM_ADMIN", "FARM_STAFF"].includes(user.role.code) && (
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
        <LotTable lots={lots} />
      ) : (
        <LoadingState title="Đang tải danh sách lô" />
      )}
    </div>
  );
}

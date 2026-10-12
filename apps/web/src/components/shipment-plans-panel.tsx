"use client";

import { useEffect, useState } from "react";
import { request } from "@/lib/api-client";
import { DataForm, type Field } from "./data-form";
import type { components } from "@/lib/generated/api";
import { sumQuantities } from "@/lib/quantity-display";

type Plan = components["schemas"]["ShipmentPlanRecordDto"];
type PlanningLot = components["schemas"]["PlanningLotDto"];
const parties = {
  PRODUCER: "Sản xuất",
  TRANSPORTER: "Vận chuyển",
  RETAILER: "Bán lẻ",
} as const;
const states = {
  DRAFT: "Đang lập kế hoạch",
  FINALIZED: "Đã tạo chuyến",
  CANCELLED: "Đã hủy",
};

export function ShipmentPlansPanel({
  chainId,
  organizationId,
  manager,
  orgAdmin,
  organizations,
}: {
  chainId: string;
  organizationId: string | null;
  manager: boolean;
  orgAdmin: boolean;
  organizations: { value: string; label: string }[];
}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [lots, setLots] = useState<PlanningLot[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedLot, setSelectedLot] = useState("");
  const path = `/supply-chains/${chainId}/shipment-plans`;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setPlans([]);
    setLots([]);
    setError("");
    Promise.all([
      request<Plan[]>(path),
      manager
        ? request<PlanningLot[]>(`${path}/planning-lots`)
        : Promise.resolve([]),
    ])
      .then(([records, available]) => {
        if (active) {
          setPlans(records);
          setLots(available);
        }
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, manager, revision]);
  const refresh = () => setRevision((value) => value + 1);
  const lot = lots.find((item) => item.id === selectedLot);
  const fields: Field[] = [
    {
      name: "transporterOrgId",
      label: "Đơn vị vận chuyển",
      required: true,
      options: organizations,
    },
    {
      name: "retailerOrgId",
      label: "Đơn vị bán lẻ",
      required: true,
      options: organizations,
    },
    { name: "origin", label: "Điểm lấy hàng", required: true, maxLength: 2000 },
    {
      name: "destination",
      label: "Điểm giao hàng",
      required: true,
      maxLength: 2000,
    },
    { name: "vehicleRef", label: "Phương tiện", maxLength: 255 },
    {
      name: "plannedPickupTime",
      label: "Dự kiến lấy hàng",
      type: "datetime-local",
    },
    {
      name: "expectedArrivalTime",
      label: "Dự kiến đến",
      type: "datetime-local",
    },
  ];
  const name = (id: string) =>
    organizations.find((org) => org.value === id)?.label ?? id;
  return (
    <section className="grid" aria-label="Kế hoạch vận chuyển">
      <div className="panel">
        <h2>Kế hoạch vận chuyển</h2>
        <p>
          Từng đơn vị xác nhận vai trò của mình trước khi chủ chuỗi tạo chuyến.
        </p>
        <button className="button secondary" onClick={refresh}>
          Tải lại kế hoạch
        </button>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Đang tải kế hoạch…</p>}
      {manager && !loading && (
        <div className="panel">
          <label className="field">
            <span>Lô cần điều phối</span>
            <select
              className="select"
              value={selectedLot}
              onChange={(event) => setSelectedLot(event.target.value)}
            >
              <option value="">Chọn lô…</option>
              {lots.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.lotCode} · {item.productName} · {item.quantity}{" "}
                  {item.unit}
                </option>
              ))}
            </select>
          </label>
          {lot && (
            <DataForm
              key={`${lot.id}:${lot.quantity}:${revision}`}
              title="Lập kế hoạch mới"
              path={path}
              fields={fields}
              extra={{ lotId: lot.id, quantity: lot.quantity, unit: lot.unit }}
              onSaved={() => {
                setSelectedLot("");
                refresh();
              }}
            />
          )}
          {!lots.length && <p>Chưa có lô sẵn sàng để lập kế hoạch.</p>}
        </div>
      )}
      {!loading && !plans.length && (
        <p>Chưa có kế hoạch trong phạm vi được cấp.</p>
      )}
      {plans.map((plan) => {
        const current = plan.current;
        const roles = {
          PRODUCER: current.producerOrgId,
          TRANSPORTER: current.transporterOrgId,
          RETAILER: current.retailerOrgId,
        };
        const internal =
          current.producerOrgId === current.transporterOrgId &&
          current.transporterOrgId === current.retailerOrgId;
        const accepted = new Set(
          current.acceptances.map((consent) => consent.party),
        );
        const stock = lots.find((lot) => lot.id === plan.lotId);
        const stockChanged =
          manager &&
          stock &&
          (sumQuantities([stock.quantity]) !==
            sumQuantities([current.quantity]) ||
            stock.unit !== current.unit);
        return (
          <article
            className="panel grid"
            key={`${plan.id}:${plan.version}:${revision}`}
          >
            <h3>
              {states[plan.status as keyof typeof states]} · bản{" "}
              {plan.currentRevision + 1}
            </h3>
            <p>
              {current.quantity} {current.unit} · {current.origin} →{" "}
              {current.destination}
            </p>
            {internal && (
              <p className="notice">Bàn giao nội bộ trong cùng doanh nghiệp.</p>
            )}
            {!internal &&
              current.producerOrgId === current.transporterOrgId && (
                <p className="notice">
                  Bàn giao sản xuất sang vận chuyển là nội bộ.
                </p>
              )}
            {!internal &&
              current.transporterOrgId === current.retailerOrgId && (
                <p className="notice">
                  Bàn giao vận chuyển sang bán lẻ là nội bộ.
                </p>
              )}
            <ul>
              {(Object.keys(parties) as (keyof typeof parties)[]).map(
                (party) => (
                  <li key={party}>
                    {parties[party]}: {name(roles[party])} —{" "}
                    {accepted.has(party) ? "Đã xác nhận" : "Chờ xác nhận"}
                    {plan.status === "DRAFT" &&
                      orgAdmin &&
                      roles[party] === organizationId &&
                      !accepted.has(party) && (
                        <DataForm
                          title={`Xác nhận vai trò ${parties[party].toLowerCase()}`}
                          path={`${path}/${plan.id}/accept`}
                          fields={[]}
                          extra={{
                            party,
                            revision: plan.currentRevision,
                            payloadDigest: current.payloadDigest,
                          }}
                          onSaved={refresh}
                        />
                      )}
                  </li>
                ),
              )}
            </ul>
            {plan.status === "DRAFT" && manager && (
              <>
                {stockChanged && (
                  <p className="notice">
                    Lượng khả dụng đã thay đổi. Sửa kế hoạch và yêu cầu ba bên
                    xác nhận lại.
                  </p>
                )}
                {stock && (
                  <DataForm
                    title="Sửa kế hoạch và yêu cầu xác nhận lại"
                    path={`${path}/${plan.id}/revise`}
                    fields={fields}
                    extra={{
                      version: plan.version,
                      quantity: stock.quantity,
                      unit: stock.unit,
                    }}
                    onSaved={refresh}
                  />
                )}
                <DataForm
                  title="Hủy kế hoạch"
                  path={`${path}/${plan.id}/cancel`}
                  fields={[]}
                  extra={{ version: plan.version }}
                  onSaved={refresh}
                />
                {accepted.size === 3 && stock && !stockChanged && (
                  <DataForm
                    title="Tạo chuyến theo kế hoạch đã xác nhận"
                    path={`${path}/${plan.id}/finalize`}
                    fields={[]}
                    extra={{ version: plan.version }}
                    onSaved={refresh}
                  />
                )}
              </>
            )}
            {plan.shipmentId && (
              <p>Đã tạo chuyến vận chuyển từ bản được ba bên xác nhận.</p>
            )}
          </article>
        );
      })}
    </section>
  );
}

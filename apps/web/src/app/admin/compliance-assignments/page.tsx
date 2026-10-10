"use client";
import { useCallback, useEffect, useState } from "react";
import { DataForm } from "@/components/data-form";
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import type { components } from "@/lib/generated/api";
import type { Catalog } from "@/lib/catalog";
type Assignment = components["schemas"]["AssignmentListDto"];
type User = components["schemas"]["UserListDto"];

export default function AssignmentsPage() {
  const { user } = useAuth();
  const allowed = user?.role.code === "SYSTEM_ADMIN";
  const [data, setData] = useState<{
    assignments: Assignment[];
    users: User[];
    catalog: Catalog;
  } | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!allowed) return;
    setError("");
    try {
      const [assignments, users, catalog] = await Promise.all([
        request<Assignment[]>("/compliance/assignments"),
        request<User[]>("/users"),
        request<Catalog>("/catalog"),
      ]);
      setData({ assignments, users, catalog });
    } catch (cause) {
      setError(
        String(
          (cause as { message?: string })?.message ??
            "Không tải được phân công.",
        ),
      );
    }
  }, [allowed]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!allowed)
    return <p className="notice error">Chỉ quản trị viên quản lý phân công.</p>;
  const active = data?.assignments.find(
    (item) => item.id === selected && !item.revokedAt,
  );
  return (
    <div className="grid">
      <section className="page-header">
        <h1>Phân công người duyệt theo nông trại</h1>
        <button className="button secondary" onClick={() => void load()}>
          Tải lại
        </button>
      </section>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {data ? (
        <>
          <DataForm
            title="Cấp phân công"
            path="/compliance/assignments"
            onSaved={() => void load()}
            fields={[
              {
                name: "reviewerUserId",
                label: "Người duyệt đang hoạt động",
                required: true,
                options: data.users
                  .filter(
                    (item) =>
                      item.accountStatus === "ACTIVE" &&
                      item.role.code === "COMPLIANCE_REVIEWER" &&
                      item.organization?.type === "AUDITOR",
                  )
                  .map((item) => ({
                    value: item.id,
                    label: item.fullName + " — " + item.email,
                  })),
              },
              {
                name: "farmId",
                label: "Nông trại",
                required: true,
                options: data.catalog.farms
                  .filter(
                    (item) =>
                      item.status === "ACTIVE" &&
                      item.organization.status === "ACTIVE",
                  )
                  .map((item) => ({ value: item.id, label: item.name })),
              },
              {
                name: "reason",
                label: "Lý do cấp phân công",
                required: true,
                maxLength: 1000,
              },
            ]}
          />
          <label className="field">
            Phân công cần thu hồi
            <select
              className="select"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">Chọn phân công</option>
              {data.assignments
                .filter((item) => !item.revokedAt)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.farm.name} —{" "}
                    {data.users.find(
                      (entry) => entry.id === item.reviewerUserId,
                    )?.fullName ?? item.reviewerUserId}
                  </option>
                ))}
            </select>
          </label>
          {active && (
            <DataForm
              key={active.id}
              title="Thu hồi phân công"
              path={`/compliance/assignments/${active.id}/revoke`}
              fields={[
                {
                  name: "reason",
                  label: "Lý do thu hồi",
                  required: true,
                  maxLength: 1000,
                },
              ]}
              onSaved={() => {
                setSelected("");
                void load();
              }}
            />
          )}
          <section className="panel">
            <h2>Lịch sử phân công</h2>
            {data.assignments.map((item) => (
              <article key={item.id}>
                <h3>{item.farm.name}</h3>
                <p>
                  {data.users.find((entry) => entry.id === item.reviewerUserId)
                    ?.fullName ?? item.reviewerUserId}{" "}
                  · {item.revokedAt ? "Đã thu hồi" : "Đang hoạt động"}
                </p>
                <ul>
                  {item.audits.map((audit) => (
                    <li key={audit.id}>
                      {audit.action === "GRANTED" ? "Cấp" : "Thu hồi"} —{" "}
                      {audit.recordedAt}: {audit.reason}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        </>
      ) : (
        <p role="status">Đang tải phân công...</p>
      )}
    </div>
  );
}

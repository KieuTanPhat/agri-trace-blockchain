"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-store";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { request, getOrganizations } from "@/lib/api-client";
import { DataForm } from "@/components/data-form";
import { ShipmentPlansPanel } from "@/components/shipment-plans-panel";
import type { components } from "@/lib/generated/api";
import type { Organization } from "@/lib/types";

type Chain = components["schemas"]["ChainRecordDto"];
type Member = components["schemas"]["MemberRecordDto"];
type Context = components["schemas"]["ChainContextDto"];
type ScopedUser = components["schemas"]["ScopedUserDto"];
type Grant = components["schemas"]["GrantRecordDto"];

const states: Record<string, string> = {
  INVITED: "Được mời",
  ACTIVE: "Đang tham gia",
  SUSPENDED: "Tạm ngừng",
  REVOKED: "Đã thu hồi",
};
const roleLabels: Record<string, string> = {
  ORG_ADMIN: "Quản trị tổ chức",
  CREATE_CHAIN: "Tạo chuỗi",
  CHAIN_MANAGER: "Điều phối chuỗi",
  FARM_STAFF: "Sản xuất",
  TRANSPORTER: "Vận chuyển",
  RETAILER: "Bán lẻ",
  AUDITOR: "Tra cứu kiểm toán",
  COMPLIANCE_REVIEWER: "Duyệt kiểm định",
};

export default function SupplyChainsPage() {
  const { user } = useAuth();
  if (!user) return null;
  // Account or organization changes discard every outstanding selection/form.
  return (
    <ChainWorkspace
      key={getAuthorizationScope(user)}
      organizationId={user.organizationId ?? null}
      platformAdmin={user.role.code === "SYSTEM_ADMIN"}
    />
  );
}

function ChainWorkspace({
  organizationId,
  platformAdmin,
}: {
  organizationId: string | null;
  platformAdmin: boolean;
}) {
  const [context, setContext] = useState<Context | null>(null);
  const [chains, setChains] = useState<Chain[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selected, setSelected] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [adminOrg, setAdminOrg] = useState(organizationId ?? "");
  const [users, setUsers] = useState<ScopedUser[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setContext(null);
    setChains([]);
    Promise.all([
      request<Context>("/chain-permissions"),
      request<Chain[]>("/supply-chains"),
      getOrganizations(),
    ])
      .then(([permissions, list, directory]) => {
        if (active) {
          setContext(permissions);
          setChains(list);
          setOrganizations(directory);
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
  }, [revision]);

  useEffect(() => {
    let active = true;
    setMembers([]);
    if (selected)
      request<Member[]>(`/supply-chains/${selected}/memberships`)
        .then((value) => {
          if (active) setMembers(value);
        })
        .catch((cause: Error) => {
          if (active) setError(cause.message);
        });
    return () => {
      active = false;
    };
  }, [selected, revision]);

  const orgAdmin =
    context?.grants.some(
      (g) => g.scope === "ORGANIZATION" && g.role === "ORG_ADMIN",
    ) ?? false;
  useEffect(() => {
    let active = true;
    setUsers([]);
    setGrants([]);
    if (adminOrg && (platformAdmin || orgAdmin))
      Promise.all([
        request<ScopedUser[]>(`/organizations/${adminOrg}/scoped-users`),
        request<Grant[]>(`/organizations/${adminOrg}/scoped-grants`),
      ])
        .then(([people, permissions]) => {
          if (active) {
            setUsers(people);
            setGrants(permissions);
          }
        })
        .catch((cause: Error) => {
          if (active) setError(cause.message);
        });
    return () => {
      active = false;
    };
  }, [adminOrg, platformAdmin, orgAdmin, revision]);

  const refresh = () => setRevision((value) => value + 1);
  const chain = chains.find((item) => item.id === selected);
  const manager =
    chain?.ownerOrganizationId === organizationId &&
    context?.grants.some(
      (g) => g.chainId === selected && g.role === "CHAIN_MANAGER",
    );
  const canCreate = context?.grants.some(
    (g) => g.scope === "ORGANIZATION" && g.role === "CREATE_CHAIN",
  );
  const name = (id: string) =>
    organizations.find((org) => org.organizationId === id)?.name ?? id;

  return (
    <div className="grid">
      <section className="page-header">
        <h1>Chuỗi và đối tác</h1>
        <button className="button secondary" onClick={refresh}>
          Tải lại quyền và dữ liệu
        </button>
      </section>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Đang tải chuỗi được cấp quyền…</p>}
      {context?.legacyPendingManifests?.length ? (
        <section className="panel">
          <h2>Dữ liệu cần xác nhận chuyển sang chuỗi</h2>
          {context.legacyPendingManifests.map((item, index) => (
            <p key={item.manifestId}>
              <Link href={`/supply-chains/legacy/${item.manifestId}`}>
                Mở bản xác nhận {index + 1}
              </Link>
            </p>
          ))}
        </section>
      ) : null}
      {canCreate && (
        <DataForm
          title="Tạo chuỗi cung ứng"
          path="/supply-chains"
          fields={[
            {
              name: "name",
              label: "Tên chuỗi",
              required: true,
              maxLength: 255,
            },
          ]}
          onSaved={refresh}
        />
      )}
      <section className="panel">
        <h2>Chuỗi của tổ chức</h2>
        {!loading && !chains.length && (
          <p>Bạn chưa có chuỗi hoặc lời mời trong phạm vi được cấp.</p>
        )}
        <label className="field">
          <span>Chọn chuỗi</span>
          <select
            className="select"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setMembers([]);
              setError("");
            }}
          >
            <option value="">Chọn…</option>
            {chains.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {chain && <p>Chủ chuỗi: {name(chain.ownerOrganizationId)}</p>}
      </section>
      {chain && (
        <section className="panel">
          <h2>Thành viên</h2>
          {members.map((member) => (
            <div key={`${member.id}:${member.version}`} className="grid">
              <p>
                {name(member.organizationId)} —{" "}
                {states[member.status] ?? member.status}
              </p>
              {member.status === "INVITED" &&
                member.organizationId === organizationId &&
                orgAdmin && (
                  <DataForm
                    title="Chấp nhận tham gia"
                    path={`/supply-chains/${selected}/memberships/${member.organizationId}/accept`}
                    extra={{ version: member.version }}
                    fields={[]}
                    onSaved={refresh}
                  />
                )}
              {manager && member.organizationId !== organizationId && (
                <DataForm
                  title="Cập nhật tham gia"
                  path={`/supply-chains/${selected}/memberships/${member.organizationId}/status`}
                  extra={{ version: member.version }}
                  fields={[
                    {
                      name: "status",
                      label: "Trạng thái",
                      required: true,
                      options: (member.status === "REVOKED"
                        ? ["INVITED"]
                        : member.status === "SUSPENDED"
                          ? ["INVITED", "REVOKED"]
                          : ["SUSPENDED", "REVOKED"]
                      ).map((value) => ({ value, label: states[value] })),
                    },
                  ]}
                  onSaved={refresh}
                />
              )}
            </div>
          ))}
        </section>
      )}
      {manager && (
        <DataForm
          key={selected + ":invite"}
          title="Mời đối tác"
          path={`/supply-chains/${selected}/memberships`}
          fields={[
            {
              name: "organizationId",
              label: "Tổ chức",
              required: true,
              options: organizations
                .filter(
                  (org) =>
                    !members.some(
                      (member) => member.organizationId === org.organizationId,
                    ),
                )
                .map((org) => ({ value: org.organizationId, label: org.name })),
            },
          ]}
          onSaved={refresh}
        />
      )}
      {(platformAdmin || orgAdmin) && (
        <section className="panel">
          <h2>Quyền của tổ chức</h2>
          {platformAdmin && (
            <label className="field">
              <span>Tổ chức quản lý</span>
              <select
                className="select"
                value={adminOrg}
                onChange={(e) => setAdminOrg(e.target.value)}
              >
                <option value="">Chọn…</option>
                {organizations.map((org) => (
                  <option key={org.organizationId} value={org.organizationId}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {adminOrg && (
            <div className="grid" key={adminOrg + ":" + selected}>
              <DataForm
                title="Bổ sung năng lực"
                path={`/organizations/${adminOrg}/capabilities`}
                fields={[
                  {
                    name: "code",
                    label: "Năng lực",
                    required: true,
                    options: (platformAdmin
                      ? ["FARM", "TRANSPORTER", "RETAILER", "AUDITOR"]
                      : ["FARM", "TRANSPORTER", "RETAILER"]
                    ).map((value) => ({
                      value,
                      label: (
                        {
                          FARM: "Sản xuất",
                          TRANSPORTER: "Vận chuyển",
                          RETAILER: "Bán lẻ",
                          AUDITOR: "Kiểm toán",
                        } as Record<string, string>
                      )[value],
                    })),
                  },
                ]}
                onSaved={refresh}
              />
              {platformAdmin && (
                <DataForm
                  title="Cấp quyền quản trị tổ chức"
                  path={`/organizations/${adminOrg}/scoped-grants`}
                  fields={[
                    {
                      name: "userId",
                      label: "Người được cấp",
                      required: true,
                      options: users.map((u) => ({
                        value: u.id,
                        label: u.fullName,
                      })),
                    },
                    {
                      name: "role",
                      label: "Quyền",
                      required: true,
                      options: ["ORG_ADMIN", "CREATE_CHAIN"].map((value) => ({
                        value,
                        label: roleLabels[value],
                      })),
                    },
                  ]}
                  onSaved={refresh}
                />
              )}
              {selected &&
                members.some(
                  (member) =>
                    member.organizationId === adminOrg &&
                    member.status === "ACTIVE",
                ) && (
                  <DataForm
                    title="Cấp vai trò trong chuỗi đã chọn"
                    path={`/organizations/${adminOrg}/scoped-grants`}
                    extra={{ chainId: selected }}
                    fields={[
                      {
                        name: "userId",
                        label: "Người thực hiện",
                        required: true,
                        options: users.map((u) => ({
                          value: u.id,
                          label: u.fullName,
                        })),
                      },
                      {
                        name: "role",
                        label: "Vai trò",
                        required: true,
                        options: (platformAdmin
                          ? [
                              "CHAIN_MANAGER",
                              "FARM_STAFF",
                              "TRANSPORTER",
                              "RETAILER",
                              "AUDITOR",
                              "COMPLIANCE_REVIEWER",
                            ]
                          : ["FARM_STAFF", "TRANSPORTER", "RETAILER"]
                        ).map((value) => ({ value, label: roleLabels[value] })),
                      },
                    ]}
                    onSaved={refresh}
                  />
                )}
              <section className="panel">
                <h3>Quyền đang có hiệu lực</h3>
                {grants
                  .filter(
                    (grant) => !grant.chainId || grant.chainId === selected,
                  )
                  .map((grant) => (
                    <div className="grid" key={`${grant.id}:${grant.revision}`}>
                      <p>
                        {users.find((person) => person.id === grant.userId)
                          ?.fullName ?? grant.userId}{" "}
                        — {roleLabels[grant.role]} (
                        {grant.chainId ? "chuỗi đã chọn" : "tổ chức"})
                      </p>
                      {(platformAdmin ||
                        ["FARM_STAFF", "TRANSPORTER", "RETAILER"].includes(
                          grant.role,
                        )) && (
                        <DataForm
                          title="Thu hồi quyền"
                          path={`/organizations/${adminOrg}/scoped-grants/${grant.id}/revoke`}
                          fields={[]}
                          extra={{
                            version: grant.revision,
                            ...(grant.chainId
                              ? { chainId: grant.chainId }
                              : {}),
                          }}
                          onSaved={refresh}
                        />
                      )}
                    </div>
                  ))}
              </section>
            </div>
          )}
        </section>
      )}
      {selected && context?.businessChains?.includes(selected) && (
        <ShipmentPlansPanel
          key={`${selected}:${revision}`}
          chainId={selected}
          organizationId={organizationId}
          manager={Boolean(manager)}
          orgAdmin={orgAdmin}
          organizations={members
            .filter((member) => member.status === "ACTIVE")
            .map((member) => ({
              value: member.organizationId,
              label: name(member.organizationId),
            }))}
        />
      )}
    </div>
  );
}

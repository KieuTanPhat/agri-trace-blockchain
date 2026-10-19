"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-store";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { request, getOrganizations } from "@/lib/api-client";
import { DataForm } from "@/components/data-form";
import { LedgerStatusPanel } from "@/components/ledger-status-panel";
import { SigningKeysPanel } from "@/components/signing-keys-panel";
import { ShipmentPlansPanel } from "@/components/shipment-plans-panel";
import { BusinessProfilePanel } from "@/components/business-profile-panel";
import { EvidencePanel } from "@/components/workspace/evidence-panel";
import { EntityThumb } from "@/components/workspace/entity-thumb";
import { useWorkspaceData, type Catalog } from "@/lib/workspace";
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
  DISTRIBUTOR: "Nhà phân phối",
  AUDITOR: "Tra cứu kiểm toán",
  COMPLIANCE_REVIEWER: "Duyệt kiểm định",
};

type ChainView =
  "chains" | "members" | "roles" | "business" | "ledger" | "signing" | "plans";
export default function ChainManagement({
  view = "chains",
  initialChainId = "",
}: {
  view?: ChainView;
  initialChainId?: string;
}) {
  const { user } = useAuth();
  if (!user) return null;
  // Account or organization changes discard every outstanding selection/form.
  return (
    <ChainWorkspace
      key={getAuthorizationScope(user)}
      organizationId={user.organizationId ?? null}
      platformAdmin={user.role.code === "SYSTEM_ADMIN"}
      view={view}
      initialChainId={initialChainId}
    />
  );
}

function ChainWorkspace({
  organizationId,
  platformAdmin,
  view,
  initialChainId,
}: {
  organizationId: string | null;
  platformAdmin: boolean;
  view: ChainView;
  initialChainId: string;
}) {
  const [context, setContext] = useState<Context | null>(null);
  const [chains, setChains] = useState<Chain[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selected, setSelected] = useState(initialChainId);
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
  const catalog = useWorkspaceData<Catalog>("/catalog");
  const canCreate = context?.grants.some(
    (g) => g.scope === "ORGANIZATION" && g.role === "CREATE_CHAIN",
  );
  const name = (id: string) =>
    organizations.find((org) => org.organizationId === id)?.name ?? id;

  return (
    <div className="grid">
      <section className="page-header">
        <div>
          <Link className="manage-back" href="/supply-chains">
            Chuỗi truy xuất
          </Link>
          <h1>
            {
              (
                {
                  chains: "Chuỗi truy xuất",
                  members: "Thành viên chuỗi",
                  roles: "Quyền trong chuỗi",
                  business: "Phân công nghiệp vụ",
                  ledger: "Trạng thái bằng chứng",
                  signing: "Khóa ký chuỗi",
                  plans: "Kế hoạch chuyến hàng",
                } as Record<ChainView, string>
              )[view]
            }
          </h1>
        </div>
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
      {view === "chains" && canCreate && (
        <DataForm
          title="Tạo chuỗi truy xuất"
          path="/supply-chains"
          fields={[
            {
              name: "name",
              label: "Tên chuỗi",
              required: true,
              maxLength: 255,
            },
            { name: "chainType", label: "Loại chuỗi", required: true, options: [{ value: "CROP", label: "Nông sản trồng trọt" }] },
            { name: "description", label: "Mô tả chuỗi", maxLength: 2000 },
            { name: "plannedStartDate", label: "Ngày bắt đầu hoạt động", type: "date" },
            { name: "productIds", label: "Sản phẩm liên kết (không bắt buộc)", type: "multiselect", maxItems: 50, options: (catalog.data?.products ?? []).filter((product) => product.status === "ACTIVE").map((product) => ({ value: product.id, label: product.productName })) },
            { name: "note", label: "Ghi chú khác", maxLength: 2000 },
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
        {chain && <div className="chain-summary"><EntityThumb entityType="CHAIN" entityId={chain.id} kinds={["CHAIN_IMAGE"]} name={chain.name} /><p>Mã chuỗi: {chain.code ?? chain.id} · Chủ chuỗi: {name(chain.ownerOrganizationId)} · {chain.chainType === "CROP" ? "Nông sản trồng trọt" : chain.chainType}</p></div>}
        {chain && view === "chains" && (
          <div className="workspace-grid">
            {[
              ["members", "Thành viên chuỗi"],
              ["roles", "Quyền trong chuỗi"],
              ["business", "Phân công nghiệp vụ"],
              ["ledger", "Trạng thái bằng chứng"],
              ["signing", "Khóa ký chuỗi"],
              ["plans", "Kế hoạch chuyến hàng"],
            ].map(([path, title]) => (
              <Link
                className="workspace-tile"
                key={path}
                href={`/supply-chains/${selected}/${path}`}
              >
                <h2>{title}</h2>
                <span className="text-link">Mở chức năng →</span>
              </Link>
            ))}
          </div>
        )}
        {chain && view === "chains" && chain.ownerOrganizationId === organizationId && (
          <EvidencePanel entityType="CHAIN" entityId={chain.id} />
        )}
      </section>
      {view === "business" && chain && !platformAdmin && (
        <BusinessProfilePanel
          key={`profile:${selected}:${revision}`}
          chainId={selected}
          canActivate={Boolean(
            manager &&
            context?.memberships.some(
              (m) =>
                m.chainId === selected &&
                m.organizationId === organizationId &&
                m.status === "ACTIVE",
            ),
          )}
          onChanged={refresh}
        />
      )}
      {view === "members" && chain && (
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
      {view === "members" && manager && (
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
      {view === "roles" && (platformAdmin || orgAdmin) && (
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
              {platformAdmin && (
                <DataForm
                  title="Bổ sung năng lực"
                  path={`/organizations/${adminOrg}/capabilities`}
                  fields={[
                    {
                      name: "code",
                      label: "Năng lực",
                      required: true,
                      options: (platformAdmin
                        ? [
                            "FARM",
                            "TRANSPORTER",
                            "DISTRIBUTOR",
                            "RETAILER",
                            "AUDITOR",
                          ]
                        : ["FARM", "TRANSPORTER", "RETAILER"]
                      ).map((value) => ({
                        value,
                        label: (
                          {
                            FARM: "Sản xuất",
                            TRANSPORTER: "Vận chuyển",
                            RETAILER: "Bán lẻ",
                            DISTRIBUTOR: "Nhà phân phối",
                            AUDITOR: "Kiểm toán",
                          } as Record<string, string>
                        )[value],
                      })),
                    },
                  ]}
                  onSaved={refresh}
                />
              )}
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
                          : [
                              "FARM_STAFF",
                              "TRANSPORTER",
                              "DISTRIBUTOR",
                              "RETAILER",
                            ]
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
                        [
                          "FARM_STAFF",
                          "TRANSPORTER",
                          "DISTRIBUTOR",
                          "RETAILER",
                        ].includes(grant.role)) && (
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
      {view === "ledger" && selected && chain && !platformAdmin && (
        <LedgerStatusPanel
          key={`ledger:${selected}:${revision}`}
          chainId={selected}
        />
      )}
      {view === "signing" &&
        selected &&
        chain &&
        !platformAdmin &&
        organizationId && (
          <SigningKeysPanel
            key={`keys:${selected}:${revision}`}
            chainId={selected}
            organizationId={organizationId}
            orgAdmin={orgAdmin}
          />
        )}
      {view === "plans" &&
        selected &&
        context?.businessChains?.includes(selected) && (
          <ShipmentPlansPanel
            key={`plans:${selected}:${revision}`}
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

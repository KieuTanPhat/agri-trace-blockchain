"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  useWorkspaceCommand,
  useWorkspaceData,
  textValue,
  type Catalog,
  type EnterpriseMember,
  type EnterpriseRole,
  type EnterpriseSite,
  type Items,
  type Overview,
} from "@/lib/workspace";
import type { components } from "@/lib/generated/api";
import {
  CommandState,
  InfoDialog,
  LoadState,
  PageHeader,
} from "@/components/manage";
import {
  EvidenceInputs,
  checkEvidenceInputs,
  uploadEvidenceFiles,
} from "./evidence-panel";
export function MemberForm({ id }: { id?: string }) {
  const router = useRouter(),
    cmd = useWorkspaceCommand(),
    roles = useWorkspaceData<Items<EnterpriseRole>>(
      "/enterprise-workspace/roles",
    ),
    overview = useWorkspaceData<Overview>("/enterprise-workspace"),
    members = useWorkspaceData<Items<EnterpriseMember>>(
      "/enterprise-workspace/members",
    ),
    chains =
      useWorkspaceData<components["schemas"]["ChainRecordDto"][]>(
        "/supply-chains",
      ),
    catalog = useWorkspaceData<Catalog>("/catalog"),
    sites = useWorkspaceData<Items<EnterpriseSite>>(
      "/enterprise-workspace/sites",
    );
  const [roleIds, setRoleIds] = useState<string[]>([]),
    [chainIds, setChainIds] = useState<string[]>([]),
    [siteIds, setSiteIds] = useState<string[]>([]);
  const member = members.data?.items.find((m) => m.id === id);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<{
    path: string;
    payload: Record<string, unknown>;
    rows: [string, string][];
  } | null>(null);
  const [created, setCreated] = useState<[string, string][] | null>(null);
  const [uploadNote, setUploadNote] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  // Server refusals that belong to one field are shown under that field.
  const serverField = /email/i.test(cmd.error)
    ? "email"
    : /điện thoại|phone/i.test(cmd.error)
      ? "phone"
      : "";
  const fieldError = (name: string) =>
    fieldErrors[name] || (serverField === name ? cmd.error : "");
  const invalid = (name: string) => ({
    "aria-invalid": fieldError(name) ? (true as const) : undefined,
    "aria-describedby": fieldError(name) ? `member-${name}-error` : undefined,
    onInput: () => setFieldErrors((current) => ({ ...current, [name]: "" })),
  });
  const errorFor = (name: string) =>
    fieldError(name) ? (
      <span className="field-error" id={`member-${name}-error`} role="alert">
        {fieldError(name)}
      </span>
    ) : null;
  useEffect(() => {
    if (member) {
      const grants = member.enterpriseRoles;
      setRoleIds(grants.map((g) => g.roleId));
      setChainIds([...new Set(grants.flatMap((g) => g.chainIds))]);
      setSiteIds([...new Set(grants.flatMap((g) => g.siteIds))]);
    }
  }, [member]);
  const toggle = (values: string[], value: string, checked: boolean) =>
    checked ? [...values, value] : values.filter((v) => v !== value);
  function validate(data: FormData) {
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const errors: Record<string, string> = {};
    if (!id && value("fullName").length < 2)
      errors.fullName = "Nhập họ tên từ 2 ký tự.";
    if (!id && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value("email")))
      errors.email = "Nhập email đăng nhập hợp lệ.";
    if (value("jobTitle").length < 2)
      errors.jobTitle = "Nhập chức danh từ 2 ký tự.";
    if (
      !/^(?:0[35789]\d{8}|02\d{9}|\+84(?:[35789]\d{8}|2\d{9}))$/.test(
        value("phone").replace(/[ .()-]/g, ""),
      )
    )
      errors.phone = "Nhập số điện thoại Việt Nam hợp lệ (bắt buộc).";
    if (!id && value("contactAddress").length < 5)
      errors.contactAddress = "Nhập địa chỉ liên hệ từ 5 ký tự.";
    if (!id && !roleIds.length) errors.roles = "Chọn ít nhất một nhóm quyền.";
    return errors;
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const errors = validate(data);
    const files = id ? "" : checkEvidenceInputs(e.currentTarget);
    if (files) errors.files = files;
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    const assignments = roleIds.map((roleId) => ({
      roleId,
      chainIds,
      siteIds,
    }));
    const profile = {
      jobTitle: String(data.get("jobTitle") ?? "").trim(),
      phone: String(data.get("phone") ?? "").replace(/[ .()-]/g, ""),
      workSiteId:
        String(data.get("workSiteId") ?? "") || (id ? null : undefined),
      responsibleFarmId:
        String(data.get("responsibleFarmId") ?? "") || (id ? null : undefined),
      contactAddress:
        String(data.get("contactAddress") ?? "").trim() ||
        (id ? null : undefined),
      memberNote:
        String(data.get("memberNote") ?? "").trim() || (id ? null : undefined),
    };
    const payload = id
      ? {
          ...profile,
          version: member?.enterpriseRevision,
          status: data.get("status"),
          roles: assignments,
        }
      : {
          ...profile,
          fullName: data.get("fullName"),
          email: data.get("email"),
          tier: Number(data.get("tier")),
          roles: assignments,
        };
    if (id) {
      if (await cmd.run(`/enterprise-workspace/members/${id}`, payload))
        router.replace(`/enterprise/members/${id}`);
      return;
    }
    // A new member is confirmed in a summary before anything is created.
    const roleNames = (roles.data?.items ?? [])
      .filter((r) => roleIds.includes(String(r.id)))
      .map((r) => textValue(r.name));
    const names = <T extends { id: unknown; name: unknown }>(
      rows: T[] | undefined,
      ids: string[],
    ) =>
      (rows ?? [])
        .filter((r) => ids.includes(String(r.id)))
        .map((r) => textValue(r.name))
        .join(", ");
    setReview({
      path: "/enterprise-workspace/members",
      payload: payload as Record<string, unknown>,
      rows: [
        ["Họ tên", String(data.get("fullName") ?? "").trim()],
        ["Email đăng nhập", String(data.get("email") ?? "").trim()],
        ["Số điện thoại", String(profile.phone ?? "")],
        ["Chức danh", profile.jobTitle],
        ["Địa chỉ liên hệ", String(profile.contactAddress ?? "")],
        [
          "Cấp tài khoản",
          Number(data.get("tier")) === 2
            ? "Cấp 2 — quản lý theo ủy quyền"
            : "Cấp 3 — nhân viên",
        ],
        ["Nhóm quyền", roleNames.join(", ") || "Chưa gán nhóm"],
        [
          "Phạm vi chuỗi",
          names(chains.data ?? undefined, chainIds) || "Chưa chọn",
        ],
        [
          "Cơ sở / nông trại",
          names(
            [...(sites.data?.items ?? []), ...(catalog.data?.farms ?? [])],
            siteIds,
          ) || "Chưa chọn",
        ],
      ],
    });
  }
  async function confirmCreate() {
    if (!review) return;
    const result = await cmd.run<{
      record?: { id?: string; memberCode?: string | null; email?: string };
    }>(review.path, review.payload, "POST", { confirmed: true });
    const rows = review.rows;
    setReview(null);
    if (!result) return;
    const record = result.record ?? {};
    // The account exists now; its photo and documents are attached to it.
    let note = "";
    if (record.id && formRef.current) {
      setUploadNote("Đang tải ảnh đại diện và giấy tờ…");
      const failed = await uploadEvidenceFiles(
        formRef.current,
        "MEMBER",
        record.id,
      );
      note = failed.length
        ? `Chưa tải được: ${failed.join(", ")}. Mở chi tiết thành viên để kiểm tra.`
        : "";
    }
    setUploadNote(note);
    setCreated([["Mã nhân viên", record.memberCode ?? "—"], ...rows]);
  }
  return (
    <div className="manage-console member-console">
      <PageHeader
        actionKind="create"
        backLabel="Quay lại danh sách"
        title={
          id ? `Quyền của ${textValue(member?.fullName)}` : "Thêm thành viên"
        }
        back={id ? `/enterprise/members/${id}` : "/enterprise/members"}
      />
      <LoadState loading={roles.loading} error={roles.error} />
      <InfoDialog
        open={!!review}
        title="Xác nhận tạo thành viên"
        description="Kiểm tra lại thông tin. Sau khi xác nhận, tài khoản được tạo và mật khẩu tạm được gửi tới email đăng nhập; thành viên phải đổi mật khẩu ở lần đăng nhập đầu tiên."
        rows={review?.rows ?? []}
        onClose={() => setReview(null)}
        actions={
          <>
            <Button
              type="button"
              className="button secondary"
              disabled={cmd.pending}
              onClick={() => setReview(null)}
            >
              Quay lại sửa
            </Button>
            <Button
              type="button"
              className="button"
              disabled={cmd.pending}
              onClick={() => void confirmCreate()}
            >
              {cmd.pending ? "Đang tạo…" : "Xác nhận tạo"}
            </Button>
          </>
        }
      />
      <InfoDialog
        open={!!created}
        title="Đã tạo tài khoản thành viên"
        description="Mật khẩu tạm đã được gửi tới email đăng nhập của thành viên. Thành viên phải đổi mật khẩu ở lần đăng nhập đầu tiên."
        rows={
          uploadNote
            ? [...(created ?? []), ["Hình ảnh", uploadNote]]
            : (created ?? [])
        }
        onClose={() => router.push("/enterprise/members")}
        actions={
          <Button
            type="button"
            className="button"
            onClick={() => router.push("/enterprise/members")}
          >
            Về danh sách thành viên
          </Button>
        }
      />
      {!created && (
        <>
          <form
            ref={formRef}
            className="panel workspace-form member-form"
            onSubmit={submit}
            noValidate
          >
            <CommandState command={serverField ? { ...cmd, error: "" } : cmd} />
            {id && member?.enterpriseTier === 2 && (
              <p className="notice">
                Cập nhật quyền hoặc trạng thái của quản lý cấp 2 sẽ khóa các tài
                khoản cấp 3 do người này cấp. Bạn cần rà soát và phân quyền lại
                từng tài khoản con.
              </p>
            )}
            <fieldset
              className="enterprise-fields member-form-fields"
              disabled={cmd.pending || cmd.frozen}
            >
              <section className="member-form-section member-profile-section">
                <h2>Thông tin cơ bản</h2>
                <div className="member-basic-grid">
                  {!id && (
                    <>
                      <label>
                        <span className="member-field-label">
                          Họ tên{" "}
                          <span
                            className="member-required-indicator"
                            aria-hidden="true"
                          >
                            *
                          </span>
                        </span>
                        <Input
                          className="input"
                          name="fullName"
                          required
                          minLength={2}
                          {...invalid("fullName")}
                        />
                        {errorFor("fullName")}
                      </label>
                      <label>
                        <span className="member-field-label">
                          Email đăng nhập{" "}
                          <span
                            className="member-required-indicator"
                            aria-hidden="true"
                          >
                            *
                          </span>
                        </span>
                        <Input
                          className="input"
                          name="email"
                          type="email"
                          required
                          {...invalid("email")}
                        />
                        {errorFor("email")}
                      </label>
                      <label>
                        <span className="member-field-label">
                          Cấp tài khoản
                        </span>
                        <NativeSelect className="input" name="tier" defaultValue="3">
                          {overview.data?.member.primary && (
                            <option value="2">
                              Cấp 2 — quản lý theo ủy quyền
                            </option>
                          )}
                          <option value="3">Cấp 3 — nhân viên</option>
                        </NativeSelect>
                      </label>
                    </>
                  )}
                  {id && member && (
                    <>
                      <label>
                        <span className="member-field-label">Họ tên</span>
                        <Input
                          className="input"
                          value={member.fullName}
                          readOnly
                          disabled
                        />
                      </label>
                      <label>
                        <span className="member-field-label">
                          Email đăng nhập (không sửa được)
                        </span>
                        <Input
                          className="input"
                          value={member.email}
                          readOnly
                          disabled
                        />
                      </label>
                    </>
                  )}
                  {id && (
                    <label>
                      <span className="member-field-label">Trạng thái</span>
                      <NativeSelect
                        className="input"
                        name="status"
                        defaultValue={String(member?.accountStatus ?? "ACTIVE")}
                        key={String(member?.accountStatus)}
                      >
                        <option value="ACTIVE">Hoạt động</option>
                        <option value="LOCKED">
                          Khóa tài khoản và thu hồi phiên
                        </option>
                      </NativeSelect>
                    </label>
                  )}
                  <label>
                    <span className="member-field-label">
                      Chức danh{" "}
                      <span
                        className="member-required-indicator"
                        aria-hidden="true"
                      >
                        *
                      </span>
                    </span>
                    <Input
                      className="input"
                      name="jobTitle"
                      required
                      minLength={2}
                      maxLength={255}
                      defaultValue={member?.jobTitle ?? ""}
                      key={`title-${member?.id ?? "new"}`}
                      {...invalid("jobTitle")}
                    />
                    {errorFor("jobTitle")}
                  </label>
                  <label>
                    <span className="member-field-label">
                      Số điện thoại liên hệ{" "}
                      <span
                        className="member-required-indicator"
                        aria-hidden="true"
                      >
                        *
                      </span>
                    </span>
                    <Input
                      className="input"
                      name="phone"
                      type="tel"
                      required
                      maxLength={30}
                      defaultValue={member?.phone ?? ""}
                      key={`phone-${member?.id ?? "new"}`}
                      {...invalid("phone")}
                    />
                    {errorFor("phone")}
                  </label>
                  <label>
                    <span className="member-field-label">Cơ sở làm việc</span>
                    <NativeSelect
                      className="input"
                      name="workSiteId"
                      defaultValue={member?.workSiteId ?? ""}
                      key={`site-${member?.id ?? "new"}`}
                    >
                      <option value="">Chưa chọn</option>
                      {sites.data?.items
                        .filter((site) => site.status === "ACTIVE")
                        .map((site) => (
                          <option key={site.id} value={site.id}>
                            {site.name}
                          </option>
                        ))}
                    </NativeSelect>
                  </label>
                  <label>
                    <span className="member-field-label">
                      Vùng sản xuất phụ trách
                    </span>
                    <NativeSelect
                      className="input"
                      name="responsibleFarmId"
                      defaultValue={member?.responsibleFarmId ?? ""}
                      key={`farm-${member?.id ?? "new"}`}
                    >
                      <option value="">Chưa chọn</option>
                      {catalog.data?.farms
                        .filter((farm) => farm.status === "ACTIVE")
                        .map((farm) => (
                          <option key={farm.id} value={farm.id}>
                            {farm.name}
                          </option>
                        ))}
                    </NativeSelect>
                  </label>
                  <label>
                    <span className="member-field-label">
                      Địa chỉ liên hệ{" "}
                      {!id && (
                        <span
                          className="member-required-indicator"
                          aria-hidden="true"
                        >
                          *
                        </span>
                      )}
                    </span>
                    <Input
                      className="input"
                      name="contactAddress"
                      required={!id}
                      maxLength={500}
                      defaultValue={member?.contactAddress ?? ""}
                      key={`address-${member?.id ?? "new"}`}
                      {...invalid("contactAddress")}
                    />
                    {errorFor("contactAddress")}
                  </label>
                  <label className="member-note-field">
                    <span className="member-field-label">
                      Ghi chú thành viên
                    </span>
                    <Textarea
                      className="input"
                      name="memberNote"
                      maxLength={1000}
                      defaultValue={member?.memberNote ?? ""}
                      key={`note-${member?.id ?? "new"}`}
                    />
                  </label>
                </div>
              </section>
              <div className="member-assignment-grid">
                <fieldset
                  className="member-assignment-panel member-role-panel"
                  aria-invalid={fieldError("roles") ? true : undefined}
                >
                  <legend>
                    Nhóm quyền {!id && <span aria-hidden="true">*</span>}
                  </legend>
                  {errorFor("roles")}
                  <div className="member-choice-grid">
                    {roles.data?.items.map((r) => (
                      <label className="permission-choice" key={String(r.id)}>
                        <Input
                          type="checkbox"
                          checked={roleIds.includes(String(r.id))}
                          onChange={(e) => {
                            setRoleIds((v) =>
                              toggle(v, String(r.id), e.target.checked),
                            );
                            setFieldErrors((current) => ({
                              ...current,
                              roles: "",
                            }));
                          }}
                        />
                        <span>{textValue(r.name)}</span>
                      </label>
                    ))}
                  </div>
                  {!roles.data?.items.length && (
                    <p className="notice">
                      Cần tạo nhóm quyền trước khi cấp tài khoản.
                    </p>
                  )}
                </fieldset>
                <fieldset className="member-assignment-panel member-site-panel">
                  <legend>Phạm vi chuỗi</legend>
                  <div className="member-choice-grid">
                    {chains.data?.map((c) => (
                      <label className="permission-choice" key={String(c.id)}>
                        <Input
                          type="checkbox"
                          checked={chainIds.includes(String(c.id))}
                          onChange={(e) =>
                            setChainIds((v) =>
                              toggle(v, String(c.id), e.target.checked),
                            )
                          }
                        />
                        <span>{textValue(c.name)}</span>
                      </label>
                    ))}
                  </div>
                  <small>
                    Không chọn chuỗi: chưa được thao tác dữ liệu truy xuất của
                    chuỗi.
                  </small>
                </fieldset>
                <fieldset className="member-assignment-panel">
                  <legend>Cơ sở / nông trại được phân công</legend>
                  <div className="member-choice-grid">
                    {[
                      ...(sites.data?.items ?? []),
                      ...(catalog.data?.farms ?? []),
                    ].map((s) => (
                      <label className="permission-choice" key={String(s.id)}>
                        <Input
                          type="checkbox"
                          checked={siteIds.includes(String(s.id))}
                          onChange={(e) =>
                            setSiteIds((v) =>
                              toggle(v, String(s.id), e.target.checked),
                            )
                          }
                        />
                        <span>{textValue(s.name)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </fieldset>
            {!id && (
              <>
                <div className="member-evidence-section">
                  <EvidenceInputs
                    entityType="MEMBER"
                    title="Ảnh đại diện và giấy tờ"
                    disabled={cmd.pending || cmd.frozen}
                  />
                  {errorFor("files")}
                  <div className="member-form-actions">
                    <Button
                      className="button"
                      type="submit"
                      disabled={cmd.pending}
                    >
                      {cmd.pending ? "Đang lưu…" : "Tạo tài khoản"}
                    </Button>
                  </div>
                </div>
              </>
            )}
            {id && (
              <div className="member-form-actions">
                <Button className="button" type="submit" disabled={cmd.pending}>
                  {cmd.pending
                    ? "Đang lưu…"
                    : "Cập nhật quyền và thu hồi phiên cũ"}
                </Button>
              </div>
            )}
          </form>
        </>
      )}
    </div>
  );
}

/** Who directly manages a member. Only the owner may move a tier-3 member under
 * another active tier-2 manager (or back under the owner); the API requires the
 * new manager to hold every permission and scope the member's roles grant. */
export function SupervisorPanel({
  member,
  members,
  canChange,
  onChanged,
}: {
  member: EnterpriseMember;
  members: EnterpriseMember[];
  canChange: boolean;
  onChanged(): void;
}) {
  const cmd = useWorkspaceCommand();
  const [target, setTarget] = useState(
    member.supervisorId &&
      members.some(
        (m) => m.id === member.supervisorId && m.enterpriseTier === 2,
      )
      ? member.supervisorId
      : "",
  );
  const current = members.find(
    (m) => m.id === member.supervisorId && m.enterpriseTier === 2,
  );
  const managers = members.filter(
    (m) =>
      m.enterpriseTier === 2 &&
      m.accountStatus === "ACTIVE" &&
      m.id !== member.id,
  );
  return (
    <section className="panel">
      <h2>Người quản lý trực tiếp</h2>
      <p className="muted">
        Hiện tại:{" "}
        <strong>{current?.fullName ?? "Chủ quản doanh nghiệp"}</strong>. Người
        quản lý giới hạn những gì thành viên được làm và là người quản lý tài
        khoản này.
      </p>
      {canChange && member.enterpriseTier === 3 ? (
        <form
          className="workspace-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await cmd.run(
                `/enterprise-workspace/members/${member.id}/supervisor`,
                {
                  version: member.enterpriseRevision,
                  supervisorId: target || null,
                },
              )
            )
              onChanged();
          }}
        >
          <CommandState command={cmd} />
          <fieldset
            className="enterprise-fields"
            disabled={cmd.pending || cmd.frozen}
          >
            <label>
              Người quản lý mới
              <NativeSelect
                className="input"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Chủ quản doanh nghiệp</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                    {m.jobTitle ? ` · ${m.jobTitle}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </fieldset>
          <p className="notice">
            Người quản lý mới phải có đủ quyền và phạm vi của thành viên. Sau
            khi đổi, thành viên phải đăng nhập lại.
          </p>
          <Button
            className="button secondary"
            disabled={cmd.pending || (target || "") === (current?.id ?? "")}
          >
            {"Đổi người quản lý"}
          </Button>
        </form>
      ) : (
        canChange && (
          <p className="muted">
            Quản lý cấp 2 luôn trực thuộc chủ quản doanh nghiệp.
          </p>
        )
      )}
    </section>
  );
}

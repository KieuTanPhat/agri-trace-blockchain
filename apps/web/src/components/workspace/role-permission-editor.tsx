"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useState } from "react";
import type { EnterpriseRoleTemplate } from "@/lib/workspace";

export type RolePermissionGroup = {
  title: string;
  permissions: { code: string; label: string }[];
};

type Props = {
  groups: RolePermissionGroup[];
  templates: EnterpriseRoleTemplate[];
  selected: string[];
  name: string;
  editing: boolean;
  templatesLoading: boolean;
  templatesError: string;
  onNameChange: (name: string) => void;
  onSelectedChange: (permissions: string[]) => void;
};

function PermissionCheckbox({
  label,
  checked,
  indeterminate = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className={`role-matrix-check${onChange ? "" : " is-preview"}`}>
      <Input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={!onChange}
        ref={(input) => {
          if (input) input.indeterminate = indeterminate;
        }}
        onChange={
          onChange ? (event) => onChange(event.target.checked) : undefined
        }
      />
    </label>
  );
}

/** Only the active column edits the current role; other columns preview API templates. */
export function RolePermissionEditor({
  groups,
  templates,
  selected,
  name,
  editing,
  templatesLoading,
  templatesError,
  onNameChange,
  onSelectedChange,
}: Props) {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const activeTemplate = templates.find(
    (item) => item.code === selectedTemplate,
  );
  const activeCode = activeTemplate?.code ?? null;
  const columns = [
    ...(!activeTemplate
      ? [{ code: null, name: "Tự chọn quyền", permissions: selected }]
      : []),
    ...templates,
  ];
  // Balance complete groups across the available space; every permission stays open.
  const panels: RolePermissionGroup[][] = [[], [], []];
  const panelRows = [0, 0, 0];
  for (const group of groups) {
    const index = panelRows.indexOf(Math.min(...panelRows));
    panels[index].push(group);
    panelRows[index] += group.permissions.length + 1;
  }

  function chooseTemplate(template: EnterpriseRoleTemplate | null) {
    if ((template?.code ?? null) === activeCode) return;
    setSelectedTemplate(template?.code ?? null);
    if (!template) return;
    onSelectedChange([...template.permissions]);
    if (
      !editing &&
      (!name.trim() || templates.some((item) => item.name === name))
    )
      onNameChange(template.name);
  }

  function togglePermissions(codes: string[], checked: boolean) {
    onSelectedChange(
      checked
        ? [...new Set([...selected, ...codes])]
        : selected.filter((code) => !codes.includes(code)),
    );
  }

  return (
    <>
      <section
        className="role-template-section"
        aria-labelledby="role-templates-title"
      >
        <h2 id="role-templates-title">Mẫu theo công việc</h2>
        <div className="role-name-section">
          <label htmlFor="role-name">
            Tên nhóm quyền{" "}
            <span className="role-required" aria-hidden="true">
              *
            </span>
          </label>
          <Input
            id="role-name"
            className="input"
            name="name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            required
            minLength={2}
            maxLength={100}
          />
        </div>
        <div className="role-template-grid">
          <Button
            type="button"
            className={`role-template-option${activeCode === null ? " is-selected" : ""}`}
            aria-pressed={activeCode === null}
            onClick={() => chooseTemplate(null)}
          >
            Tự chọn quyền
          </Button>
          {templates.map((template) => (
            <Button
              type="button"
              key={template.code}
              className={`role-template-option${activeCode === template.code ? " is-selected" : ""}`}
              aria-pressed={activeCode === template.code}
              onClick={() => chooseTemplate(template)}
            >
              {template.name}
            </Button>
          ))}
        </div>
        {templatesLoading && (
          <p className="muted" role="status">
            Đang tải mẫu quyền…
          </p>
        )}
        {templatesError && (
          <p className="notice error" role="alert">
            Không tải được mẫu quyền: {templatesError}
          </p>
        )}
      </section>

      {groups.length ? (
        <section
          className="role-expanded-grid"
          aria-label="Quyền theo nhóm chức năng"
        >
          {panels
            .filter((panel) => panel.length)
            .map((panel, index) => (
              <div
                key={panel[0].title}
                className="role-permission-table-wrap"
                role="region"
                aria-label={`Bảng phân quyền ${index + 1}`}
              >
                <Table
                  className={`role-permission-table${columns.length > 6 ? " is-many-columns" : ""}`}
                >
                  <caption className="sr-only">
                    Chỉnh quyền trong cột đang chọn hoặc ô chọn bên trái. Các
                    cột khác chỉ hiển thị mẫu.
                  </caption>
                  <colgroup>
                    <col className="role-permission-name-column" />
                    <col className="role-permission-group-column" />
                    {columns.map((column) => (
                      <col
                        key={column.code ?? "custom"}
                        className={
                          column.code === activeCode
                            ? "role-permission-active-column"
                            : "role-comparison-column"
                        }
                      />
                    ))}
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Chức năng / Quyền</TableHead>
                      <TableHead
                        scope="col"
                        className="role-permission-group-column-heading"
                      >
                        Chọn cả nhóm
                      </TableHead>
                      {columns.map((column) => (
                        <TableHead
                          scope="col"
                          key={column.code ?? "custom"}
                          className={
                            column.code === activeCode
                              ? "is-active-role-column"
                              : "role-comparison-column"
                          }
                        >
                          <Button
                            type="button"
                            className="role-column-button"
                            aria-label={`Chọn mẫu ${column.name}`}
                            aria-pressed={column.code === activeCode}
                            onClick={() =>
                              chooseTemplate(
                                templates.find(
                                  (item) => item.code === column.code,
                                ) ?? null,
                              )
                            }
                          >
                            <span className="role-column-template-name">
                              {column.name}
                            </span>
                            <span
                              className="role-column-compact-name"
                              aria-hidden="true"
                            >
                              Chọn quyền
                            </span>
                          </Button>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  {panel.map((group) => {
                    const codes = group.permissions.map(
                      (permission) => permission.code,
                    );
                    const all = codes.every((code) => selected.includes(code));
                    const some = codes.some((code) => selected.includes(code));
                    return (
                      <TableBody key={group.title}>
                        <TableRow className="role-permission-group-row">
                          <TableHead scope="rowgroup">
                            <span className="role-group-heading">
                              {group.title}
                            </span>
                          </TableHead>
                          <TableCell className="role-permission-group-column">
                            <PermissionCheckbox
                              label={`Chọn cả nhóm ${group.title}`}
                              checked={all}
                              indeterminate={some && !all}
                              onChange={(checked) =>
                                togglePermissions(codes, checked)
                              }
                            />
                          </TableCell>
                          {columns.map((column) => {
                            const active = column.code === activeCode;
                            const permissions = active
                              ? selected
                              : column.permissions;
                            const columnAll = codes.every((code) =>
                              permissions.includes(code),
                            );
                            const columnSome = codes.some((code) =>
                              permissions.includes(code),
                            );
                            return (
                              <TableCell
                                key={column.code ?? "custom"}
                                className={
                                  active
                                    ? "is-active-role-column"
                                    : "role-comparison-column"
                                }
                              >
                                <PermissionCheckbox
                                  label={`${column.name}: toàn bộ ${group.title}`}
                                  checked={columnAll}
                                  indeterminate={columnSome && !columnAll}
                                  onChange={
                                    active
                                      ? (checked) =>
                                          togglePermissions(codes, checked)
                                      : undefined
                                  }
                                />
                              </TableCell>
                            );
                          })}
                        </TableRow>
                        {group.permissions.map((permission) => (
                          <TableRow
                            className="role-permission-row"
                            key={permission.code}
                          >
                            <TableHead scope="row">{permission.label}</TableHead>
                            <TableCell className="role-permission-group-column">
                              <PermissionCheckbox
                                label={`Chọn quyền ${permission.label}`}
                                checked={selected.includes(permission.code)}
                                onChange={(checked) =>
                                  togglePermissions([permission.code], checked)
                                }
                              />
                            </TableCell>
                            {columns.map((column) => {
                              const active = column.code === activeCode;
                              return (
                                <TableCell
                                  key={column.code ?? "custom"}
                                  className={
                                    active
                                      ? "is-active-role-column"
                                      : "role-comparison-column"
                                  }
                                >
                                  <PermissionCheckbox
                                    label={`${column.name}: ${permission.label}`}
                                    checked={(active
                                      ? selected
                                      : column.permissions
                                    ).includes(permission.code)}
                                    onChange={
                                      active
                                        ? (checked) =>
                                            togglePermissions(
                                              [permission.code],
                                              checked,
                                            )
                                        : undefined
                                    }
                                  />
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    );
                  })}
                </Table>
              </div>
            ))}
        </section>
      ) : (
        <p className="notice">Chưa tải được danh sách quyền của tổ chức.</p>
      )}
    </>
  );
}

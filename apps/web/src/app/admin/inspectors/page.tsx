"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AdminOrganizations from "@/components/workspace/admin-organizations";
import AdminUsers from "@/components/workspace/admin-users";
import ComplianceAssignments from "../compliance-assignments/page";

const tabs = [
  { id: "organizations", label: "Tổ chức kiểm định" },
  { id: "users", label: "Tài khoản kiểm định viên" },
  { id: "assignments", label: "Phân công và lịch sử" },
];
function Inspectors() {
  const query = useSearchParams().get("tab");
  const tab = tabs.some((item) => item.id === query) ? query : "organizations";
  return (
    <>
      <nav className="manage-filter-tabs" aria-label="Các mục kiểm định viên">
        {tabs.map((item) => (
          <Link
            className="manage-filter-link"
            key={item.id}
            href={`/admin/inspectors?tab=${item.id}`}
            aria-current={tab === item.id ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {tab === "organizations" ? (
        <AdminOrganizations auditorsOnly />
      ) : tab === "users" ? (
        <AdminUsers reviewersOnly />
      ) : (
        <ComplianceAssignments />
      )}
    </>
  );
}
export default function Page() {
  return (
    <Suspense fallback={<p role="status">Đang tải kiểm định viên…</p>}>
      <Inspectors />
    </Suspense>
  );
}

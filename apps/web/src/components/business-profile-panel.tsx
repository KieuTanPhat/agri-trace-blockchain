"use client";

import { useEffect, useState } from "react";
import { request } from "@/lib/api-client";
import type { components } from "@/lib/generated/api";
import { DataForm } from "./data-form";

type Profile = components["schemas"]["BusinessProfileDto"];
const labels: Record<Profile["state"], string> = {
  PREPARING: "Đang chuẩn bị",
  ACTIVE: "Đang hoạt động",
  SUSPENDED: "Tạm ngừng",
};

export function BusinessProfilePanel({
  chainId,
  canActivate,
  onChanged,
}: {
  chainId: string;
  canActivate: boolean;
  onChanged(): void;
}) {
  const [loaded, setLoaded] = useState<{
    chainId: string;
    profile: Profile;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoaded(null);
    setError("");
    request<Profile>(`/supply-chains/${chainId}/business-profile`)
      .then((profile) => {
        if (active) setLoaded({ chainId, profile });
      })
      .catch(() => {
        if (active) setError("Chưa tải được trạng thái nghiệp vụ của chuỗi.");
      });
    return () => {
      active = false;
    };
  }, [chainId]);
  const profile = loaded?.chainId === chainId ? loaded.profile : null;
  return (
    <section className="panel" aria-label="Trạng thái nghiệp vụ chuỗi">
      <h2>Trạng thái nghiệp vụ</h2>
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : !profile ? (
        <p role="status">Đang kiểm tra trạng thái…</p>
      ) : (
        <>
          <p>{labels[profile.state]}</p>
          {profile.state === "PREPARING" && (
            <p>
              Hoàn tất đối soát dữ liệu và xác nhận của các bên tham gia trước
              khi kích hoạt nghiệp vụ.
            </p>
          )}
          {profile.state === "PREPARING" && canActivate && (
            <DataForm
              key={`${chainId}:${profile.version}`}
              title="Kích hoạt nghiệp vụ chuỗi"
              path={`/supply-chains/${chainId}/business-profile/activate`}
              fields={[]}
              extra={{ version: profile.version }}
              onSaved={onChanged}
            />
          )}
        </>
      )}
    </section>
  );
}

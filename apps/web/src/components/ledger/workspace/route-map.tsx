"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { MapPlace, RoutePoint } from "@/lib/ledger/iot-api";
import { t as tr } from "@/lib/ledger/i18n";

type LatLng = [number, number];
const has = (p: MapPlace): p is { name: string; latitude: number; longitude: number } =>
  !!p && p.latitude !== null && p.longitude !== null;

/**
 * OpenStreetMap route view (ADR-006). VALID points form the line; anomalies and
 * late points are shown as markers so a reader sees what the seal excludes.
 */
export function RouteMap({ points, origin, destination, live }: { points: RoutePoint[]; origin: MapPlace; destination: MapPlace; live: boolean }) {
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const layer = useRef<import("leaflet").LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    let disposed = false;
    void import("leaflet").then((L) => {
      if (disposed || !host.current || map.current) return;
      map.current = L.map(host.current, { zoomControl: true, attributionControl: true }).setView([10.8, 106.7], 9);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      draw(L);
    });
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void import("leaflet").then((L) => draw(L));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, origin, destination, live]);

  function draw(L: typeof import("leaflet")) {
    if (!map.current || !layer.current) return;
    const g = layer.current;
    g.clearLayers();
    const valid = points.filter((p) => p.validity === "VALID");
    const line: LatLng[] = valid.map((p) => [p.latitude, p.longitude]);
    const bounds: LatLng[] = [...line];
    if (line.length > 1) L.polyline(line, { color: "#1f7a4d", weight: 4, opacity: 0.85 }).addTo(g);
    for (const p of points.filter((x) => x.validity !== "VALID"))
      L.circleMarker([p.latitude, p.longitude], { radius: 5, color: p.validity === "ANOMALY" ? "#b42318" : "#8a6d1d", weight: 2, fillOpacity: 0.6 })
        .bindTooltip(p.validity === "ANOMALY" ? tr("Điểm bất thường ({p0})", { p0: p.anomalyCode ?? "" }) : tr("Điểm đến muộn sau niêm phong"))
        .addTo(g);
    for (const [place, label, color] of [[origin, tr("Điểm lấy hàng"), "#344054"], [destination, tr("Điểm nhận hàng"), "#1d4ed8"]] as const)
      if (has(place)) {
        L.circleMarker([place.latitude, place.longitude], { radius: 8, color, weight: 3, fillColor: "#fff", fillOpacity: 1 }).bindTooltip(`${label}: ${place.name}`).addTo(g);
        bounds.push([place.latitude, place.longitude]);
      }
    const last = valid.at(-1);
    if (last)
      L.circleMarker([last.latitude, last.longitude], { radius: 9, color: live ? "#1f7a4d" : "#344054", weight: 3, fillColor: live ? "#34d399" : "#d0d5dd", fillOpacity: 1 })
        .bindTooltip(live ? tr("Vị trí mới nhất") : tr("Điểm cuối hành trình"))
        .addTo(g);
    if (bounds.length && !fitted.current) {
      map.current.fitBounds(L.latLngBounds(bounds).pad(0.15), { maxZoom: 15 });
      fitted.current = true;
    }
  }

  return <div ref={host} className="h-[340px] w-full overflow-hidden rounded-md border border-line sm:h-[420px]" role="img" aria-label={tr("Bản đồ hành trình")} />;
}

import data from "./vietnam.json";
export const locationVersion = data.version;
export const provinces = data.provinces;
export function findLocation(provinceCode: string, wardCode: string) {
  const province = provinces.find((p) => p.code === provinceCode);
  const ward = province?.wards.find((w) => w.code === wardCode);
  return province && ward ? { province, ward } : null;
}
export function filterLocations<T extends { name: string; label: string }>(
  items: T[],
  query: string,
): T[] {
  const normalized = query
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
  return items.filter((item) =>
    item.label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .includes(normalized),
  );
}

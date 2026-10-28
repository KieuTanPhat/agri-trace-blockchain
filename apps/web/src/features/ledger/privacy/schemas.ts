export { note, localToIso } from "../screens/admin/cases/schemas";
export function isoToLocal(value: string) {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export function weatherLabel(code: number | null): string {
  if (code === null) return "Chưa có dữ liệu";
  if (code === 0) return "Trời quang";
  if (code === 1) return "Ít mây";
  if (code === 2) return "Mây rải rác";
  if (code === 3) return "Nhiều mây";
  if ([45, 48].includes(code)) return "Sương mù";
  if ([51, 53, 55].includes(code)) return "Mưa phùn";
  if ([56, 57].includes(code)) return "Mưa phùn đóng băng";
  if ([61, 63, 65].includes(code)) return "Mưa";
  if ([66, 67].includes(code)) return "Mưa đóng băng";
  if ([71, 73, 75, 77].includes(code)) return "Tuyết";
  if ([80, 81, 82].includes(code)) return "Mưa rào";
  if ([85, 86].includes(code)) return "Mưa rào tuyết";
  if (code === 95) return "Dông";
  if ([96, 99].includes(code)) return "Dông kèm mưa đá";
  return "Chưa rõ trạng thái";
}
export const weatherMetric = (value: number | null, unit: string) =>
  value === null ? "Chưa có dữ liệu" : `${value} ${unit}`;
export function weatherTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

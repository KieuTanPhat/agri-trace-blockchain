const traceDate = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  timeZone: "Asia/Ho_Chi_Minh"
});

export function formatTraceDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : traceDate.format(date);
}

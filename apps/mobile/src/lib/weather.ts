/** WMO weather codes (Open-Meteo) in everyday Vietnamese. */
export function weatherText(code: number | null | undefined) {
  if (code === null || code === undefined) return 'Chưa có dữ liệu';
  if (code === 0) return 'Trời quang';
  if (code <= 2) return 'Ít mây';
  if (code === 3) return 'Nhiều mây';
  if (code <= 48) return 'Sương mù';
  if (code <= 57) return 'Mưa phùn';
  if (code <= 67) return 'Mưa';
  if (code <= 77) return 'Mưa đá nhẹ';
  if (code <= 82) return 'Mưa rào';
  return 'Dông';
}

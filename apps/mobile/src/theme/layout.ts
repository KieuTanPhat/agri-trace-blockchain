/** Pure rules shared by narrow/large-text UI and regression tests. */
export function mobileLayout(width: number, fontScale = 1) {
  return {
    horizontalPadding: width < 360 ? 16 : 24,
    quickActionWidth:
      width < 360 || fontScale > 1.35 ? ("100%" as const) : ("48%" as const),
    contentMaxWidth: 680,
    stepsHorizontal: width >= 360 && fontScale <= 1.2,
  };
}
export const consumerTabs = [
  { name: "index", title: "Trang chủ" },
  { name: "enterprises", title: "Doanh nghiệp" },
  { name: "scan", title: "Quét QR" },
  { name: "products", title: "Sản phẩm" },
  { name: "account", title: "Tài khoản" },
] as const;

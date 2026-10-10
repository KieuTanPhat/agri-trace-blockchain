/** Sum the API's decimal strings without introducing floating point drift. */
export function sumQuantities(values: string[]): string {
  let total = 0n;
  for (const value of values) {
    const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(value);
    if (!match) return "Chưa đối soát";
    total += BigInt(match[1]) * 1000n + BigInt((match[2] ?? "").padEnd(3, "0"));
  }
  const fraction = String(total % 1000n)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return `${total / 1000n}${fraction ? "." + fraction : ""}`;
}

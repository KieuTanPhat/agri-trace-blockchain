import { createQrMatrix, createQrSvgPath } from "@/lib/qr-code";

export function QrCodeCard({ value }: { value: string }) {
  const matrix = createQrMatrix(value);
  const path = createQrSvgPath(matrix);
  const size = matrix.length;

  return (
    <div className="real-qr" aria-label={`Mã QR cho ${value}`}>
      <svg viewBox={`0 0 ${size + 8} ${size + 8}`} role="img">
        <rect width={size + 8} height={size + 8} fill="#ffffff" />
        <path d={path} fill="#17211d" transform="translate(4 4)" />
      </svg>
    </div>
  );
}

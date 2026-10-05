import QRCode from "qrcode";

export function createQrMatrix(text: string): boolean[][] {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  return Array.from({ length: modules.size }, (_, y) =>
    Array.from({ length: modules.size }, (_, x) => Boolean(modules.get(y, x))),
  );
}

export function createQrSvgPath(matrix: boolean[][]) {
  const commands: string[] = [];
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) commands.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return commands.join("");
}

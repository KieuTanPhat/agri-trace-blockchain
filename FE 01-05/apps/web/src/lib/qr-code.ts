const VERSION = 5;
const SIZE = VERSION * 4 + 17;
const DATA_CODEWORDS = 108;
const ECC_CODEWORDS = 26;

type Cell = boolean | null;

const EXP = new Array<number>(512);
const LOG = new Array<number>(256);

let value = 1;
for (let index = 0; index < 255; index += 1) {
  EXP[index] = value;
  LOG[value] = index;
  value <<= 1;
  if (value & 0x100) value ^= 0x11d;
}
for (let index = 255; index < 512; index += 1) {
  EXP[index] = EXP[index - 255];
}

export function createQrMatrix(text: string): boolean[][] {
  const matrix = createMatrix();
  const reserved = createReservedMatrix();

  addFunctionPatterns(matrix, reserved);
  const data = createDataCodewords(text);
  const ecc = createErrorCorrection(data, ECC_CODEWORDS);
  placeData(matrix, reserved, [...data, ...ecc]);
  addFormatInfo(matrix, reserved);

  return matrix.map((row) => row.map(Boolean));
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

function createMatrix(): Cell[][] {
  return Array.from({ length: SIZE }, () => Array<Cell>(SIZE).fill(null));
}

function createReservedMatrix(): boolean[][] {
  return Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));
}

function setModule(matrix: Cell[][], reserved: boolean[][], x: number, y: number, dark: boolean, isReserved = true) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  matrix[y][x] = dark;
  if (isReserved) reserved[y][x] = true;
}

function addFunctionPatterns(matrix: Cell[][], reserved: boolean[][]) {
  addFinder(matrix, reserved, 0, 0);
  addFinder(matrix, reserved, SIZE - 7, 0);
  addFinder(matrix, reserved, 0, SIZE - 7);
  addAlignment(matrix, reserved, 30, 30);

  for (let index = 8; index < SIZE - 8; index += 1) {
    const dark = index % 2 === 0;
    setModule(matrix, reserved, index, 6, dark);
    setModule(matrix, reserved, 6, index, dark);
  }

  setModule(matrix, reserved, 8, VERSION * 4 + 9, true);
  reserveFormatAreas(reserved);
}

function addFinder(matrix: Cell[][], reserved: boolean[][], startX: number, startY: number) {
  for (let y = -1; y <= 7; y += 1) {
    for (let x = -1; x <= 7; x += 1) {
      const xx = startX + x;
      const yy = startY + y;
      if (xx < 0 || yy < 0 || xx >= SIZE || yy >= SIZE) continue;
      const inPattern = x >= 0 && x <= 6 && y >= 0 && y <= 6;
      const dark = inPattern && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
      setModule(matrix, reserved, xx, yy, dark);
    }
  }
}

function addAlignment(matrix: Cell[][], reserved: boolean[][], centerX: number, centerY: number) {
  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      const dark = Math.max(Math.abs(x), Math.abs(y)) !== 1;
      setModule(matrix, reserved, centerX + x, centerY + y, dark);
    }
  }
}

function reserveFormatAreas(reserved: boolean[][]) {
  for (let index = 0; index <= 8; index += 1) {
    if (index !== 6) {
      reserved[8][index] = true;
      reserved[index][8] = true;
    }
  }
  for (let index = 0; index < 8; index += 1) {
    reserved[8][SIZE - 1 - index] = true;
    reserved[SIZE - 1 - index][8] = true;
  }
}

function createDataCodewords(text: string) {
  const bytes = Array.from(new TextEncoder().encode(text));
  if (bytes.length > 100) {
    throw new Error("Mã QR mẫu chỉ hỗ trợ đường dẫn ngắn hơn 100 byte.");
  }

  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => appendBits(bits, byte, 8));
  appendBits(bits, 0, Math.min(4, DATA_CODEWORDS * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    codewords.push(bits.slice(index, index + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  for (let pad = 0xec; codewords.length < DATA_CODEWORDS; pad = pad === 0xec ? 0x11 : 0xec) {
    codewords.push(pad);
  }
  return codewords;
}

function appendBits(bits: number[], number: number, length: number) {
  for (let index = length - 1; index >= 0; index -= 1) {
    bits.push((number >>> index) & 1);
  }
}

function createErrorCorrection(data: number[], degree: number) {
  const generator = createGenerator(degree);
  const remainder = Array<number>(degree).fill(0);

  data.forEach((byte) => {
    const factor = byte ^ remainder.shift()!;
    remainder.push(0);
    generator.slice(1).forEach((coefficient, index) => {
      remainder[index] ^= gfMultiply(coefficient, factor);
    });
  });

  return remainder;
}

function createGenerator(degree: number) {
  let poly = [1];
  for (let index = 0; index < degree; index += 1) {
    poly = multiplyPolynomials(poly, [1, EXP[index]]);
  }
  return poly;
}

function multiplyPolynomials(left: number[], right: number[]) {
  const result = Array<number>(left.length + right.length - 1).fill(0);
  left.forEach((a, leftIndex) => {
    right.forEach((b, rightIndex) => {
      result[leftIndex + rightIndex] ^= gfMultiply(a, b);
    });
  });
  return result;
}

function gfMultiply(a: number, b: number) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function placeData(matrix: Cell[][], reserved: boolean[][], codewords: number[]) {
  const bits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, index) => (byte >>> (7 - index)) & 1));
  let bitIndex = 0;
  let upward = true;

  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vertical = 0; vertical < SIZE; vertical += 1) {
      const y = upward ? SIZE - 1 - vertical : vertical;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (reserved[y][x]) continue;
        const dataBit = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
        const masked = dataBit !== ((x + y) % 2 === 0);
        matrix[y][x] = masked;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function addFormatInfo(matrix: Cell[][], reserved: boolean[][]) {
  const bits = calculateFormatBits();
  for (let index = 0; index <= 5; index += 1) setModule(matrix, reserved, 8, index, bit(bits, index));
  setModule(matrix, reserved, 8, 7, bit(bits, 6));
  setModule(matrix, reserved, 8, 8, bit(bits, 7));
  setModule(matrix, reserved, 7, 8, bit(bits, 8));
  for (let index = 9; index < 15; index += 1) setModule(matrix, reserved, 14 - index, 8, bit(bits, index));

  for (let index = 0; index < 8; index += 1) setModule(matrix, reserved, SIZE - 1 - index, 8, bit(bits, index));
  for (let index = 8; index < 15; index += 1) setModule(matrix, reserved, 8, SIZE - 15 + index, bit(bits, index));
}

function calculateFormatBits() {
  const errorLevelLow = 0b01;
  const mask = 0b000;
  const data = (errorLevelLow << 3) | mask;
  let value = data << 10;
  const generator = 0b10100110111;

  for (let shift = bitLength(value) - 11; shift >= 0; shift = bitLength(value) - 11) {
    value ^= generator << shift;
  }

  return ((data << 10) | value) ^ 0b101010000010010;
}

function bit(number: number, index: number) {
  return ((number >>> index) & 1) !== 0;
}

function bitLength(number: number) {
  let length = 0;
  while (number > 0) {
    length += 1;
    number >>>= 1;
  }
  return length;
}

import type { ChartMetricDatum } from '@recon/domain';
import { deflateSync } from 'node:zlib';

type Rgba = readonly [red: number, green: number, blue: number, alpha?: number];

const crcTable = new Uint32Array(256);

for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

const crc32 = (buffer: Buffer): number => {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const createChunk = (type: string, data: Buffer): Buffer => {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
};

const encodePng = (width: number, height: number, pixels: Uint8Array): Buffer => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));

  for (let row = 0; row < height; row += 1) {
    const rowStart = row * (stride + 1);
    raw[rowStart] = 0;
    Buffer.from(pixels.subarray(row * stride, (row + 1) * stride)).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    signature,
    createChunk('IHDR', header),
    createChunk('IDAT', deflateSync(raw)),
    createChunk('IEND', Buffer.alloc(0)),
  ]);
};

const setPixel = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Rgba,
): void => {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }

  const offset = (y * width + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3] ?? 255;
};

const fillRect = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: Rgba,
): void => {
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(width, Math.ceil(x + rectWidth));
  const endY = Math.min(height, Math.ceil(y + rectHeight));

  for (let row = startY; row < endY; row += 1) {
    for (let column = startX; column < endX; column += 1) {
      setPixel(pixels, width, height, column, row, color);
    }
  }
};

const drawLine = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: Rgba,
  thickness = 1,
): void => {
  let currentX = Math.round(x1);
  let currentY = Math.round(y1);
  const targetX = Math.round(x2);
  const targetY = Math.round(y2);

  const deltaX = Math.abs(targetX - currentX);
  const stepX = currentX < targetX ? 1 : -1;
  const deltaY = -Math.abs(targetY - currentY);
  const stepY = currentY < targetY ? 1 : -1;
  let error = deltaX + deltaY;

  while (true) {
    fillRect(
      pixels,
      width,
      height,
      currentX - Math.floor(thickness / 2),
      currentY - Math.floor(thickness / 2),
      thickness,
      thickness,
      color,
    );

    if (currentX === targetX && currentY === targetY) {
      break;
    }

    const twiceError = error * 2;
    if (twiceError >= deltaY) {
      error += deltaY;
      currentX += stepX;
    }
    if (twiceError <= deltaX) {
      error += deltaX;
      currentY += stepY;
    }
  }
};

const roundUpToNiceNumber = (value: number): number => {
  if (value <= 0) {
    return 1;
  }

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;

  if (normalized <= 1) {
    return magnitude;
  }
  if (normalized <= 2) {
    return 2 * magnitude;
  }
  if (normalized <= 5) {
    return 5 * magnitude;
  }
  return 10 * magnitude;
};

export interface BarChartImageOptions {
  width?: number;
  height?: number;
  barColor?: Rgba;
  accentColor?: Rgba;
}

export const createBarChartPng = (
  inputData: ChartMetricDatum[],
  options: BarChartImageOptions = {},
): Buffer => {
  const width = options.width ?? 1200;
  const height = options.height ?? 540;
  const barColor = options.barColor ?? [43, 120, 178, 255];
  const accentColor = options.accentColor ?? [15, 118, 110, 255];

  const data = inputData.length > 0 ? inputData : [{ label: 'No data', value: 0 }];
  const pixels = new Uint8Array(width * height * 4);

  fillRect(pixels, width, height, 0, 0, width, height, [247, 248, 250, 255]);
  fillRect(pixels, width, height, 24, 24, width - 48, height - 48, [255, 255, 255, 255]);

  const plotLeft = 92;
  const plotTop = 44;
  const plotWidth = width - 140;
  const plotHeight = height - 110;
  const plotBottom = plotTop + plotHeight;

  for (let tick = 0; tick <= 4; tick += 1) {
    const y = plotTop + Math.round((plotHeight / 4) * tick);
    drawLine(pixels, width, height, plotLeft, y, plotLeft + plotWidth, y, [220, 226, 232, 255], 1);
  }

  drawLine(pixels, width, height, plotLeft, plotTop, plotLeft, plotBottom, [64, 74, 86, 255], 2);
  drawLine(
    pixels,
    width,
    height,
    plotLeft,
    plotBottom,
    plotLeft + plotWidth,
    plotBottom,
    [64, 74, 86, 255],
    2,
  );

  const scaleMax = roundUpToNiceNumber(
    Math.max(...data.map((item) => Math.abs(item.value)), 1),
  );

  const slotWidth = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.max(24, Math.floor(slotWidth * 0.66));

  data.forEach((item, index) => {
    const valueRatio = Math.max(0, Math.abs(item.value)) / scaleMax;
    const barHeight = Math.max(2, Math.round(plotHeight * valueRatio));
    const x = plotLeft + Math.round(index * slotWidth + (slotWidth - barWidth) / 2);
    const y = plotBottom - barHeight;

    fillRect(pixels, width, height, x, y, barWidth, barHeight, barColor);
    fillRect(pixels, width, height, x, y, barWidth, 5, accentColor);
  });

  return encodePng(width, height, pixels);
};

#!/usr/bin/env node
/**
 * Иконки приложения — генерируются кодом, без внешних библиотек и без браузера.
 *
 * Зачем генератор, а не готовые PNG: иконки получаются воспроизводимыми
 * (одинаковый результат на любой машине), их можно пересобрать одной командой,
 * и в репозитории не хранятся двоичные файлы.
 *
 * Рисунок: скруглённый квадрат цвета приложения и стрелка спидометра.
 *
 * Запуск: npm run icons
 */

import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCENT = [0x2f, 0x7d, 0x7a];      // цвет приложения
const ACCENT_SOFT = [0xe2, 0xef, 0xed]; // светлый акцент для шкалы
const WHITE = [0xff, 0xff, 0xff];
const SAMPLES = 3; // сглаживание: 3×3 подпикселя на точку

/* ── Минимальный кодировщик PNG (RGBA, 8 бит) ─────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // фильтр «без фильтрации»
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // глубина цвета
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── Рисунок ──────────────────────────────────────────────────── */

/** Попадает ли точка внутрь скруглённого квадрата. */
function insideRoundedRect(x, y, size, radius) {
  const dx = Math.max(radius - x, 0, x - (size - radius));
  const dy = Math.max(radius - y, 0, y - (size - radius));
  if (dx === 0 || dy === 0) return x >= 0 && y >= 0 && x <= size && y <= size;
  return dx * dx + dy * dy <= radius * radius;
}

function angleOf(x, y, cx, cy) {
  const angle = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
  return angle < 0 ? angle + 360 : angle;
}

/** Цвет точки иконки: возвращает [r, g, b, a] или null, если точка прозрачная. */
function sampleIcon(x, y, size, maskable) {
  const scale = maskable ? 0.76 : 1;
  const background = maskable ? true : insideRoundedRect(x, y, size, size * 0.2265);
  if (!background) return null;

  const cx = size / 2;
  const cy = size * (maskable ? 0.5 : 0.56);
  const outer = size * 0.315 * scale;
  const inner = size * 0.225 * scale;
  const dx = x - cx;
  const dy = y - cy;
  const distance = Math.hypot(dx, dy);
  const angle = angleOf(x, y, cx, cy);

  // шкала спидометра: верхняя полуокружность
  if (distance <= outer && distance >= inner && angle >= 180 && angle <= 360) return ACCENT_SOFT;

  // стрелка
  const needleAngle = 305;
  const rad = (needleAngle * Math.PI) / 180;
  const dirX = Math.cos(rad);
  const dirY = Math.sin(rad);
  const along = dx * dirX + dy * dirY;
  const across = Math.abs(-dx * dirY + dy * dirX);
  if (along >= 0 && along <= outer * 0.82 && across <= size * 0.019 * scale) return WHITE;

  // ось стрелки
  if (distance <= size * 0.052 * scale) return WHITE;
  if (distance <= size * 0.024 * scale) return ACCENT;

  return ACCENT;
}

function render(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const total = SAMPLES * SAMPLES;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = x + (sx + 0.5) / SAMPLES;
          const py = y + (sy + 0.5) / SAMPLES;
          const color = sampleIcon(px, py, size, maskable);
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 255;
          }
        }
      }
      const offset = (y * size + x) * 4;
      const covered = a / total;
      if (covered > 0) {
        // средний цвет только по покрытым подпикселям, чтобы края не «грязнились»
        const share = (a / 255) || 1;
        rgba[offset] = Math.round(r / share);
        rgba[offset + 1] = Math.round(g / share);
        rgba[offset + 2] = Math.round(b / share);
        rgba[offset + 3] = Math.round(covered);
      }
    }
  }
  return encodePng(size, size, rgba);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'client', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const outputs = [
  ['icon-512.png', 512, false],
  ['icon-192.png', 192, false],
  ['apple-touch-icon-180.png', 180, false],
  ['maskable-512.png', 512, true],
];

for (const [name, size, maskable] of outputs) {
  const png = render(size, maskable);
  fs.writeFileSync(path.join(outDir, name), png);
  console.log(`✓ ${name} — ${size}×${size}, ${(png.length / 1024).toFixed(1)} КБ`);
}

console.log(`\nИконки обновлены в ${path.relative(root, outDir)}`);

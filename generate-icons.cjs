// Generates PNG icons for PWA using only Node.js built-ins
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function crc32(buf) {
  let crc = 0xffffffff;
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.allocUnsafe(4);
  const crcInput = Buffer.concat([typeBytes, data]);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

function makePNG(size) {
  // Build RGBA pixel data — indigo (#4f46e5) background + white mic shape
  const bg = [0x4f, 0x46, 0xe5, 0xff]; // indigo-600
  const wh = [0xff, 0xff, 0xff, 0xff]; // white
  const tr = [0x4f, 0x46, 0xe5, 0x00]; // transparent

  const cx = size / 2;
  const cy = size / 2;
  const r  = size * 0.18; // mic body radius
  const mh = size * 0.24; // mic body half-height
  const sr = size * 0.28; // stand arc radius
  const lw = size * 0.06; // line width
  const sw = size * 0.05; // stem width

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte + RGBA
    row[0] = 0; // None filter
    for (let x = 0; x < size; x++) {
      // Rounded square background (full)
      let px = bg;

      // Mic capsule (rounded rect centered slightly above center)
      const mcx = cx, mcy = cy - size * 0.05;
      const dx = Math.abs(x - mcx), dy = Math.abs(y - mcy);
      const inCapsuleRect = dx < r && dy < mh;
      const inCapsuleTop = Math.hypot(x - mcx, y - (mcy - mh + r)) < r;
      const inCapsuleBot = Math.hypot(x - mcx, y - (mcy + mh - r)) < r;

      if (inCapsuleRect || inCapsuleTop || inCapsuleBot) {
        px = wh;
      }

      // Stand arc: ring segment at bottom of mic
      const dist = Math.hypot(x - cx, y - (cy + size * 0.05));
      const angle = Math.atan2(y - (cy + size * 0.05), x - cx) * 180 / Math.PI;
      if (dist >= sr - lw && dist <= sr + lw && angle >= 180 && angle <= 360) {
        px = wh;
      }

      // Stem: vertical line from arc to bottom
      if (Math.abs(x - cx) < sw && y > cy + size * 0.05 + sr && y < cy + size * 0.05 + sr + size * 0.12) {
        px = wh;
      }

      // Base: horizontal line at stem bottom
      const baseY = cy + size * 0.05 + sr + size * 0.12;
      if (Math.abs(y - baseY) < sw && Math.abs(x - cx) < size * 0.14) {
        px = wh;
      }

      row.set(px, 1 + x * 4);
    }
    rows.push(row);
  }

  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw, { level: 9 });

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "public/icons");
fs.mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  const png = makePNG(size);
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
  console.log(`✓ icon-${size}.png (${png.length} bytes)`);
}

// Also write a simple 180px apple-touch-icon
const atIcon = makePNG(180);
fs.writeFileSync(path.join(outDir, "apple-touch-icon.png"), atIcon);
console.log("✓ apple-touch-icon.png");

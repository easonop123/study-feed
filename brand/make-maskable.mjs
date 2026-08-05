/* Builds the maskable app icon from the one already in docs/.

   Android masks a maskable icon to whatever shape the launcher uses, and only
   the centre 80% circle is guaranteed to survive. The Study Feed mark reaches
   radius 44.06 of 100 (its outer tips, plus half the 8.5 stroke), so an
   unpadded icon gets its corners cut off. Scaling the artwork to 0.86 puts the
   furthest stroke at 37.9, inside the 40 the safe zone allows.

   It rescales the existing icon-512.png rather than rasterising the SVG, so the
   maskable icon can never drift from the one it is padding — same pixels, just
   smaller on the same ground. Pure Node: zlib is built in and the file is plain
   8-bit RGB, so this needs no image library.

   Run: node brand/make-maskable.mjs
*/
import fs from 'node:fs';
import zlib from 'node:zlib';

const SRC = 'docs/icon-512.png';
const OUT = 'docs/icon-maskable-512.png';
const SIZE = 512;
const SCALE = 0.86;                 // fits the mark inside the 80% safe circle
const GROUND = [0x14, 0x10, 0x24];  // brand near-black, full bleed

/* ---- decode: 8-bit RGB, non-interlaced ---------------------------------- */
function decode(buf){
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let p = 8, w = 0, h = 0, idat = [];
  while (p < buf.length){
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR'){
      w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12);
      if (buf[p + 16] !== 8 || buf[p + 17] !== 2 || buf[p + 20] !== 0){
        throw new Error('expected 8-bit non-interlaced RGB');
      }
    } else if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 3, stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++){
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++){
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;      // left
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;         // up
      const c = (x >= bpp && y > 0) ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4){
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      px[y * stride + x] = v & 0xff;
    }
  }
  return { w, h, px };
}

/* ---- bilinear resample onto the ground ---------------------------------- */
function padded(src){
  const inner = Math.round(SIZE * SCALE);
  const off = Math.round((SIZE - inner) / 2);
  const out = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) out.set(GROUND, i * 3);

  for (let y = 0; y < inner; y++){
    const sy = (y + 0.5) * src.h / inner - 0.5;
    const y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(src.h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < inner; x++){
      const sx = (x + 0.5) * src.w / inner - 0.5;
      const x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(src.w - 1, x0 + 1), fx = sx - x0;
      for (let c = 0; c < 3; c++){
        const p00 = src.px[(y0 * src.w + x0) * 3 + c], p10 = src.px[(y0 * src.w + x1) * 3 + c];
        const p01 = src.px[(y1 * src.w + x0) * 3 + c], p11 = src.px[(y1 * src.w + x1) * 3 + c];
        const v = p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy)
                + p01 * (1 - fx) * fy       + p11 * fx * fy;
        out[((y + off) * SIZE + (x + off)) * 3 + c] = Math.round(v);
      }
    }
  }
  return out;
}

/* ---- encode -------------------------------------------------------------- */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function encode(px){
  const stride = SIZE * 3;
  const raw = Buffer.alloc(SIZE * (stride + 1));
  for (let y = 0; y < SIZE; y++){
    raw[y * (stride + 1)] = 0;                                   // filter: none
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const src = decode(fs.readFileSync(SRC));
fs.writeFileSync(OUT, encode(padded(src)));
console.log(`${OUT}  ${SIZE}x${SIZE}  artwork at ${Math.round(SIZE * SCALE)}px, ${Math.round((SIZE - SIZE * SCALE) / 2)}px inset`);

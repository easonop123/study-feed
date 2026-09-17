/* ============================================================================
   A PICTURE OF SOME WORDS, MADE IN NODE, WITH NO DEPENDENCIES.

   Three of the app's model-backed features read an image — the slide reader,
   the photo of a handwritten answer, and the photo of working — and until now
   `tools/health.mjs` could not check any of them. It printed the vision model's
   name in its header and then never called it, so the one failure the README
   warns about loudest (NVIDIA retires a free model with days of notice, and the
   next call comes back 410 Gone) would have gone unnoticed on the exact three
   features a student cannot work around by typing instead.

   The reason it could not was that there was nothing to send. The repo cannot
   rasterise a font — that is why `brand/make-og.html` runs in a browser — and a
   committed JPEG of somebody's handwriting is both a binary blob in a text repo
   and, if it were real schoolwork, not ours to commit.

   So the words are drawn rather than typeset: a 5x7 bitmap font defined below,
   scaled up, written straight into a PNG with `zlib.deflateSync`. It is not
   handwriting and it is not pretending to be — the transcription QUALITY
   numbers in the README were measured on deliberately hostile photographs of
   real writing and this cannot replace them. What it can do is answer "is the
   vision model alive, does the proxy still accept an image, and do the words on
   the page come back", which is what a health check is for.

   PNG rather than the JPEG the app sends, because a JPEG encoder is a
   fortnight and a PNG is an hour. If a vision row ever fails while a real photo
   works, suspect the container before suspecting the model.
   ========================================================================== */

import { deflateSync } from 'node:zlib';

/* 5x7, one string per glyph, rows top to bottom. Uppercase only: this exists to
   be read back by a model, not to set type, and halving the table halves the
   chance of a typo in it. Anything not here is drawn as a space. */
const FONT = {
  'A': '01110 10001 10001 11111 10001 10001 10001',
  'B': '11110 10001 10001 11110 10001 10001 11110',
  'C': '01110 10001 10000 10000 10000 10001 01110',
  'D': '11110 10001 10001 10001 10001 10001 11110',
  'E': '11111 10000 10000 11110 10000 10000 11111',
  'F': '11111 10000 10000 11110 10000 10000 10000',
  'G': '01110 10001 10000 10111 10001 10001 01111',
  'H': '10001 10001 10001 11111 10001 10001 10001',
  'I': '01110 00100 00100 00100 00100 00100 01110',
  'J': '00111 00010 00010 00010 00010 10010 01100',
  'K': '10001 10010 10100 11000 10100 10010 10001',
  'L': '10000 10000 10000 10000 10000 10000 11111',
  'M': '10001 11011 10101 10101 10001 10001 10001',
  'N': '10001 11001 10101 10011 10001 10001 10001',
  'O': '01110 10001 10001 10001 10001 10001 01110',
  'P': '11110 10001 10001 11110 10000 10000 10000',
  'Q': '01110 10001 10001 10001 10101 10010 01101',
  'R': '11110 10001 10001 11110 10100 10010 10001',
  'S': '01111 10000 10000 01110 00001 00001 11110',
  'T': '11111 00100 00100 00100 00100 00100 00100',
  'U': '10001 10001 10001 10001 10001 10001 01110',
  'V': '10001 10001 10001 10001 10001 01010 00100',
  'W': '10001 10001 10001 10101 10101 11011 10001',
  'X': '10001 10001 01010 00100 01010 10001 10001',
  'Y': '10001 10001 01010 00100 00100 00100 00100',
  'Z': '11111 00001 00010 00100 01000 10000 11111',
  '0': '01110 10001 10011 10101 11001 10001 01110',
  '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111',
  '3': '11110 00001 00001 01110 00001 00001 11110',
  '4': '00010 00110 01010 10010 11111 00010 00010',
  '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110',
  '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110',
  '9': '01110 10001 10001 01111 00001 00010 01100',
  '.': '00000 00000 00000 00000 00000 01100 01100',
  ',': '00000 00000 00000 00000 01100 01100 11000',
  '-': '00000 00000 00000 11111 00000 00000 00000',
  '+': '00000 00100 00100 11111 00100 00100 00000',
  '=': '00000 00000 11111 00000 11111 00000 00000',
  '/': '00001 00010 00010 00100 01000 01000 10000',
  '(': '00010 00100 01000 01000 01000 00100 00010',
  ')': '01000 00100 00010 00010 00010 00100 01000',
  ':': '00000 01100 01100 00000 01100 01100 00000',
  '?': '01110 10001 00001 00110 00100 00000 00100',
  '^': '00100 01010 10001 00000 00000 00000 00000',
  "'": '00100 00100 00000 00000 00000 00000 00000',
  '%': '11000 11001 00010 00100 01000 10011 00011',
};

const GLYPH_W = 5, GLYPH_H = 7;

/* ---- PNG, the smallest correct one: 8-bit greyscale, no interlace ---- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf){
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(pixels, w, h){
  /* One filter byte (0 = none) in front of every scanline is the whole of the
     PNG filtering we need — the image is flat black on flat white and there is
     nothing for a predictor to win. */
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++){
    raw[y * (w + 1)] = 0;
    pixels.copy(raw, y * (w + 1) + 1, y * w, (y + 1) * w);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 0;   // colour type 0 = greyscale
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---- drawing ---- */

/* `lines` is an array of strings. Returns { media_type, data } — the same shape
   `resizeImage` hands the app's own vision calls, so a caller can pass it
   straight to `transcribeAnswer` and friends without a special case.

   `scale` is how many pixels wide one bitmap pixel becomes. 8 puts a capital
   letter at 56px tall, which is roughly the size handwriting arrives at from a
   phone once the app has shrunk the photo to 1500px. */
export function imageOfText(lines, opts){
  const o = opts || {};
  const scale = o.scale || 8;
  const pad = o.pad || 3 * scale;
  const lead = Math.round(GLYPH_H * scale * 0.6);   // space between baselines

  const rows = lines.map(s => String(s == null ? '' : s).toUpperCase());
  const cols = rows.reduce((m, s) => Math.max(m, s.length), 1);

  const w = pad * 2 + cols * (GLYPH_W + 1) * scale;
  const h = pad * 2 + rows.length * (GLYPH_H * scale + lead) - lead;
  const px = Buffer.alloc(w * h, 0xFF);            // white page

  rows.forEach((text, r) => {
    const top = pad + r * (GLYPH_H * scale + lead);
    for (let i = 0; i < text.length; i++){
      const glyph = FONT[text[i]];
      if (!glyph) continue;
      const bits = glyph.split(' ');
      const left = pad + i * (GLYPH_W + 1) * scale;
      for (let gy = 0; gy < GLYPH_H; gy++){
        for (let gx = 0; gx < GLYPH_W; gx++){
          if (bits[gy][gx] !== '1') continue;
          for (let sy = 0; sy < scale; sy++){
            const y = top + gy * scale + sy;
            const start = y * w + left + gx * scale;
            px.fill(0x00, start, start + scale);
          }
        }
      }
    }
  });

  return { media_type: 'image/png', data: encodePng(px, w, h).toString('base64') };
}

/* Run it directly to eyeball the page the checker is sending:
     node tools/test-image.mjs out.png                                */
if (process.argv[1] && process.argv[1].endsWith('test-image.mjs')){
  const { writeFileSync } = await import('node:fs');
  const out = process.argv[2] || 'test-image.png';
  const img = imageOfText(['RATES OF REACTION', 'M = 250 G', 'A = 12.5 / 4 = 3.125']);
  writeFileSync(out, Buffer.from(img.data, 'base64'));
  console.log(`wrote ${out}`);
}

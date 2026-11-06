#!/usr/bin/env node
/**
 * Generates the bundled sample lesson video:
 *
 *   client/public/media/lesson-sample.mp4   (H.264 / MP4, 512x288, 12:05)
 *   client/public/captions/lesson-sample.en.vtt
 *
 * Why generate instead of hot-linking: the seed used to point every lesson at
 * Google's public `gtv-videos-bucket` samples, and that bucket now answers
 * 403, so no lesson had a playable source. A sample that ships with the
 * repository cannot rot, needs no CDN, satisfies the client's own CSP
 * (`media-src 'self'`) and keeps the promise made elsewhere in this codebase
 * that nothing is fetched from a third party at runtime.
 *
 * Why no ffmpeg: a contributor should not need a media toolchain to rebuild an
 * asset. The slides are rendered by headless Chrome (the one dependency, and
 * only for *re*generating the committed file), and this script does the rest
 * itself: PNG decode, RGB to YUV 4:2:0, an H.264 encoder and an MP4 muxer.
 *
 * How the encoder stays small: every macroblock of a slide is coded as I_PCM
 * — the H.264 macroblock type that carries raw samples with no prediction,
 * transform or entropy coding (ITU-T H.264 7.3.5, 7.4.5). That is lossless
 * and needs none of the machinery a real encoder has, at the cost of ~221 kB
 * per distinct frame. Between slides the picture is repeated as a P frame
 * whose macroblocks are all skipped, which copies the previous frame exactly
 * and costs about five bytes. Ten slides, 12:05 of video, ~2.2 MB.
 *
 * Why not simply hold one frame for a minute in the sample table instead: a
 * browser's video renderer schedules against an expected frame cadence, and
 * with 85-second samples Chrome presents frames tens of seconds late and
 * drops some altogether (`requestVideoFrameCallback` reports mediaTime 80
 * arriving at currentTime 115, with mediaTime 25 never presented at all).
 * A plain 10 fps stream behaves like any other video.
 *
 * Usage:  npm run lesson:video            (CHROME_PATH=... to pick a browser)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ *
 * Format
 * ------------------------------------------------------------------ */

/**
 * 512x288 is 16:9 and a whole number of 16x16 macroblocks in both axes, so
 * the encoder needs no frame cropping. Slides are rendered at 2x and box
 * filtered down, which is what keeps the type legible at this size.
 */
const WIDTH = 512;
const HEIGHT = 288;
const SCALE = 2;
const MB_COLS = WIDTH / 16;
const MB_ROWS = HEIGHT / 16;
const MB_COUNT = MB_COLS * MB_ROWS;
const TIMESCALE = 1000;
/** Slides are static, so the rate only has to look ordinary to the renderer. */
const FPS = 10;

/* ------------------------------------------------------------------ *
 * The lesson
 * ------------------------------------------------------------------ */

const COURSE = 'TypeScript for Production APIs';
const LESSON = 'Validating requests with Zod';

/**
 * One entry per slide: `seconds` is how long it is held, and `captions` are
 * the cues written into the .vtt for that slide (offsets are relative to the
 * slide). The total is asserted against the seed's duration constant, so the
 * video's length and `durationSeconds` cannot drift apart.
 */
const SLIDES = [
  {
    kind: 'title',
    seconds: 25,
    eyebrow: `${COURSE} · Module 2`,
    title: LESSON,
    note: 'Lesson 5 of 12 · 12:05',
    captions: [[0, 4, 'Welcome back. In this lesson we define one schema per request body.']],
  },
  {
    kind: 'bullets',
    seconds: 55,
    eyebrow: 'In this lesson',
    title: 'Validation as a single source of truth',
    bullets: [
      'One schema per request body',
      'Infer the TypeScript type from that schema',
      'Return structured 422s the client can use',
    ],
    captions: [
      [
        0,
        5.5,
        'We infer the TypeScript type from that schema, so there is a single\nsource of truth for both validation and types.',
      ],
      [5.5, 11, 'Then we return structured 422 errors the frontend can map onto fields.'],
    ],
  },
  {
    kind: 'code',
    seconds: 85,
    eyebrow: 'Step 1',
    title: 'One schema per request body',
    code: [
      "import { z } from 'zod';",
      '',
      'export const createCourseSchema = z.object({',
      '  title: z.string().trim().min(3).max(120),',
      "  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE']),",
      '});',
    ],
    captions: [
      [
        0,
        6,
        'The schema lives in the shared package, so the client and the server\nread the same rules.',
      ],
    ],
  },
  {
    kind: 'code',
    seconds: 85,
    eyebrow: 'Step 2',
    title: 'Infer the type, never repeat it',
    code: [
      'export type CreateCourseInput = z.infer<',
      '  typeof createCourseSchema',
      '>;',
      '',
      '// Change the schema and every call site fails to compile.',
    ],
    captions: [[0, 6, 'The type is inferred, so a hand-written interface can never drift from it.']],
  },
  {
    kind: 'code',
    seconds: 85,
    eyebrow: 'Step 3',
    title: 'Parse at the edge',
    code: [
      'router.post(',
      "  '/courses',",
      '  requireRole(Role.ADMIN),',
      '  validate({ body: createCourseSchema }),',
      '  createCourse,',
      ');',
    ],
    captions: [
      [
        0,
        6,
        'One middleware parses the body, so a controller only ever sees data\nthat has already passed.',
      ],
    ],
  },
  {
    kind: 'code',
    seconds: 85,
    eyebrow: 'Step 4',
    title: 'Structured 422s, not strings',
    code: [
      '{',
      '  "error": {',
      '    "code": "VALIDATION_ERROR",',
      '    "fieldErrors": {',
      '      "title": ["Must be at least 3 characters"]',
      '    }',
      '  }',
      '}',
    ],
    captions: [[0, 6, 'Errors come back keyed by field name, which is what a form needs.']],
  },
  {
    kind: 'bullets',
    seconds: 85,
    eyebrow: 'On the client',
    title: 'The form maps the fields it is given',
    bullets: [
      'setError(field, { message }) per entry',
      'No parallel copy of the rules in the UI',
      'A new rule reaches both sides at once',
    ],
    captions: [[0, 6, 'The client sets each field error it is handed, and keeps no rules of its own.']],
  },
  {
    kind: 'bullets',
    seconds: 85,
    eyebrow: 'Why it holds',
    title: 'Never trust the client',
    bullets: [
      'The browser check is a courtesy',
      'The server check is the contract',
      'Both are the same schema, so they agree',
    ],
    captions: [[0, 6, 'Browser validation is a courtesy. The server check is the one that counts.']],
  },
  {
    kind: 'bullets',
    seconds: 90,
    eyebrow: 'Recap',
    title: 'Written once, enforced everywhere',
    bullets: [
      'Schema in shared/, parsed in middleware',
      'Types inferred, never duplicated',
      '422 bodies the UI can map onto inputs',
    ],
    captions: [[0, 6, 'That means a validation rule is written once and enforced everywhere.']],
  },
  {
    kind: 'outro',
    seconds: 45,
    eyebrow: 'Next up',
    title: 'Layered services',
    note: 'Controllers stay thin · services own the rules',
    captions: [[0, 5, 'Next: moving the rules out of the controller and into a service layer.']],
  },
];

const TOTAL_SECONDS = SLIDES.reduce((sum, slide) => sum + slide.seconds, 0);

/* ------------------------------------------------------------------ *
 * Slide rendering (headless Chrome)
 * ------------------------------------------------------------------ */

const FONTS = {
  display:
    'client/src/assets/fonts/bricolage-grotesque/bricolage-grotesque-latin-wght-normal.woff2',
  body: 'client/src/assets/fonts/inter/inter-latin-wght-normal.woff2',
  mono: 'client/src/assets/fonts/jetbrains-mono/jetbrains-mono-latin-wght-normal.woff2',
};

/** The project's self-hosted families, inlined so the page needs no file access. */
function fontFaces() {
  const face = (family, path, weights) => {
    const data = readFileSync(join(root, path)).toString('base64');
    return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${data}) format('woff2');font-weight:${weights};font-style:normal;font-display:block}`;
  };
  return [
    face('Cadence Display', FONTS.display, '200 800'),
    face('Cadence Body', FONTS.body, '100 900'),
    face('Cadence Mono', FONTS.mono, '100 800'),
  ].join('\n');
}

const escapeHtml = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Just enough highlighting to read like an editor: comments, strings,
 * JSON keys and keywords. Applied to already-escaped text, so nothing in the
 * slide script can inject markup.
 */
function highlight(line) {
  const escaped = escapeHtml(line);
  if (/^\s*\/\//.test(escaped)) return `<span class="c-comment">${escaped}</span>`;
  return escaped
    .replace(/'([^']*)'/g, '<span class="c-string">&#39;$1&#39;</span>')
    .replace(/("[^"]*")(\s*:)/g, '<span class="c-key">$1</span>$2')
    .replace(/(^|[[\s])("[^"]*")/g, '$1<span class="c-string">$2</span>')
    .replace(
      /\b(import|from|export|const|type|typeof|return|await|async)\b/g,
      '<span class="c-keyword">$1</span>',
    )
    .replace(/\b(z|router|validate|requireRole)\b/g, '<span class="c-ident">$1</span>');
}

function slideBody(slide) {
  const eyebrow = `<p class="eyebrow">${escapeHtml(slide.eyebrow)}</p>`;
  const title = `<h1${slide.kind === 'title' ? ' class="hero"' : ''}>${escapeHtml(slide.title)}</h1>`;

  if (slide.kind === 'title' || slide.kind === 'outro') {
    return `<div class="centre">
      <div class="mark"><span class="bar b1"></span><span class="bar b2"></span><span class="bar b3"></span><span class="wordmark">Cadence</span></div>
      ${eyebrow}${title}
      <p class="note">${escapeHtml(slide.note ?? '')}</p>
    </div>`;
  }

  const content =
    slide.kind === 'code'
      ? `<pre class="code">${slide.code.map((line) => highlight(line) || ' ').join('\n')}</pre>`
      : `<ul class="bullets">${slide.bullets
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join('')}</ul>`;

  return `<main>${eyebrow}${title}${content}</main>`;
}

function slideHtml(slide, index, faces) {
  const dots = SLIDES.map(
    (_, i) => `<span class="dot${i === index ? ' on' : ''}"></span>`,
  ).join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(slide.title)}</title>
<style>
${faces}
:root{
  --night:#0C0E16; --white:#FFFFFF; --muted:#A8ADBF;
  --amber:#FFB020; --cobalt:#2F4BFF; --peach:#FFB98F;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${WIDTH * SCALE}px;height:${HEIGHT * SCALE}px;overflow:hidden}
body{
  background:
    radial-gradient(120% 90% at 100% 0%, rgba(47,75,255,.22) 0%, rgba(12,14,22,0) 55%),
    radial-gradient(90% 70% at 0% 100%, rgba(255,176,32,.12) 0%, rgba(12,14,22,0) 60%),
    var(--night);
  color:var(--white);
  font-family:'Cadence Body';
  font-size:30px; line-height:1.45;
  padding:52px 64px 40px;
  display:flex; flex-direction:column;
  -webkit-font-smoothing:antialiased;
}
main{display:flex;flex-direction:column;gap:24px}
.centre{margin:auto 0;display:flex;flex-direction:column;gap:16px}
.eyebrow{
  font-family:'Cadence Mono';font-size:24px;font-weight:600;
  letter-spacing:.12em;text-transform:uppercase;color:var(--amber);
}
h1{font-family:'Cadence Display';font-weight:700;font-size:62px;line-height:1.04;letter-spacing:-.02em}
h1.hero{font-size:84px}
.note{font-family:'Cadence Mono';font-size:26px;color:var(--muted)}
.bullets{list-style:none;display:flex;flex-direction:column;gap:18px;font-size:34px;color:#E6E8EF}
.bullets li{display:flex;align-items:flex-start;gap:20px}
.bullets li::before{
  content:'';flex:none;width:14px;height:14px;margin-top:17px;border-radius:999px;
  background:var(--cobalt);box-shadow:0 0 0 7px rgba(47,75,255,.18);
}
.code{
  font-family:'Cadence Mono';font-size:27px;line-height:1.5;color:#E6E8EF;
  background:rgba(255,255,255,.055);border:2px solid rgba(255,255,255,.14);
  border-radius:18px;padding:24px 28px;white-space:pre;
}
.c-keyword{color:var(--amber)} .c-string{color:var(--peach)}
.c-comment{color:var(--muted)} .c-key{color:#9DB2FF} .c-ident{color:#9DB2FF}
.mark{display:flex;align-items:flex-end;gap:7px;margin-bottom:10px}
.bar{display:block;width:10px;border-radius:999px;background:var(--amber)}
.b1{height:26px} .b2{height:40px;background:var(--cobalt)} .b3{height:18px}
.wordmark{
  font-family:'Cadence Display';font-weight:700;font-size:34px;
  letter-spacing:-.01em;margin-left:10px;line-height:1;
}
footer{
  margin-top:auto;display:flex;justify-content:space-between;align-items:center;
  font-family:'Cadence Mono';font-size:22px;color:var(--muted);
  border-top:2px solid rgba(255,255,255,.12);padding-top:16px;
}
footer .rail{display:flex;gap:8px;align-items:center}
footer .dot{width:12px;height:12px;border-radius:999px;background:rgba(255,255,255,.22)}
footer .dot.on{background:var(--amber)}
</style></head>
<body>
${slideBody(slide)}
<footer>
  <span>${escapeHtml(COURSE)}</span>
  <span class="rail">${dots}</span>
</footer>
</body></html>`;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      'No Chrome or Edge found. Set CHROME_PATH to a Chromium-based browser; it is ' +
        'only needed to regenerate the committed sample video.',
    );
  }
  return found;
}

/** Renders every slide to a PNG and returns the decoded pixels. */
function renderSlides(workDir) {
  const chrome = findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'cadence-chrome-'));
  const faces = fontFaces();
  try {
    return SLIDES.map((slide, index) => {
      const htmlPath = join(workDir, `slide-${index}.html`);
      const pngPath = join(workDir, `slide-${index}.png`);
      writeFileSync(htmlPath, slideHtml(slide, index, faces));

      const result = spawnSync(
        chrome,
        [
          '--headless=new',
          '--disable-gpu',
          '--hide-scrollbars',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-extensions',
          '--force-device-scale-factor=1',
          '--font-render-hinting=none',
          '--virtual-time-budget=4000',
          `--user-data-dir=${profile}`,
          `--window-size=${WIDTH * SCALE},${HEIGHT * SCALE}`,
          `--screenshot=${pngPath}`,
          `file://${htmlPath.replace(/\\/g, '/')}`,
        ],
        { encoding: 'utf8' },
      );
      if (!existsSync(pngPath)) {
        throw new Error(`Chrome did not render slide ${index}: ${result.stderr || result.error}`);
      }
      const png = decodePng(readFileSync(pngPath));
      if (png.width !== WIDTH * SCALE || png.height !== HEIGHT * SCALE) {
        throw new Error(`Slide ${index} came back ${png.width}x${png.height}`);
      }
      process.stdout.write(`  slide ${index + 1}/${SLIDES.length} rendered\n`);
      return png;
    });
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ *
 * PNG decoding (8-bit RGB/RGBA, non-interlaced — what Chrome writes)
 * ------------------------------------------------------------------ */

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const depth = buffer[24];
  const colorType = buffer[25];
  if (depth !== 8 || (colorType !== 2 && colorType !== 6) || buffer[28] !== 0) {
    throw new Error(`Unsupported PNG: depth ${depth}, colour type ${colorType}`);
  }

  const chunks = [];
  for (let offset = 8; offset + 8 <= buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    if (type === 'IEND') break;
    offset += length + 12;
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(chunks));
  const pixels = Buffer.alloc(height * stride);

  let read = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    raw.copy(row, 0, read, read + stride);
    read += stride;
    unfilter(filter, row, previous, bpp);
    previous = row;
  }
  return { width, height, bpp, pixels };
}

function unfilter(filter, row, previous, bpp) {
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= bpp ? row[i - bpp] : 0;
    const up = previous[i];
    const upLeft = i >= bpp ? previous[i - bpp] : 0;
    switch (filter) {
      case 0:
        break;
      case 1:
        row[i] = (row[i] + left) & 0xff;
        break;
      case 2:
        row[i] = (row[i] + up) & 0xff;
        break;
      case 3:
        row[i] = (row[i] + ((left + up) >> 1)) & 0xff;
        break;
      case 4:
        row[i] = (row[i] + paeth(left, up, upLeft)) & 0xff;
        break;
      default:
        throw new Error(`Unknown PNG filter ${filter}`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Colour: RGB to YUV 4:2:0, BT.601 studio swing
 * ------------------------------------------------------------------ */

const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);

/**
 * Box filters the 2x rendering down to WIDTHxHEIGHT and converts to planar
 * 4:2:0. Studio swing (Y 16-235, C 16-240) is what a decoder assumes when,
 * as here, the stream carries no VUI colour description — and it has a happy
 * side effect: no sample byte is ever 0x00, so the emulation-prevention pass
 * below almost never has to fire.
 */
function toYuv420({ width, bpp, pixels }) {
  const y = Buffer.alloc(WIDTH * HEIGHT);
  const u = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2));
  const v = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2));
  const rgb = new Int32Array(WIDTH * HEIGHT * 3);

  for (let row = 0; row < HEIGHT; row += 1) {
    for (let col = 0; col < WIDTH; col += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < SCALE; dy += 1) {
        for (let dx = 0; dx < SCALE; dx += 1) {
          const at = ((row * SCALE + dy) * width + (col * SCALE + dx)) * bpp;
          r += pixels[at];
          g += pixels[at + 1];
          b += pixels[at + 2];
        }
      }
      const count = SCALE * SCALE;
      const at = (row * WIDTH + col) * 3;
      rgb[at] = Math.round(r / count);
      rgb[at + 1] = Math.round(g / count);
      rgb[at + 2] = Math.round(b / count);
      y[row * WIDTH + col] = clamp(
        ((66 * rgb[at] + 129 * rgb[at + 1] + 25 * rgb[at + 2] + 128) >> 8) + 16,
        16,
        235,
      );
    }
  }

  for (let row = 0; row < HEIGHT / 2; row += 1) {
    for (let col = 0; col < WIDTH / 2; col += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const at = ((row * 2 + dy) * WIDTH + (col * 2 + dx)) * 3;
          r += rgb[at];
          g += rgb[at + 1];
          b += rgb[at + 2];
        }
      }
      r /= 4;
      g /= 4;
      b /= 4;
      const index = row * (WIDTH / 2) + col;
      u[index] = clamp(((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128, 16, 240);
      v[index] = clamp(((112 * r - 94 * g - 18 * b + 128) >> 8) + 128, 16, 240);
    }
  }
  return { y, u, v };
}

/* ------------------------------------------------------------------ *
 * H.264: a bit writer, SPS/PPS, and I_PCM-only IDR slices
 * ------------------------------------------------------------------ */

class BitWriter {
  constructor() {
    this.bytes = [];
    this.partial = 0;
    this.used = 0;
  }

  bit(value) {
    this.partial = (this.partial << 1) | (value & 1);
    this.used += 1;
    if (this.used === 8) {
      this.bytes.push(this.partial);
      this.partial = 0;
      this.used = 0;
    }
  }

  /** u(n) */
  u(count, value) {
    for (let i = count - 1; i >= 0; i -= 1) this.bit((value >> i) & 1);
  }

  /** ue(v): unsigned Exp-Golomb */
  ue(value) {
    const code = value + 1;
    const length = 32 - Math.clz32(code);
    this.u(length - 1, 0);
    this.u(length, code);
  }

  /** se(v): signed Exp-Golomb */
  se(value) {
    this.ue(value <= 0 ? -2 * value : 2 * value - 1);
  }

  /** pcm_alignment_zero_bit */
  align() {
    while (this.used !== 0) this.bit(0);
  }

  raw(buffer) {
    if (this.used !== 0) throw new Error('raw() needs a byte-aligned writer');
    for (const byte of buffer) this.bytes.push(byte);
  }

  /** rbsp_trailing_bits */
  finish() {
    this.bit(1);
    this.align();
    return Buffer.from(this.bytes);
  }
}

/**
 * RBSP to EBSP: a decoder would read 00 00 00/01/02/03 as a start-code
 * prefix, so a 0x03 is stuffed after any two zero bytes. Studio-swing samples
 * make this rare, but a slice header can still produce the pattern.
 */
function escapeRbsp(rbsp) {
  const out = [];
  let zeros = 0;
  for (const byte of rbsp) {
    if (zeros === 2 && byte <= 3) {
      out.push(3);
      zeros = 0;
    }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return Buffer.from(out);
}

const nal = (header, rbsp) => Buffer.concat([Buffer.from([header]), escapeRbsp(rbsp)]);

/** Baseline profile, level 3.0 — 512x288 progressive, CAVLC, 4:2:0. */
const PROFILE_IDC = 66;
const CONSTRAINTS = 0x80; // constraint_set0_flag
const LEVEL_IDC = 30;

function buildSps() {
  const w = new BitWriter();
  w.u(8, PROFILE_IDC);
  w.u(8, CONSTRAINTS);
  w.u(8, LEVEL_IDC);
  w.ue(0); // seq_parameter_set_id
  w.ue(0); // log2_max_frame_num_minus4 — frame_num is 4 bits
  // Type 2 derives the picture order count from the decoding order, which is
  // the display order here (IDR, then P frames, no reordering). It also takes
  // pic_order_cnt_lsb out of every slice header.
  w.ue(2); // pic_order_cnt_type
  w.ue(1); // max_num_ref_frames — a P frame only ever needs the one before it
  w.u(1, 0); // gaps_in_frame_num_value_allowed_flag
  w.ue(MB_COLS - 1); // pic_width_in_mbs_minus1
  w.ue(MB_ROWS - 1); // pic_height_in_map_units_minus1
  w.u(1, 1); // frame_mbs_only_flag
  w.u(1, 1); // direct_8x8_inference_flag
  w.u(1, 0); // frame_cropping_flag
  w.u(1, 0); // vui_parameters_present_flag
  return nal(0x67, w.finish());
}

function buildPps() {
  const w = new BitWriter();
  w.ue(0); // pic_parameter_set_id
  w.ue(0); // seq_parameter_set_id
  w.u(1, 0); // entropy_coding_mode_flag — CAVLC
  w.u(1, 0); // bottom_field_pic_order_in_frame_present_flag
  w.ue(0); // num_slice_groups_minus1
  w.ue(0); // num_ref_idx_l0_default_active_minus1
  w.ue(0); // num_ref_idx_l1_default_active_minus1
  w.u(1, 0); // weighted_pred_flag
  w.u(2, 0); // weighted_bipred_idc
  w.se(0); // pic_init_qp_minus26
  w.se(0); // pic_init_qs_minus26
  w.se(0); // chroma_qp_index_offset
  w.u(1, 0); // deblocking_filter_control_present_flag
  w.u(1, 0); // constrained_intra_pred_flag
  w.u(1, 0); // redundant_pic_cnt_present_flag
  return nal(0x68, w.finish());
}

const MB_TYPE_I_PCM = 25;

/**
 * One IDR picture, one slice, every macroblock I_PCM. `idrPicId` alternates
 * because consecutive IDR access units must not share it (H.264 7.4.3).
 */
function encodeIdr({ y, u, v }, idrPicId) {
  const w = new BitWriter();
  w.ue(0); // first_mb_in_slice
  w.ue(7); // slice_type — I, and every slice of the picture is I
  w.ue(0); // pic_parameter_set_id
  w.u(4, 0); // frame_num — 0 in every IDR picture
  w.ue(idrPicId);
  w.u(1, 0); // no_output_of_prior_pics_flag
  w.u(1, 0); // long_term_reference_flag
  w.se(0); // slice_qp_delta

  const luma = Buffer.alloc(256);
  const cb = Buffer.alloc(64);
  const cr = Buffer.alloc(64);
  for (let mbRow = 0; mbRow < MB_ROWS; mbRow += 1) {
    for (let mbCol = 0; mbCol < MB_COLS; mbCol += 1) {
      w.ue(MB_TYPE_I_PCM);
      w.align(); // pcm_alignment_zero_bit
      for (let row = 0; row < 16; row += 1) {
        const from = (mbRow * 16 + row) * WIDTH + mbCol * 16;
        y.copy(luma, row * 16, from, from + 16);
      }
      for (let row = 0; row < 8; row += 1) {
        const from = (mbRow * 8 + row) * (WIDTH / 2) + mbCol * 8;
        u.copy(cb, row * 8, from, from + 8);
        v.copy(cr, row * 8, from, from + 8);
      }
      w.raw(luma);
      w.raw(cb);
      w.raw(cr);
    }
  }
  return nal(0x65, w.finish());
}

/**
 * A P picture in which every macroblock is skipped: no residual, no motion,
 * reference index 0. The predicted motion vector is zero, so the decoder
 * copies the previous picture sample for sample and the slide stays exact.
 *
 * It is coded as a reference picture (nal_ref_idc = 2) so the next P frame
 * can copy it in turn; `max_num_ref_frames` is 1, so the sliding window drops
 * its predecessor on its own and no MMCO commands are needed.
 */
function encodeSkippedP(frameNum) {
  const w = new BitWriter();
  w.ue(0); // first_mb_in_slice
  w.ue(5); // slice_type — P, and every slice of the picture is P
  w.ue(0); // pic_parameter_set_id
  w.u(4, frameNum & 0x0f);
  w.u(1, 0); // num_ref_idx_active_override_flag
  w.u(1, 0); // ref_pic_list_modification_flag_l0
  w.u(1, 0); // adaptive_ref_pic_marking_mode_flag — sliding window
  w.se(0); // slice_qp_delta
  w.ue(MB_COUNT); // mb_skip_run — the whole picture
  return nal(0x41, w.finish()); // nal_ref_idc 2, nal_unit_type 1
}

/* ------------------------------------------------------------------ *
 * MP4
 * ------------------------------------------------------------------ */

const u32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
};
const u16 = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
};
const box = (type, ...parts) => {
  const body = Buffer.concat(
    parts.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part, 'ascii'))),
  );
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'ascii'), body]);
};
const table = (type, entries) => box(type, u32(0), u32(entries.length), Buffer.concat(entries));

/** The unity display matrix, 16.16 / 2.30 fixed point. */
const UNITY_MATRIX = Buffer.concat(
  [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32),
);

function buildMp4(samples, durations, keyframes) {
  const created = Math.floor(Date.now() / 1000) + 2082844800; // seconds since 1904
  const total = durations.reduce((sum, value) => sum + value, 0);
  const sps = buildSps();
  const pps = buildPps();

  const avcC = box(
    'avcC',
    Buffer.from([1, PROFILE_IDC, CONSTRAINTS, LEVEL_IDC, 0xff, 0xe1]),
    u16(sps.length),
    sps,
    Buffer.from([1]),
    u16(pps.length),
    pps,
  );

  const compressorName = Buffer.alloc(32);
  compressorName.write('\u000bCadence/JS', 0, 'binary');

  const avc1 = box(
    'avc1',
    Buffer.alloc(6),
    u16(1), // data_reference_index
    u16(0),
    u16(0),
    Buffer.alloc(12),
    u16(WIDTH),
    u16(HEIGHT),
    u32(0x00480000), // 72 dpi
    u32(0x00480000),
    u32(0),
    u16(1), // frame_count
    compressorName,
    u16(0x0018), // depth
    Buffer.from([0xff, 0xff]), // pre_defined = -1
    avcC,
  );

  // stts, coalescing runs of equal sample durations.
  const stts = [];
  for (const duration of durations) {
    const last = stts[stts.length - 1];
    if (last && last.delta === duration) last.count += 1;
    else stts.push({ count: 1, delta: duration });
  }

  const sampleTable = (chunkOffset) =>
    box(
      'stbl',
      box('stsd', u32(0), u32(1), avc1),
      table(
        'stts',
        stts.map((run) => Buffer.concat([u32(run.count), u32(run.delta)])),
      ),
      // Only the slide IDRs are sync samples; seeking lands on one of those.
      table('stss', keyframes.map(u32)),
      table('stsc', [Buffer.concat([u32(1), u32(samples.length), u32(1)])]),
      // A sample is [4-byte NAL length][NAL], so its size counts the prefix.
      box(
        'stsz',
        u32(0),
        u32(0),
        u32(samples.length),
        Buffer.concat(samples.map((sample) => u32(sample.length + 4))),
      ),
      table('stco', [u32(chunkOffset)]),
    );

  const buildMoov = (chunkOffset) =>
    box(
      'moov',
      box(
        'mvhd',
        u32(0),
        u32(created),
        u32(created),
        u32(TIMESCALE),
        u32(total),
        u32(0x00010000), // rate
        u16(0x0100), // volume
        u16(0),
        Buffer.alloc(8),
        UNITY_MATRIX,
        Buffer.alloc(24),
        u32(2), // next_track_ID
      ),
      box(
        'trak',
        box(
          'tkhd',
          u32(0x00000003), // enabled, in movie
          u32(created),
          u32(created),
          u32(1), // track_ID
          u32(0),
          u32(total),
          Buffer.alloc(8),
          u16(0), // layer
          u16(0), // alternate_group
          u16(0), // volume — a video track
          u16(0),
          UNITY_MATRIX,
          u32(WIDTH << 16),
          u32(HEIGHT << 16),
        ),
        box(
          'mdia',
          box(
            'mdhd',
            u32(0),
            u32(created),
            u32(created),
            u32(TIMESCALE),
            u32(total),
            u16(0x55c4), // 'und'
            u16(0),
          ),
          box(
            'hdlr',
            u32(0),
            u32(0),
            'vide',
            Buffer.alloc(12),
            Buffer.from('VideoHandler\0', 'ascii'),
          ),
          box(
            'minf',
            box('vmhd', u32(0x00000001), u16(0), u16(0), u16(0), u16(0)),
            box('dinf', box('dref', u32(0), u32(1), box('url ', u32(0x00000001)))),
            sampleTable(chunkOffset),
          ),
        ),
      ),
    );

  const ftyp = box('ftyp', 'isom', u32(0x200), 'isom', 'iso2', 'avc1', 'mp41');
  const payload = Buffer.concat(
    samples.map((sample) => Buffer.concat([u32(sample.length), sample])),
  );
  // moov comes first so a browser can start on the first range request. The
  // chunk offset is absolute, but moov's size does not depend on its value,
  // so one dry run is enough to learn where mdat's payload lands.
  const offset = ftyp.length + buildMoov(0).length + 8;
  return Buffer.concat([ftyp, buildMoov(offset), box('mdat', payload)]);
}

/* ------------------------------------------------------------------ *
 * Captions
 * ------------------------------------------------------------------ */

const vttTime = (seconds) => {
  const whole = Math.floor(seconds);
  const ms = Math.round((seconds - whole) * 1000);
  const hh = String(Math.floor(whole / 3600)).padStart(2, '0');
  const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
  const ss = String(whole % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}.${String(ms).padStart(3, '0')}`;
};

function buildCaptions() {
  const lines = [
    'WEBVTT',
    '',
    'NOTE',
    'Captions for the bundled sample lesson video (/media/lesson-sample.mp4).',
    'Generated with it by scripts/make-lesson-video.mjs — edit the slide script',
    'there, not this file. Served from the client bundle, so no request leaves',
    'the origin. Replace per-lesson by setting `captionsUrl`.',
    '',
  ];
  let start = 0;
  for (const slide of SLIDES) {
    for (const [from, to, text] of slide.captions ?? []) {
      lines.push(`${vttTime(start + from)} --> ${vttTime(Math.min(start + to, TOTAL_SECONDS))}`);
      lines.push(text, '');
    }
    start += slide.seconds;
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

function main() {
  const mediaDir = join(root, 'client', 'public', 'media');
  const videoPath = join(mediaDir, 'lesson-sample.mp4');
  const captionsPath = join(root, 'client', 'public', 'captions', 'lesson-sample.en.vtt');
  const workDir = mkdtempSync(join(tmpdir(), 'cadence-slides-'));

  process.stdout.write(`Rendering ${SLIDES.length} slides at ${WIDTH * SCALE}x${HEIGHT * SCALE}\n`);
  try {
    const frames = renderSlides(workDir).map(toYuv420);

    // Each slide is one IDR picture followed by skipped P frames for the rest
    // of its time on screen. frame_num counts reference pictures within the
    // slide and resets at the next IDR; it is 4 bits wide, hence the mask.
    const samples = [];
    const keyframes = [];
    frames.forEach((frame, index) => {
      keyframes.push(samples.length + 1); // stss is 1-based
      samples.push(encodeIdr(frame, index % 2));
      const repeats = SLIDES[index].seconds * FPS - 1;
      for (let n = 1; n <= repeats; n += 1) samples.push(encodeSkippedP(n));
    });
    const durations = samples.map(() => TIMESCALE / FPS);

    mkdirSync(mediaDir, { recursive: true });
    writeFileSync(videoPath, buildMp4(samples, durations, keyframes));
    writeFileSync(captionsPath, buildCaptions());

    const megabytes = (readFileSync(videoPath).length / 1024 / 1024).toFixed(2);
    const minutes = Math.floor(TOTAL_SECONDS / 60);
    const seconds = String(TOTAL_SECONDS % 60).padStart(2, '0');
    process.stdout.write(
      `\nWrote ${videoPath}\n` +
        `  ${WIDTH}x${HEIGHT} · ${FPS} fps · ${TOTAL_SECONDS}s (${minutes}:${seconds}) · ` +
        `${keyframes.length} slides in ${samples.length} frames · ${megabytes} MB\n` +
        `Wrote ${captionsPath}\n\n` +
        `SAMPLE_LESSON_VIDEO.durationSeconds in shared/src/constants.ts must be ` +
        `${TOTAL_SECONDS}; client/src/test/lesson-media.test.ts checks it.\n` +
        `Re-run the seed to point existing lesson rows at this file.\n`,
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main();

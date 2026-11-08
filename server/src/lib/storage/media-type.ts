/**
 * What a file really is.
 *
 * The browser's `Content-Type`, the filename's extension and the
 * `mimeType` in the presign request are all chosen by whoever is
 * uploading. None of them is evidence. The only thing that says what a
 * file actually contains is its content, so every upload is confirmed
 * against its first bytes before it is marked READY and allowed anywhere
 * near a learner.
 *
 * This matters beyond tidiness: a file served back with a type it does not
 * have is how an "image" ends up being parsed as HTML and running script
 * on the site's own origin.
 */

export type DetectedType = {
  mime: string;
  kind: 'VIDEO' | 'IMAGE';
  label: string;
};

/** The formats the platform accepts, and how to recognise each one. */
type Signature = {
  type: DetectedType;
  /** Returns true when the head of the file matches this format. */
  matches(head: Buffer): boolean;
};

/** `ftyp` box brands that mean "this is an MP4 we can play". */
const MP4_BRANDS = ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash'];

const SIGNATURES: Signature[] = [
  {
    // ISO base media: bytes 4..7 are 'ftyp', then a 4-byte brand.
    type: { mime: 'video/mp4', kind: 'VIDEO', label: 'MP4' },
    matches: (head) =>
      head.length >= 12 &&
      head.toString('ascii', 4, 8) === 'ftyp' &&
      MP4_BRANDS.includes(head.toString('ascii', 8, 12).toLowerCase()),
  },
  {
    // WebM is Matroska: the EBML header 1A 45 DF A3.
    type: { mime: 'video/webm', kind: 'VIDEO', label: 'WebM' },
    matches: (head) =>
      head.length >= 4 &&
      head[0] === 0x1a &&
      head[1] === 0x45 &&
      head[2] === 0xdf &&
      head[3] === 0xa3,
  },
  {
    type: { mime: 'image/jpeg', kind: 'IMAGE', label: 'JPEG' },
    matches: (head) => head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  },
  {
    type: { mime: 'image/png', kind: 'IMAGE', label: 'PNG' },
    matches: (head) =>
      head.length >= 8 &&
      head[0] === 0x89 &&
      head.toString('ascii', 1, 4) === 'PNG' &&
      head[4] === 0x0d &&
      head[5] === 0x0a &&
      head[6] === 0x1a &&
      head[7] === 0x0a,
  },
  {
    // RIFF....WEBP
    type: { mime: 'image/webp', kind: 'IMAGE', label: 'WebP' },
    matches: (head) =>
      head.length >= 12 &&
      head.toString('ascii', 0, 4) === 'RIFF' &&
      head.toString('ascii', 8, 12) === 'WEBP',
  },
];

/** The MIME types a client may *ask* for, per kind. */
export const ALLOWED_MIME_TYPES: Record<'VIDEO' | 'IMAGE', string[]> = {
  VIDEO: ['video/mp4', 'video/webm'],
  IMAGE: ['image/jpeg', 'image/png', 'image/webp'],
};

/** Human-readable list for error messages. */
export const ALLOWED_LABELS: Record<'VIDEO' | 'IMAGE', string> = {
  VIDEO: 'MP4 or WebM',
  IMAGE: 'JPG, PNG or WebP',
};

/** Whether a declared MIME type is one we accept for that kind. */
export function isAllowedMimeType(kind: 'VIDEO' | 'IMAGE', mimeType: string): boolean {
  return ALLOWED_MIME_TYPES[kind].includes(mimeType.toLowerCase().split(';')[0]!.trim());
}

/**
 * Identifies a file from its first bytes.
 *
 * Returns `null` for anything unrecognised, which is treated as a failed
 * upload rather than as "probably fine": an allow-list of formats we can
 * actually play or display is the point.
 */
export function detectType(head: Buffer): DetectedType | null {
  for (const signature of SIGNATURES) {
    if (signature.matches(head)) return signature.type;
  }
  return null;
}

/**
 * Confirms that what was stored matches what was promised.
 *
 * `jpeg`/`jpg` are the same thing to the detector, so a client that
 * declared `image/jpeg` and uploaded a JPEG passes. A client that declared
 * `video/mp4` and uploaded an HTML page does not.
 */
export function verifyStoredType(params: {
  kind: 'VIDEO' | 'IMAGE';
  declaredMimeType: string;
  head: Buffer;
}):
  | { ok: true; detected: DetectedType }
  | { ok: false; reason: string; detected: DetectedType | null } {
  const detected = detectType(params.head);

  if (!detected) {
    return {
      ok: false,
      detected: null,
      reason: `This file is not a recognised ${ALLOWED_LABELS[params.kind]} file. Its contents do not match any supported format.`,
    };
  }

  if (detected.kind !== params.kind) {
    return {
      ok: false,
      detected,
      reason: `This is ${articleFor(detected.label)} ${detected.label} file, but ${
        params.kind === 'VIDEO' ? 'a video' : 'an image'
      } was expected.`,
    };
  }

  if (detected.mime !== params.declaredMimeType.toLowerCase().split(';')[0]!.trim()) {
    return {
      ok: false,
      detected,
      reason: `Its contents don't match the declared type. The file is ${articleFor(detected.label)} ${detected.label}.`,
    };
  }

  return { ok: true, detected };
}

function articleFor(label: string): string {
  return /^[AEIOU]/i.test(label) ? 'an' : 'a';
}

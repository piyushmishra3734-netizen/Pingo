/**
 * A QR encoder, written out rather than installed.
 *
 * ## Why not a library
 *
 * Every QR package is a few kilobytes of the same well-specified algorithm, and
 * adding one to render a link to your own profile is a supply-chain decision
 * taken for a convenience. This is that algorithm, scoped to exactly what a
 * profile link needs: byte mode, error correction level M, versions 1 to 6.
 *
 * ## Why it stops at version 6
 *
 * Versions 7 and up carry an extra 18-bit version information block in two
 * corners, which is a table and a second BCH code for no benefit here. Version 6
 * at level M holds 106 bytes; a PINGO profile link is
 * `https://pingochat.pages.dev/profile/` plus a handle of at most 20 characters,
 * which is 55. There is no input this product can produce that needs version 7,
 * and `encodeQr` throws rather than silently truncating if one ever appears.
 *
 * ## Why level M
 *
 * Level M recovers about 15% of a damaged code. On a screen there is no damage,
 * but a phone camera reading at an angle in poor light behaves like one — and M
 * is the level every payment and messaging app settled on for the same reason.
 *
 * The output is a square of booleans. Nothing here knows about SVG, canvas or
 * colour; how it is drawn is the caller's business.
 */

/** Error correction level M, by version: data codewords, EC per block, blocks. */
const LEVEL_M: Record<number, { data: number; ecPerBlock: number; blocks: number }> = {
  1: { data: 16, ecPerBlock: 10, blocks: 1 },
  2: { data: 28, ecPerBlock: 16, blocks: 1 },
  3: { data: 44, ecPerBlock: 26, blocks: 1 },
  4: { data: 64, ecPerBlock: 18, blocks: 2 },
  5: { data: 86, ecPerBlock: 24, blocks: 2 },
  6: { data: 108, ecPerBlock: 16, blocks: 4 },
};

const MAX_VERSION = 6;

// ---------------------------------------------------------------------------
// GF(256)
// ---------------------------------------------------------------------------

/*
 * Reed-Solomon works in a field of 256 elements where addition is XOR and
 * multiplication is addition of logarithms. Building the two tables once turns
 * every later multiply into an array lookup.
 *
 * 0x11D is the primitive polynomial QR specifies. It is not a free choice —
 * decoders assume it.
 */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  // Doubled so an index sum up to 508 needs no modulo on the hot path.
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]!;
}

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/** The generator polynomial for `n` error correction codewords. */
function generatorPoly(n: number): number[] {
  let poly = [1];
  for (let i = 0; i < n; i += 1) {
    // Multiply by (x + α^i).
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ mul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

/** Polynomial long division; the remainder is the error correction block. */
function eccBlock(data: number[], n: number): number[] {
  const gen = generatorPoly(n);
  const buffer = [...data, ...new Array<number>(n).fill(0)];

  for (let i = 0; i < data.length; i += 1) {
    const factor = buffer[i]!;
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j += 1) {
      buffer[i + j] = buffer[i + j]! ^ mul(gen[j]!, factor);
    }
  }

  return buffer.slice(data.length);
}

// ---------------------------------------------------------------------------
// Bitstream
// ---------------------------------------------------------------------------

/**
 * Turns the text into the codeword stream the matrix carries.
 *
 * Byte mode with a UTF-8 payload. Alphanumeric mode would pack a bare domain
 * more tightly, but a profile link contains lowercase letters and a slash, so
 * it would not qualify — and switching modes mid-string to save a version is
 * complexity nobody is asking for.
 */
function encodeData(bytes: Uint8Array, version: number): number[] {
  const { data: capacity } = LEVEL_M[version]!;
  const bits: number[] = [];

  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, 8); // 8-bit count field, correct for versions 1–9
  for (const byte of bytes) push(byte, 8);

  // Terminator: up to four zero bits, or fewer if the capacity ends first.
  const limit = capacity * 8;
  for (let i = 0; i < 4 && bits.length < limit; i += 1) bits.push(0);
  // Pad to a whole codeword.
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j]!;
    codewords.push(byte);
  }

  /*
   * The two pad bytes the specification names, alternating — and the run always
   * *starts* at 0xEC, whatever position in the stream it happens to begin at.
   *
   * Keying the alternation off `codewords.length` instead looks identical and
   * is wrong for every message whose data ends on an odd codeword: the padding
   * comes out inverted, the error correction is computed over it faithfully,
   * and the result is a perfectly well-formed QR code that decodes to garbage.
   */
  const PAD = [0xec, 0x11];
  for (let i = 0; codewords.length < capacity; i += 1) codewords.push(PAD[i % 2]!);

  return codewords;
}

/**
 * Splits into blocks, computes their error correction, and interleaves.
 *
 * Interleaving is what makes the format robust: a scratch across the code
 * damages one codeword from each block rather than destroying one block
 * entirely, and each block can lose several codewords and still be recovered.
 *
 * Versions 1–6 at level M have equally sized blocks, which is why there is no
 * second group here. It is the reason this stops at 6 as much as the version
 * information block is.
 */
function interleave(codewords: number[], version: number): number[] {
  const { ecPerBlock, blocks } = LEVEL_M[version]!;
  const perBlock = codewords.length / blocks;

  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  for (let i = 0; i < blocks; i += 1) {
    const block = codewords.slice(i * perBlock, (i + 1) * perBlock);
    dataBlocks.push(block);
    ecBlocks.push(eccBlock(block, ecPerBlock));
  }

  const out: number[] = [];
  for (let i = 0; i < perBlock; i += 1) for (const block of dataBlocks) out.push(block[i]!);
  for (let i = 0; i < ecPerBlock; i += 1) for (const block of ecBlocks) out.push(block[i]!);
  return out;
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

type Grid = boolean[][];

function blankGrid(size: number): Grid {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
}

/** The three corner squares, their separators, timing lines and alignment. */
function drawFunctionPatterns(modules: Grid, reserved: Grid, version: number): void {
  const size = modules.length;

  const finder = (top: number, left: number) => {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const py = top + y;
        const px = left + x;
        if (py < 0 || py >= size || px < 0 || px >= size) continue;
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        // Ring 2 and 4 are the white gaps; everything else in the 7×7 is dark.
        modules[py]![px] = ring !== 2 && ring !== 4;
        reserved[py]![px] = true;
      }
    }
  };

  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Timing: alternating modules along row 6 and column 6, joining the finders.
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    modules[6]![i] = dark;
    reserved[6]![i] = true;
    modules[i]![6] = dark;
    reserved[i]![6] = true;
  }

  /*
   * One alignment pattern, at the bottom right.
   *
   * Versions 2–6 place their centres at row/column 6 and `size - 7`. Three of
   * the four combinations sit under a finder pattern and are omitted by the
   * specification, so exactly one is ever drawn — which is why there is no
   * table of centres here.
   */
  if (version >= 2) {
    const centre = size - 7;
    for (let y = -2; y <= 2; y += 1) {
      for (let x = -2; x <= 2; x += 1) {
        modules[centre + y]![centre + x] = Math.max(Math.abs(x), Math.abs(y)) !== 1;
        reserved[centre + y]![centre + x] = true;
      }
    }
  }

  // The one module that is always dark, just above the bottom-left finder.
  modules[size - 8]![8] = true;
  reserved[size - 8]![8] = true;

  // Format information areas: written per mask, reserved from data now.
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      reserved[8]![i] = true;
      reserved[i]![8] = true;
    }
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8]![size - 1 - i] = true;
    reserved[size - 1 - i]![8] = true;
  }
}

/**
 * The 15-bit format field: two bits of error correction level, three of mask,
 * ten of BCH, all XORed with a constant so an all-zero field is impossible.
 */
function formatBits(mask: number): number {
  // 0b00 is level M.
  const data = (0b00 << 3) | mask;
  let bch = data << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if (bch & (1 << (i + 10))) bch ^= 0b10100110111 << i;
  }
  return ((data << 10) | bch) ^ 0b101010000010010;
}

function drawFormat(modules: Grid, mask: number): void {
  const size = modules.length;
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >> i) & 1) === 1;

  /*
   * The field is written twice, in two corners, so losing one corner is
   * survivable. These positions are given by the specification and are not
   * symmetric — the first copy runs *down* column 8 for the low bits and
   * *along* row 8 for the high ones, turning the corner at the middle. Writing
   * it transposed produces a code that is correct in every other respect and
   * scans as nothing at all.
   */
  for (let i = 0; i <= 5; i += 1) modules[i]![8] = bit(i);
  modules[7]![8] = bit(6);
  modules[8]![8] = bit(7);
  modules[8]![7] = bit(8);
  for (let i = 9; i <= 14; i += 1) modules[8]![14 - i] = bit(i);

  for (let i = 0; i <= 7; i += 1) modules[8]![size - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i += 1) modules[size - 15 + i]![8] = bit(i);
}

/** The zigzag: two columns at a time, right to left, alternating direction. */
function placeData(modules: Grid, reserved: Grid, codewords: number[]): void {
  const size = modules.length;
  let index = 0;

  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing line; the pair steps over it.
    if (right === 6) right = 5;

    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let across = 0; across < 2; across += 1) {
        const x = right - across;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;

        if (reserved[y]![x]) continue;

        // Running past the end pads with light modules, which is what the
        // remainder bits of an under-filled version are defined to be.
        const bit = index < codewords.length * 8;
        if (bit) {
          const byte = codewords[index >> 3]!;
          modules[y]![x] = ((byte >> (7 - (index & 7))) & 1) === 1;
        }
        index += 1;
      }
    }
  }
}

const MASKS: ((y: number, x: number) => boolean)[] = [
  (y, x) => (y + x) % 2 === 0,
  (y) => y % 2 === 0,
  (_y, x) => x % 3 === 0,
  (y, x) => (y + x) % 3 === 0,
  (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (y, x) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (y, x) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
  (y, x) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
];

/**
 * How bad a masked code looks to a decoder.
 *
 * The four rules penalise the things that confuse a scanner: long same-coloured
 * runs, solid blocks, anything resembling a finder pattern, and an overall
 * balance far from half dark. The mask with the lowest score wins.
 */
function penalty(modules: Grid): number {
  const size = modules.length;
  let score = 0;

  // Rule 1 — runs of five or more.
  const scoreLine = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i < size; i += 1) {
      if (get(i) === get(i - 1)) {
        run += 1;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else {
        run = 1;
      }
    }
  };
  for (let y = 0; y < size; y += 1) scoreLine((x) => modules[y]![x]!);
  for (let x = 0; x < size; x += 1) scoreLine((y) => modules[y]![x]!);

  // Rule 2 — 2×2 blocks of one colour.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const a = modules[y]![x];
      if (a === modules[y]![x + 1] && a === modules[y + 1]![x] && a === modules[y + 1]![x + 1]) {
        score += 3;
      }
    }
  }

  // Rule 3 — the finder-like 1:1:3:1:1 sequence with four light modules beside it.
  const FINDER = [true, false, true, true, true, false, true];
  const matches = (get: (i: number) => boolean, at: number): boolean => {
    for (let i = 0; i < 7; i += 1) if (get(at + i) !== FINDER[i]) return false;
    return true;
  };
  const clear = (get: (i: number) => boolean, from: number, to: number): boolean => {
    for (let i = from; i < to; i += 1) {
      if (i >= 0 && i < size && get(i)) return false;
    }
    return true;
  };

  const scoreFinders = (get: (i: number) => boolean) => {
    for (let i = 0; i + 7 <= size; i += 1) {
      if (!matches(get, i)) continue;
      /*
       * Each clear side scores separately, so a sequence with four light
       * modules on *both* sides is penalised twice. That is what the rule says
       * and it matters: such a run is the thing most likely to be mistaken for
       * a finder pattern, and scoring it the same as a one-sided run is exactly
       * the case the rule exists to catch.
       */
      if (clear(get, i - 4, i)) score += 40;
      if (clear(get, i + 7, i + 11)) score += 40;
    }
  };
  for (let y = 0; y < size; y += 1) scoreFinders((x) => modules[y]![x]!);
  for (let x = 0; x < size; x += 1) scoreFinders((y) => modules[y]![x]!);

  // Rule 4 — how far the proportion of dark modules is from half.
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark += 1;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Encodes `text` and returns the module grid, `true` meaning dark.
 *
 * The quiet zone is not included — it is four modules of background on every
 * side, and whether that is margin, padding or nothing at all is a rendering
 * decision the caller owns.
 *
 * @throws when the text is longer than version 6 at level M can carry, which is
 * 106 bytes. Nothing in PINGO can reach it; throwing rather than truncating
 * means a future caller finds out at once instead of shipping a code that scans
 * to half a URL.
 */
export function encodeQr(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);

  let version = 0;
  for (let candidate = 1; candidate <= MAX_VERSION; candidate += 1) {
    // 12 bits of header, so the payload has to fit in what remains.
    if (bytes.length * 8 + 12 <= LEVEL_M[candidate]!.data * 8) {
      version = candidate;
      break;
    }
  }
  if (version === 0) {
    throw new Error(`QR payload of ${bytes.length} bytes exceeds version 6 at level M`);
  }

  const codewords = interleave(encodeData(bytes, version), version);
  const size = 17 + 4 * version;

  const base = blankGrid(size);
  const reserved = blankGrid(size);
  drawFunctionPatterns(base, reserved, version);
  placeData(base, reserved, codewords);

  /*
   * All eight masks, scored, best kept. Trying one and hoping is the usual
   * shortcut and it is a real risk: a code whose data happens to produce long
   * dark runs under the chosen mask can fail to scan on a cheap camera, and it
   * would fail for exactly one username in a thousand — the kind of bug that is
   * never reproducible.
   */
  let best: Grid | undefined;
  let bestScore = Infinity;

  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = base.map((row) => [...row]);
    const rule = MASKS[mask]!;

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (!reserved[y]![x] && rule(y, x)) candidate[y]![x] = !candidate[y]![x];
      }
    }
    drawFormat(candidate, mask);

    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best!;
}

/**
 * The grid as one SVG path, which is what makes it cheap to render.
 *
 * One `<path>` of a few hundred rectangles beats a few hundred `<rect>`
 * elements: same picture, one node instead of hundreds, and it scales to any
 * size without resampling the way a canvas would.
 */
export function qrPath(modules: boolean[][]): string {
  const parts: string[] = [];
  for (let y = 0; y < modules.length; y += 1) {
    for (let x = 0; x < modules.length; x += 1) {
      if (modules[y]![x]) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return parts.join('');
}

/**
 * Pure TypeScript Synchronous SHA-256 (FIPS 180-4)
 *
 * Provides synchronous hashing for local transactions and database state
 * transitions without WebCrypto async promises. Zero external dependencies.
 */

function findFirstPrimes(count: number): number[] {
  const result: number[] = [];
  let candidate = 2;
  while (result.length < count) {
    let prime = true;
    for (let factor = 2; factor * factor <= candidate; factor++) {
      if (candidate % factor === 0) {
        prime = false;
        break;
      }
    }
    if (prime) {
      result.push(candidate);
    }
    candidate++;
  }
  return result;
}

const PRIMES_64 = findFirstPrimes(64);

// Round constants K: first 32 bits of fractional parts of cube roots of first 64 primes
const ROUND_CONSTANTS = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  const p = PRIMES_64[i]!;
  const cbrt = Math.cbrt(p);
  const frac = cbrt - Math.floor(cbrt);
  ROUND_CONSTANTS[i] = (frac * 4294967296) >>> 0;
}

// Initial state H: first 32 bits of fractional parts of square roots of first 8 primes
const INITIAL_HASH = new Uint32Array(8);
for (let i = 0; i < 8; i++) {
  const p = PRIMES_64[i]!;
  const sqrt = Math.sqrt(p);
  const frac = sqrt - Math.floor(sqrt);
  INITIAL_HASH[i] = (frac * 4294967296) >>> 0;
}

const encoder = new TextEncoder();
const HEX_BYTE_MAP: readonly string[] = Array.from({ length: 256 }, (_, index) =>
  index.toString(16).padStart(2, "0")
);

function rotateRight(wordValue: number, bits: number): number {
  return (wordValue >>> bits) | (wordValue << (32 - bits));
}

/**
 * Computes synchronous SHA-256 digest returning 32-byte Uint8Array.
 */
export function sha256(data: Uint8Array | string): Uint8Array {
  const inputBytes = typeof data === "string" ? encoder.encode(data) : data;
  const originalLength = inputBytes.length;

  const totalBits = originalLength * 8;
  const bitLengthHigh = Math.floor(originalLength / 0x20000000);
  const bitLengthLow = (totalBits >>> 0);

  // Pad to multiple of 64 bytes: original + 1 (0x80) + padding zeroes + 8 (length)
  const paddedLength = (originalLength + 9 + 63) & ~63;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(inputBytes, 0);
  buffer[originalLength] = 0x80;

  const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  dataView.setUint32(paddedLength - 8, bitLengthHigh, false);
  dataView.setUint32(paddedLength - 4, bitLengthLow, false);

  let state0 = INITIAL_HASH[0]!;
  let state1 = INITIAL_HASH[1]!;
  let state2 = INITIAL_HASH[2]!;
  let state3 = INITIAL_HASH[3]!;
  let state4 = INITIAL_HASH[4]!;
  let state5 = INITIAL_HASH[5]!;
  let state6 = INITIAL_HASH[6]!;
  let state7 = INITIAL_HASH[7]!;

  const schedule = new Uint32Array(64);

  for (let chunkOffset = 0; chunkOffset < paddedLength; chunkOffset += 64) {
    for (let t = 0; t < 16; t++) {
      schedule[t] = dataView.getUint32(chunkOffset + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const prev15 = schedule[t - 15]!;
      const prev2 = schedule[t - 2]!;
      const sigma0 = rotateRight(prev15, 7) ^ rotateRight(prev15, 18) ^ (prev15 >>> 3);
      const sigma1 = rotateRight(prev2, 17) ^ rotateRight(prev2, 19) ^ (prev2 >>> 10);
      schedule[t] = ((schedule[t - 16]! + sigma0 + schedule[t - 7]! + sigma1) >>> 0);
    }

    let a = state0;
    let b = state1;
    let c = state2;
    let d = state3;
    let e = state4;
    let f = state5;
    let g = state6;
    let h = state7;

    for (let t = 0; t < 64; t++) {
      const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const roundK = ROUND_CONSTANTS[t]!;
      const word = schedule[t]!;
      const compressionTerm1 = (h + bigSigma1 + choice + roundK + word) >>> 0;

      const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const compressionTerm2 = (bigSigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + compressionTerm1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (compressionTerm1 + compressionTerm2) >>> 0;
    }

    state0 = (state0 + a) >>> 0;
    state1 = (state1 + b) >>> 0;
    state2 = (state2 + c) >>> 0;
    state3 = (state3 + d) >>> 0;
    state4 = (state4 + e) >>> 0;
    state5 = (state5 + f) >>> 0;
    state6 = (state6 + g) >>> 0;
    state7 = (state7 + h) >>> 0;
  }

  const result = new Uint8Array(32);
  const resultView = new DataView(result.buffer);
  resultView.setUint32(0, state0, false);
  resultView.setUint32(4, state1, false);
  resultView.setUint32(8, state2, false);
  resultView.setUint32(12, state3, false);
  resultView.setUint32(16, state4, false);
  resultView.setUint32(20, state5, false);
  resultView.setUint32(24, state6, false);
  resultView.setUint32(28, state7, false);
  return result;
}

/**
 * Computes synchronous SHA-256 digest returning 64-character lowercase hex string.
 */
export function sha256Hex(data: Uint8Array | string): string {
  const digestBytes = sha256(data);
  let hexString = "";
  for (let i = 0; i < 32; i++) {
    const byteValue = digestBytes[i]!;
    hexString += HEX_BYTE_MAP[byteValue]!;
  }
  return hexString;
}

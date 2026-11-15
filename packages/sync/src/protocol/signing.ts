/**
 * D-147 WebCrypto Signing, Verification & Non-Extractable Key Storage
 * (Gate 33 / T-33.3 / D-147 / HAA-16)
 *
 * Implements mandatory ECDSA P-256 (raw IEEE P1363 64-byte signatures) and optional
 * Ed25519 signing. Non-extractable private keys (extractable === false) are persisted
 * via IndexedDB structured clone.
 */

import type { SigningAlgorithm } from "./types.js";
export * from "./preverify.js";

const encoder = new TextEncoder();
const HEX_BYTE_TABLE: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0")
);

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.trim();
  const len = cleanHex.length;
  if (len % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${len}`);
  }
  const bytes = new Uint8Array(len / 2);
  for (let i = 0; i < len; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    const byteValue = bytes[i];
    if (byteValue !== undefined) {
      hex += HEX_BYTE_TABLE[byteValue]!;
    }
  }
  return hex;
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto SubtleCrypto is not available in the current environment");
  }
  return subtle;
}

export interface LocalKeyPair {
  readonly publicKeyHex: string;
  readonly privateKeyHex?: string | undefined;
  readonly publicKey: CryptoKey;
  readonly privateKey: CryptoKey;
  readonly algorithm: SigningAlgorithm;
}

export type GeneratedKeyPair = LocalKeyPair;

/**
 * Generates an asymmetric signing key pair.
 * By default, privateKey has extractable = false per D-147 (never exportable).
 */
export async function generateSigningKeyPair(
  alg: SigningAlgorithm = "ECDSA_P256",
  extractable: boolean = false
): Promise<LocalKeyPair> {
  const subtle = getSubtle();

  if (alg === "Ed25519") {
    try {
      const keyPair = (await subtle.generateKey({ name: "Ed25519" }, extractable, [
        "sign",
        "verify",
      ])) as CryptoKeyPair;
      const pubRaw = await subtle.exportKey("raw", keyPair.publicKey);
      let privPkcs8Hex: string | undefined = undefined;
      if (extractable) {
        const privPkcs8 = await subtle.exportKey("pkcs8", keyPair.privateKey);
        privPkcs8Hex = bytesToHex(new Uint8Array(privPkcs8));
      }
      return {
        algorithm: "Ed25519",
        publicKeyHex: bytesToHex(new Uint8Array(pubRaw)),
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey,
        privateKeyHex: privPkcs8Hex,
      };
    } catch {
      // Fallback to mandatory ECDSA P-256
      return generateSigningKeyPair("ECDSA_P256", extractable);
    }
  }

  // Mandatory: ECDSA P-256 (raw P1363)
  const keyPair = (await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    extractable,
    ["sign", "verify"]
  )) as CryptoKeyPair;

  const pubRaw = await subtle.exportKey("raw", keyPair.publicKey);
  let privPkcs8Hex: string | undefined = undefined;
  if (extractable) {
    const privPkcs8 = await subtle.exportKey("pkcs8", keyPair.privateKey);
    privPkcs8Hex = bytesToHex(new Uint8Array(privPkcs8));
  }

  return {
    algorithm: "ECDSA_P256",
    publicKeyHex: bytesToHex(new Uint8Array(pubRaw)),
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    privateKeyHex: privPkcs8Hex,
  };
}

/**
 * Signs a UTF-8 payload using a CryptoKey or private key hex string.
 * Supports non-extractable CryptoKey (extractable === false).
 */
export async function signPayloadAsync(
  signingPayloadUtf8: string,
  privateKey: CryptoKey | string,
  alg: SigningAlgorithm = "ECDSA_P256"
): Promise<string> {
  const subtle = getSubtle();
  const payloadBytes = encoder.encode(signingPayloadUtf8);

  let keyObj: CryptoKey;
  if (typeof privateKey === "string") {
    const privBytes = hexToBytes(privateKey);
    if (alg === "Ed25519") {
      keyObj = await subtle.importKey("pkcs8", privBytes.buffer as ArrayBuffer, { name: "Ed25519" }, false, ["sign"]);
    } else {
      keyObj = await subtle.importKey(
        "pkcs8",
        privBytes.buffer as ArrayBuffer,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"]
      );
    }
  } else {
    keyObj = privateKey;
  }

  let sigBuffer: ArrayBuffer;
  if (alg === "Ed25519") {
    sigBuffer = await subtle.sign({ name: "Ed25519" }, keyObj, payloadBytes.buffer as ArrayBuffer);
  } else {
    sigBuffer = await subtle.sign(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      keyObj,
      payloadBytes.buffer as ArrayBuffer
    );
  }

  return bytesToHex(new Uint8Array(sigBuffer));
}

/**
 * Verifies a signature against a public key (CryptoKey or raw hex).
 */
export async function verifySignatureAsync(
  signingPayloadUtf8: string,
  sigHex: string,
  publicKey: CryptoKey | string,
  alg: SigningAlgorithm = "ECDSA_P256"
): Promise<boolean> {
  const subtle = getSubtle();
  try {
    const payloadBytes = encoder.encode(signingPayloadUtf8);
    const sigBytes = hexToBytes(sigHex);

    let pubKeyObj: CryptoKey;
    if (typeof publicKey === "string") {
      const pubBytes = hexToBytes(publicKey);
      if (alg === "Ed25519") {
        pubKeyObj = await subtle.importKey("raw", pubBytes.buffer as ArrayBuffer, { name: "Ed25519" }, false, [
          "verify",
        ]);
      } else {
        pubKeyObj = await subtle.importKey(
          "raw",
          pubBytes.buffer as ArrayBuffer,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"]
        );
      }
    } else {
      pubKeyObj = publicKey;
    }

    if (alg === "Ed25519") {
      return await subtle.verify({ name: "Ed25519" }, pubKeyObj, sigBytes.buffer as ArrayBuffer, payloadBytes.buffer as ArrayBuffer);
    }

    return await subtle.verify(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      pubKeyObj,
      sigBytes.buffer as ArrayBuffer,
      payloadBytes.buffer as ArrayBuffer
    );
  } catch {
    return false;
  }
}

/**
 * Safely clones a non-extractable CryptoKey via structured clone (for IDB persistence).
 */
export function cloneNonExtractableKey(key: CryptoKey): CryptoKey {
  return structuredClone(key);
}


// Ed25519 signatures over canonical JSON with Web Crypto: browsers, Workers, Node ≥ 22.
// Use these where node:crypto isn't available. Signatures are interchangeable with the node:crypto
// helpers in signing.ts and attestation.ts (same canonical bytes, same algorithm, base64url).
import { canonicalBytes } from "./canonical.ts";

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function pemBody(pem: string, label: string): Uint8Array<ArrayBuffer> {
  const m = pem.match(new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`));
  if (!m) throw new Error(`expected a PEM ${label}`);
  return b64urlDecode(m[1].replace(/\s+/g, "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
}

export async function importEd25519PrivateKey(pkcs8Pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", pemBody(pkcs8Pem, "PRIVATE KEY"), { name: "Ed25519" }, false, ["sign"]);
}

export async function importEd25519PublicKey(spkiPem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", pemBody(spkiPem, "PUBLIC KEY"), { name: "Ed25519" }, false, ["verify"]);
}

/** base64url Ed25519 signature over canonicalJSON(value). */
export async function signCanonicalWeb(value: unknown, privateKey: CryptoKey): Promise<string> {
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, canonicalBytes(value));
  return b64urlEncode(new Uint8Array(sig));
}

export async function verifyCanonicalWeb(value: unknown, signature: string, publicKey: CryptoKey): Promise<boolean> {
  try {
    return await crypto.subtle.verify({ name: "Ed25519" }, publicKey, b64urlDecode(signature), canonicalBytes(value));
  } catch {
    return false;
  }
}

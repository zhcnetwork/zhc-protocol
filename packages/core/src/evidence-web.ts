// Evidence hash chain with Web Crypto: browsers, Cloudflare Workers, Deno, and Node ≥ 20.
// Same canonical form and SHA-256 as evidence.ts, so hashes are byte-identical. The chain functions
// work on any sealed record (`Sealable`), not only ZHC events.
import { canonicalJSON } from "./canonical.ts";
import type { EvidenceHead, Sealable } from "./types.ts";

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256HexWeb(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** sha256 of the canonical record without its own `hash`. */
export async function hashEventWeb(e: Sealable): Promise<string> {
  const { hash: _ignored, ...rest } = e;
  return sha256HexWeb(canonicalJSON(rest));
}

/** Append a record to a chain: sets `prev` and `hash`. */
export async function sealWeb<E extends Sealable>(event: E, prevHash: string | undefined): Promise<E> {
  const withPrev = { ...event, prev: prevHash } as E;
  return { ...withPrev, hash: await hashEventWeb(withPrev) };
}

/**
 * Verify a chain from its first record, or a segment of one that continues from `from`, a head you
 * already hold (the segment's first record must point at it).
 */
export async function verifyChainWeb(events: Sealable[], from?: string): Promise<{ ok: boolean; head?: string; brokenAt?: number; reason?: string }> {
  let prev: string | undefined = from;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.prev !== prev) return { ok: false, brokenAt: i, reason: "prev hash mismatch" };
    if (e.hash !== (await hashEventWeb(e))) return { ok: false, brokenAt: i, reason: "event hash mismatch" };
    prev = e.hash;
  }
  return { ok: true, head: prev };
}

/**
 * True when a log (verified separately) still contains a head published earlier at the same
 * position: it extends that head rather than rewriting it (PROTOCOL §4.2, §6.1).
 */
export function extendsHead(events: Sealable[], held: { head: string; events: number }): boolean {
  return Number.isInteger(held.events) && held.events >= 1 && events.length >= held.events && events[held.events - 1].hash === held.head;
}

/** Why a head statement is malformed, or undefined if it is well-formed (signature not checked). */
export function headPayloadProblem(p: EvidenceHead | undefined): string | undefined {
  if (!p || p.type !== "ZHEvidenceHead" || p.spec !== "0.2") return "not a v0.2 evidence head";
  if (!/^[0-9a-f]{64}$/.test(p.head) || !Number.isInteger(p.events) || p.events < 1 || !Number.isFinite(Date.parse(p.at))) return "malformed head";
  return undefined;
}

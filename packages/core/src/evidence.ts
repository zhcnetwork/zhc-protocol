// Evidence log: append-only, hash-chained ZHC events. Node only (uses node:crypto).
// evidence-web.ts implements the same chain with Web Crypto for browsers and Workers;
// both produce byte-identical hashes (test/crypto.test.ts).
//
// What a valid chain proves, and what it doesn't (PROTOCOL §4.2): it proves the events are
// internally consistent and unedited since the head you hold was computed. It does not prove the
// events happened, that none were left out, or that timestamps are honest.
import { createHash } from "node:crypto";
import { canonicalJSON } from "./canonical.ts";
import type { Sealable, ZHCEvent } from "./types.ts";

export { canonicalJSON } from "./canonical.ts";

/** sha256 of the canonical record without its own `hash`. Works on any sealed record, not only events. */
export function hashEvent(e: Sealable): string {
  const { hash: _ignored, ...rest } = e;
  return createHash("sha256").update(canonicalJSON(rest)).digest("hex");
}

/** Append a record to a chain: sets `prev` and `hash`. Returns the sealed record. */
export function seal<E extends Sealable>(event: E, prevHash: string | undefined): E {
  const withPrev = { ...event, prev: prevHash } as E;
  return { ...withPrev, hash: hashEvent(withPrev) };
}

/** Verify a chain from its first record, or a segment that continues from `from`, a head you already hold. */
export function verifyChain(events: Sealable[], from?: string): { ok: boolean; head?: string; brokenAt?: number; reason?: string } {
  let prev: string | undefined = from;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.prev !== prev) return { ok: false, brokenAt: i, reason: "prev hash mismatch" };
    if (e.hash !== hashEvent(e)) return { ok: false, brokenAt: i, reason: "event hash mismatch" };
    prev = e.hash;
  }
  return { ok: true, head: prev };
}

export function parseJSONL(text: string): ZHCEvent[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ZHCEvent);
}

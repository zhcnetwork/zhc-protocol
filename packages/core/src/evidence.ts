// Evidence log: append-only, hash-chained ZHC events. Node only (uses node:crypto).
import { createHash } from "node:crypto";
import type { ZHCEvent } from "./types.ts";

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`).join(",")}}`;
}

export function hashEvent(e: ZHCEvent): string {
  const { hash: _ignored, ...rest } = e;
  return createHash("sha256").update(canonicalJSON(rest)).digest("hex");
}

/** Append an event to a chain: sets `prev` and `hash`. Returns the sealed event. */
export function seal<E extends ZHCEvent>(event: E, prevHash: string | undefined): E {
  const withPrev = { ...event, prev: prevHash } as E;
  return { ...withPrev, hash: hashEvent(withPrev) };
}

export function verifyChain(events: ZHCEvent[]): { ok: boolean; head?: string; brokenAt?: number; reason?: string } {
  let prev: string | undefined;
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

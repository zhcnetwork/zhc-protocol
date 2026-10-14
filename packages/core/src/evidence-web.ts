// Evidence hash chain with Web Crypto: browsers, Cloudflare Workers, Deno, and Node ≥ 20.
// Same canonical form and SHA-256 as evidence.ts, so hashes are byte-identical.
import { canonicalJSON } from "./canonical.ts";
import type { ZHCEvent } from "./types.ts";

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256HexWeb(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export async function hashEventWeb(e: ZHCEvent): Promise<string> {
  const { hash: _ignored, ...rest } = e;
  return sha256HexWeb(canonicalJSON(rest));
}

export async function sealWeb<E extends ZHCEvent>(event: E, prevHash: string | undefined): Promise<E> {
  const withPrev = { ...event, prev: prevHash } as E;
  return { ...withPrev, hash: await hashEventWeb(withPrev) };
}

export async function verifyChainWeb(events: ZHCEvent[]): Promise<{ ok: boolean; head?: string; brokenAt?: number; reason?: string }> {
  let prev: string | undefined;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.prev !== prev) return { ok: false, brokenAt: i, reason: "prev hash mismatch" };
    if (e.hash !== (await hashEventWeb(e))) return { ok: false, brokenAt: i, reason: "event hash mismatch" };
    prev = e.hash;
  }
  return { ok: true, head: prev };
}

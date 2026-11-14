import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import { checkPasscode, json } from "../lib/http.mts";

const MAX_BYTES = 2_000_000;
const MAX_WAITING = 20;
// The helper on the seller's computer checks in about once a minute while it is awake.
const HELPER_FRESH_MS = 5 * 60_000;

function queue() {
  return getStore({ name: "print-queue", consistency: "strong" });
}

/**
 * A small print queue. The phone posts a PDF to /api/print; a helper on the seller's
 * computer asks /api/print/next for the oldest waiting file and sends it to the printer.
 * Both ends must present the site passcode, since this puts paper through a real printer.
 */
export default async (req: Request): Promise<Response> => {
  if (!Netlify.env.get("APP_PASSCODE")) {
    return json({ queued: false, message: "Printing through the computer is off until a passcode is set for this site." });
  }
  const denied = checkPasscode(req);
  if (denied) return denied;

  const store = queue();
  const { blobs } = await store.list({ prefix: "job/" });
  const waiting = blobs.map((blob) => blob.key).sort();

  if (new URL(req.url).pathname.endsWith("/next")) {
    await store.setJSON("helper-seen", { at: Date.now() });
    const key = waiting[0];
    if (!key) return new Response(null, { status: 204 });
    const pdf = await store.get(key, { type: "arrayBuffer" });
    await store.delete(key);
    if (pdf === null) return new Response(null, { status: 204 });
    return new Response(pdf, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
  }

  // Only queue a sheet when something is there to print it; otherwise the phone prints it.
  const seen = (await store.get("helper-seen", { type: "json" })) as { at?: number } | null;
  if (!seen?.at || Date.now() - seen.at > HELPER_FRESH_MS) {
    return json({ queued: false, message: "The print helper on your computer is not running, so use the phone's print screen instead." });
  }
  if (waiting.length >= MAX_WAITING) {
    return json({ queued: false, message: "Too many sheets are already waiting to print." });
  }

  let payload: { pdf?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad_request", message: "Request body must be JSON." }, 400);
  }
  const bytes = typeof payload.pdf === "string" ? Buffer.from(payload.pdf, "base64") : null;
  if (!bytes || bytes.length > MAX_BYTES || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return json({ error: "bad_request", message: "That is not a PDF." }, 400);
  }
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  // Keys sort by time, so the oldest sheet prints first.
  await store.set(`job/${Date.now()}-${randomUUID()}.pdf`, body);
  return json({ queued: true, message: null });
};

export const config: Config = {
  path: ["/api/print", "/api/print/next"],
  method: "POST",
};

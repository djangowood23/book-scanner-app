import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { checkPasscode, json } from "../lib/http.mts";

// One row per book: [sku, title, author, media, image, language].
type Row = [string, string, string, string, string, string];
type Has = Record<"title" | "author" | "media" | "image" | "language", boolean>;
type Meta = { updated_at: string; loaded_at: string; count: number; has: Has };
type Snapshot = Meta & { rows: Row[] };

const MAX_ROWS = 60_000;
const IMAGE = 4;
const LANGUAGE = 5;

function store() {
  return getStore({ name: "inventory", consistency: "strong" });
}

function isRow(value: unknown): value is Row {
  return Array.isArray(value) && value.length === 6 && value.every((cell) => typeof cell === "string") && value[0] !== "";
}

/**
 * The seller's AOB inventory, kept once on the server so every device checks SKUs
 * against the same copy.
 *
 *   GET  /api/inventory/meta   when the snapshot was loaded and last changed
 *   GET  /api/inventory        the whole snapshot
 *   POST /api/inventory        replace it (after loading a new AOB export)
 *   POST /api/inventory/patch  record new images and languages for books just fixed
 *
 * `loaded_at` is when an export was last loaded; `updated_at` also moves on a patch, and
 * is what devices compare to decide whether to download again.
 */
export default async (req: Request): Promise<Response> => {
  if (!Netlify.env.get("APP_PASSCODE")) {
    return json({ error: "off", message: "The shared inventory is off until a passcode is set for this site." }, 403);
  }
  const denied = checkPasscode(req);
  if (denied) return denied;

  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const blobs = store();

  if (req.method === "GET") {
    if (path.endsWith("/meta")) {
      return json({ meta: (await blobs.get("meta", { type: "json" })) as Meta | null });
    }
    return json({ snapshot: (await blobs.get("snapshot", { type: "json" })) as Snapshot | null });
  }

  let payload: { rows?: unknown; has?: unknown; updates?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad_request", message: "Request body must be JSON." }, 400);
  }
  const now = new Date().toISOString();

  if (path.endsWith("/patch")) {
    const updates = Array.isArray(payload.updates) ? payload.updates : [];
    const snapshot = (await blobs.get("snapshot", { type: "json" })) as Snapshot | null;
    if (!snapshot) return json({ meta: null });
    const bySku = new Map(snapshot.rows.map((row) => [row[0], row]));
    let changed = 0;
    for (const update of updates as { sku?: unknown; image?: unknown; language?: unknown }[]) {
      const row = typeof update?.sku === "string" ? bySku.get(update.sku) : undefined;
      if (!row) continue;
      if (typeof update.image === "string" && update.image) { row[IMAGE] = update.image.slice(0, 400); changed++; }
      if (typeof update.language === "string" && update.language) { row[LANGUAGE] = update.language.slice(0, 40); changed++; }
    }
    if (changed === 0) return json({ meta: { ...snapshot, rows: undefined } });
    snapshot.updated_at = now;
    const meta: Meta = { updated_at: now, loaded_at: snapshot.loaded_at, count: snapshot.count, has: snapshot.has };
    await blobs.setJSON("snapshot", snapshot);
    await blobs.setJSON("meta", meta);
    return json({ meta });
  }

  const rows = Array.isArray(payload.rows) ? payload.rows : null;
  if (!rows || rows.length === 0 || rows.length > MAX_ROWS || !rows.every(isRow)) {
    return json({ error: "bad_request", message: "That is not an inventory." }, 400);
  }
  const given = (payload.has ?? {}) as Partial<Has>;
  const has: Has = {
    title: given.title === true,
    author: given.author === true,
    media: given.media === true,
    image: given.image === true,
    language: given.language === true,
  };
  const meta: Meta = { updated_at: now, loaded_at: now, count: rows.length, has };
  await blobs.setJSON("snapshot", { ...meta, rows });
  await blobs.setJSON("meta", meta);
  return json({ meta });
};

export const config: Config = {
  path: ["/api/inventory", "/api/inventory/meta", "/api/inventory/patch"],
  method: ["GET", "POST"],
};

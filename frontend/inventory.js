// The shared inventory snapshot: kept on the server for every device, cached on this
// one in IndexedDB so the Shelve page can check SKUs with no connection.

import { packInventory, unpackInventory } from './lib.js';

const DB = 'bookscanner';
const STORE = 'kv';
const KEY = 'inventory';

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idb(mode, work) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** A snapshot is { updated_at, loaded_at, count, has, rows }. */
function toInventory(snapshot) {
  if (!snapshot?.rows) return null;
  const { rows, ...meta } = snapshot;
  return { meta, has: snapshot.has ?? {}, records: unpackInventory(rows) };
}

/** The copy cached on this device, or null. Never throws. */
export async function loadCachedInventory() {
  try {
    return toInventory(await idb('readonly', (store) => store.get(KEY)));
  } catch {
    return null;
  }
}

async function cache(snapshot) {
  try {
    await idb('readwrite', (store) => store.put(snapshot, KEY));
  } catch {
    // Without a cache the inventory still works for this visit.
  }
}

export class PasscodeNeeded extends Error {}

async function call(path, passcode, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-app-passcode': passcode ?? '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) throw new PasscodeNeeded();
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.message ?? `The server returned an error (${response.status}).`);
  return data;
}

/**
 * Bring this device's copy up to date with the server's. Returns the inventory to use
 * (the fresh one, or `current` if nothing changed), or null if the server has none.
 * Throws PasscodeNeeded, or an Error when the server cannot be reached.
 */
export async function syncInventory(passcode, current) {
  const { meta } = await call('/api/inventory/meta', passcode);
  if (!meta) return current ?? null;
  if (current?.meta?.updated_at === meta.updated_at) return current;
  const { snapshot } = await call('/api/inventory', passcode);
  if (!snapshot) return current ?? null;
  await cache(snapshot);
  return toInventory(snapshot);
}

/** Replace the shared inventory with a newly loaded export. Returns the inventory to use. */
export async function uploadInventory(records, has, passcode) {
  const rows = packInventory(records);
  const { meta } = await call('/api/inventory', passcode, { rows, has });
  const snapshot = { ...meta, rows };
  await cache(snapshot);
  return toInventory(snapshot);
}

/**
 * Record the images and languages just sent to AOB, on the server and in this device's
 * copy, so the same book is not fixed twice. `updates` is [{ sku, image?, language? }].
 * The in-memory records are changed even if the server cannot be reached.
 */
export async function patchInventory(inventory, updates, passcode) {
  for (const { sku, image, language } of updates) {
    const record = inventory.records[sku];
    if (!record) continue;
    if (image) record.image = image;
    if (language) record.language = language;
  }
  try {
    const { meta } = await call('/api/inventory/patch', passcode, { updates });
    if (meta?.updated_at) inventory.meta = { ...inventory.meta, updated_at: meta.updated_at };
  } catch {
    // The local copy is right; the server catches up when the next export is loaded.
  }
  await cache({ ...inventory.meta, has: inventory.has, rows: packInventory(inventory.records) });
}

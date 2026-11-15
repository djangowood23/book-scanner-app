import {
  LANGUAGES, PRODUCTION_ORIGIN, buildLocationsCsv, cleanTitle, matchSku, parseInventoryRecords, parseSpokenSkus,
  planLocations, resolveSku,
} from './lib.js';
import { PasscodeNeeded, loadCachedInventory, patchInventory, syncInventory, uploadInventory } from './inventory.js';
import { drawPlaceholder } from './placeholder.js';
import { sendToAob } from './send.js';

const MAX_EDGE = 2000; // handwriting on a row of slips needs more detail than a book cover

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('canvas');

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// Reading quality and passcode are shared with the scanner's Settings.
const settings = { quality: 'best', passcode: '', ...load('bookscanner.settings', {}) };
/** The AoB inventory: { meta, has, records }, shared across devices and cached on this one. Null until loaded. */
let inventory = null;
/** The lot being worked on: { sku, qty, unsure, from?, language? } */
let slips = load('bookscanner.shelf', []);
/**
 * Lots already saved, waiting to go to AoB: { sku, location, qty, from?, language?, fixImage? }.
 * `from` is what was said before the SKU was corrected, `language` the seller's choice
 * over the guess, `fixImage` a placeholder already made for it.
 */
let saved = load('bookscanner.locations', []);
let busy = false;

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function setShelfError(message) {
  $('shelfError').textContent = message ?? '';
  $('shelfError').hidden = !message;
}

const plural = (count, word) => `${count} ${count === 1 ? word : `${word}s`}`;

/** Ask for the app passcode on this page and remember it, so there is no trip to Settings. */
function askPasscode() {
  const entered = prompt('Enter the app passcode');
  setTimeout(reviveCamera, 100);
  if (!entered) return false;
  settings.passcode = entered.trim();
  save('bookscanner.settings', { ...load('bookscanner.settings', {}), passcode: settings.passcode });
  return true;
}

function ask(message) {
  const answer = confirm(message);
  setTimeout(reviveCamera, 100);
  return answer;
}

// ---------- SKUs, checked against the AoB inventory ----------

const records = () => inventory?.records ?? {};
const hasInventory = () => Object.keys(records()).length > 0;

/** Which inventory SKU a spoken, typed or photographed SKU means. See resolveSku in lib.js. */
function resolve(sku, prefix = $('prefix').value.trim()) {
  return resolveSku(sku, records(), prefix);
}

/** Put a newly entered SKU on a row, recording what it was corrected from, if anything. */
function setSku(entry, sku, prefix) {
  const result = resolve(sku, prefix);
  entry.sku = result.sku;
  if (result.status === 'corrected') entry.from = result.from; else delete entry.from;
  delete entry.fixImage; // a placeholder made for the old SKU does not belong to the new one
}

/** Add a SKU to the lot, or update its quantity if it is already there. Returns true if new. */
function addSlip(sku, qty = 1, unsure = false, prefix) {
  const slip = { qty, unsure };
  setSku(slip, sku, prefix);
  const existing = slips.find((other) => other.sku === slip.sku);
  if (existing) {
    if (qty > 1) existing.qty = qty;
    return false;
  }
  slips.push(slip);
  return true;
}

/** When the inventory arrives or changes, give rows that did not match another chance. */
function resolveAgain() {
  for (const entry of [...slips, ...saved]) {
    if (!Object.hasOwn(records(), entry.sku)) setSku(entry, entry.from ?? entry.sku, '');
  }
  save('bookscanner.shelf', slips);
  save('bookscanner.locations', saved);
}

/**
 * One editable row: SKU, quantity, remove, and under them what is known about the book
 * and what will be fixed when it is sent. `rows` is the list the entry lives in and
 * `persist` saves and redraws it. `extra` is optional text shown first (the location).
 */
function buildRow(entry, rows, persist, extra = '') {
  const match = matchSku(entry.sku, records());
  const li = document.createElement('li');
  li.className = match.status === 'unknown' ? 'problem' : entry.unsure ? 'unsure' : '';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = entry.sku;
  input.maxLength = 24;
  input.autocapitalize = 'characters';
  input.setAttribute('aria-label', 'SKU');
  const change = (value) => {
    const next = { ...entry };
    setSku(next, value);
    if (rows.some((other) => other !== entry && other.sku === next.sku)) {
      toast(`${next.sku} is already listed`);
      input.value = entry.sku;
      return;
    }
    Object.assign(entry, next);
    if (!next.from) delete entry.from;
    if (!next.fixImage) delete entry.fixImage;
    entry.unsure = false;
    persist();
  };
  input.addEventListener('change', () => {
    const value = input.value.trim();
    if (!value) { rows.splice(rows.indexOf(entry), 1); persist(); } else change(value);
  });

  const qty = document.createElement('input');
  qty.type = 'number';
  qty.className = 'qty';
  qty.min = '1';
  qty.inputMode = 'numeric';
  qty.value = String(entry.qty ?? 1);
  qty.setAttribute('aria-label', `Quantity of ${entry.sku}`);
  qty.addEventListener('change', () => {
    entry.qty = Math.max(1, parseInt(qty.value, 10) || 1);
    persist();
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Remove ${entry.sku}`);
  remove.addEventListener('click', () => { rows.splice(rows.indexOf(entry), 1); persist(); });

  const note = document.createElement('p');
  note.className = 'note';
  const parts = [];
  if (extra) parts.push(extra);
  if (match.status === 'ok') parts.push(cleanTitle(match.title));
  if (match.status === 'unknown') parts.push(match.suggestions.length ? 'Not in AoB, so it will not be sent. Did you mean:' : 'Not in AoB, so it will not be sent. Check the SKU.');
  if (entry.unsure && match.status !== 'unknown') parts.push('Handwriting unclear, please check');
  note.textContent = parts.filter(Boolean).join(' · ');
  note.hidden = !note.textContent;

  li.append(input, qty, remove, note);

  if (match.suggestions.length) {
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const suggestion of match.suggestions) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = suggestion.title ? `${suggestion.sku} · ${suggestion.title.slice(0, 28)}` : suggestion.sku;
      chip.addEventListener('click', () => change(suggestion.sku));
      chips.append(chip);
    }
    li.append(chips);
  }

  // What sending will fix on this book.
  const [plan] = planLocations([entry], records(), inventory?.has).rows;
  if (plan?.record) {
    const fixes = document.createElement('div');
    fixes.className = 'fixes';
    const tag = (text) => { const el = document.createElement('span'); el.textContent = text; fixes.append(el); };
    if (entry.from) tag(`Corrected from ${entry.from}`);
    if (plan.needsImage) tag('Placeholder image');
    if (plan.language) {
      const language = document.createElement('button');
      language.type = 'button';
      language.textContent = `Language: ${plan.language}`;
      language.setAttribute('aria-label', `Language ${plan.language}. Tap to change.`);
      language.addEventListener('click', () => {
        entry.language = LANGUAGES[(LANGUAGES.indexOf(plan.language) + 1) % LANGUAGES.length];
        persist();
      });
      fixes.append(language);
    }
    if (fixes.children.length) li.append(fixes);
  }
  return li;
}

function renderSlips() {
  const list = $('slips');
  list.replaceChildren(...slips.map((slip) => buildRow(slip, slips, persistShelf)));
  $('emptyShelf').hidden = slips.length > 0;
  $('slipCount').textContent = plural(slips.length, 'book');
  $('saveShelf').disabled = busy || slips.length === 0;
}

function persistShelf() {
  save('bookscanner.shelf', slips);
  setShelfError(null);
  renderSlips();
}

// ---------- speaking or typing SKUs ----------

function describe(entries) {
  return entries.map((entry) => (entry.qty > 1 ? `${entry.sku} ×${entry.qty}` : entry.sku)).join(', ');
}

const spokenOptions = () => ({ prefix: $('prefix').value.trim() });

/** Show what the text in the box will become, so a misheard SKU is caught before it is added. */
function renderPreview() {
  const { steps, undo } = parseSpokenSkus($('spoken').value, spokenOptions());
  const parts = [];
  if (undo) parts.push(`Will remove the last ${plural(undo, 'SKU')}`);
  // Read out the steps in order: SKUs for the current shelf, then each move and what follows it.
  let prefix = spokenOptions().prefix;
  let run = [];
  const closeRun = () => { if (run.length) parts.push(`Will add: ${describe(run)}`); run = []; };
  for (const step of steps) {
    if (step.sku) run.push({ ...step, sku: resolve(step.sku, prefix).sku });
    else {
      closeRun();
      if (step.prefix) prefix = step.prefix;
      parts.push(step.prefix ? `Prefix ${step.prefix}` : `Move to ${step.location}`);
    }
  }
  closeRun();
  $('preview').textContent = parts.join(' · ');
  $('preview').hidden = parts.length === 0;
}

function addSpoken() {
  const box = $('spoken');
  const { steps, undo } = parseSpokenSkus(box.value, spokenOptions());
  if (steps.length === 0 && undo === 0) {
    if (box.value.trim()) {
      toast($('prefix').value.trim()
        ? 'No SKU found in that. Say the numbers, or letters and a number like L 1233.'
        : 'No SKU found in that. Set a SKU prefix to say just the numbers, or say letters and a number like L 1233.');
    }
    box.focus();
    return;
  }
  for (let i = 0; i < undo && slips.length; i++) slips.pop();
  let added = 0;
  let prefix = spokenOptions().prefix;
  for (const step of steps) {
    if (step.sku) {
      if (addSlip(step.sku, step.qty, false, prefix)) added++;
    } else if (step.prefix) {
      prefix = step.prefix;
      $('prefix').value = step.prefix;
      save('bookscanner.shelfPrefix', step.prefix);
    } else {
      // Moving on: what was said so far belongs to the shelf or tub being left.
      if (slips.length && $('location').value.trim()) commitLot($('location').value.trim());
      $('location').value = step.location;
      save('bookscanner.shelfLocation', step.location);
      toast(`Now ${step.location}`);
    }
  }
  box.value = '';
  renderPreview();
  persistShelf();
  if (added || undo || steps.length) navigator.vibrate?.(30);
  box.focus(); // keep the keyboard up for the next ones
}

// ---------- saved lots ----------

/** Locations whose rows are open for editing, kept across re-renders. */
const openLocations = new Set();

function persistSaved() {
  save('bookscanner.locations', saved);
  renderSaved();
}

/** What sending would do right now: rows to send, rows held back, and the counts to report. */
function currentPlan() {
  const plan = planLocations(saved, records(), inventory?.has);
  return {
    ...plan,
    corrected: plan.rows.filter((row) => row.from).length,
    images: plan.rows.filter((row) => row.needsImage).length,
    languages: plan.rows.filter((row) => row.language).length,
  };
}

/**
 * The saved lots. Books that can be sent are grouped by location; tapping a location
 * opens it, where its name and each book can be corrected or removed. Books whose SKU
 * is not in AoB are listed apart, because AoB would silently ignore them.
 */
function renderSaved() {
  const plan = currentPlan();
  const held = new Set(plan.notSent);
  const list = $('savedList');
  list.replaceChildren();
  const groups = new Map();
  for (const entry of saved) {
    if (held.has(entry)) continue;
    if (!groups.has(entry.location)) groups.set(entry.location, []);
    groups.get(entry.location).push(entry);
  }
  for (const [location, entries] of groups) {
    const li = document.createElement('li');
    li.className = 'saved-group';
    const details = document.createElement('details');
    details.open = openLocations.has(location);
    details.addEventListener('toggle', () => {
      if (details.open) openLocations.add(location); else openLocations.delete(location);
    });

    const summary = document.createElement('summary');
    const name = document.createElement('span');
    name.className = 'title';
    name.textContent = location;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${plural(entries.length, 'book')} · tap to edit`;
    summary.append(name, meta);

    const rename = document.createElement('div');
    rename.className = 'field';
    const renameLabel = document.createElement('label');
    renameLabel.textContent = 'Shelf or tub';
    const renameInput = document.createElement('input');
    renameInput.type = 'text';
    renameInput.value = location;
    renameInput.autocapitalize = 'characters';
    renameInput.setAttribute('aria-label', `Rename ${location}`);
    renameInput.addEventListener('change', () => {
      const next = renameInput.value.trim();
      if (!next || next === location) { renameInput.value = location; return; }
      for (const entry of entries) entry.location = next;
      openLocations.delete(location);
      openLocations.add(next);
      persistSaved();
    });
    rename.append(renameLabel, renameInput);

    const rows = document.createElement('ul');
    rows.className = 'slips';
    rows.append(...entries.map((entry) => buildRow(entry, saved, persistSaved)));

    const removeAll = document.createElement('button');
    removeAll.type = 'button';
    removeAll.className = 'link danger';
    removeAll.textContent = `Remove all of ${location}`;
    removeAll.addEventListener('click', () => {
      if (!ask(`Remove the ${plural(entries.length, 'book')} saved for ${location}?`)) return;
      saved = saved.filter((entry) => !entries.includes(entry));
      openLocations.delete(location);
      persistSaved();
    });

    details.append(summary, rename, rows, removeAll);
    li.append(details);
    list.append(li);
  }

  $('notSentList').replaceChildren(...plan.notSent.map((entry) => buildRow(entry, saved, persistSaved, entry.location)));
  $('notSent').hidden = plan.notSent.length === 0;
  $('notSentHeading').textContent = `Not in AoB · ${plural(plan.notSent.length, 'book')} not sent`;

  const fixes = [];
  if (plan.corrected) fixes.push(`${plural(plan.corrected, 'SKU')} corrected`);
  if (plan.images) fixes.push(`${plural(plan.images, 'image')} to replace`);
  if (plan.languages) fixes.push(`${plural(plan.languages, 'language')} to fill`);
  $('fixSummary').textContent = fixes.length ? `When sent: ${fixes.join(' · ')}` : '';
  $('fixSummary').hidden = fixes.length === 0;

  const any = saved.length > 0;
  const sendable = plan.rows.length > 0;
  $('savedHeading').textContent = sendable ? `Saved · ${plural(plan.rows.length, 'book')}` : 'Saved';
  $('emptySaved').hidden = any;
  $('exportButton').hidden = !sendable;
  $('sendButton').hidden = !sendable;
  $('clearSaved').hidden = !any;
}

function saveLot() {
  const location = $('location').value.trim();
  if (!location) { setShelfError('Enter the shelf or tub first.'); $('location').focus(); return; }
  commitLot(location);
  $('spoken').focus();
}

/** Move the current lot into the saved record under `location`. The location field is left alone. */
function commitLot(location) {
  // A book moved to a new shelf keeps only its latest location.
  const moving = new Set(slips.map((slip) => slip.sku));
  saved = saved.filter((entry) => !moving.has(entry.sku));
  for (const slip of slips) {
    const entry = { sku: slip.sku, location, qty: slip.qty ?? 1 };
    if (slip.from) entry.from = slip.from;
    if (slip.language) entry.language = slip.language;
    saved.push(entry);
  }
  save('bookscanner.locations', saved);
  toast(`Saved ${plural(slips.length, 'book')} to ${location}`);
  slips = [];
  persistShelf();
  renderSaved();
}

// ---------- building and sending the file ----------

function locationsFilename() {
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  return `aob_locations_${stamp}.csv`;
}

function setSendStatus(text) {
  $('sendStatus').textContent = text ?? '';
  $('sendStatus').hidden = !text;
}

/** Store placeholder images the way book photos are stored, four at a time. Returns their URLs. */
async function storeImages(dataUrls, retried = false) {
  let response;
  try {
    response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-passcode': settings.passcode },
      body: JSON.stringify({ images: dataUrls.map((data) => ({ data })), read: false }),
    });
  } catch {
    throw new Error('No connection, so the placeholder images could not be saved. Try again when you have signal.');
  }
  if (response.status === 401) {
    if (!retried && askPasscode()) return storeImages(dataUrls, true);
    throw new Error('That passcode was not accepted.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.storage_error || body.image_urls?.some((url) => !url)) {
    throw new Error(body?.storage_error ?? body?.message ?? 'The placeholder images could not be saved. Try again.');
  }
  // Always the live site's address, even when this page is running on a preview deploy.
  return body.image_urls.map((url) => PRODUCTION_ORIGIN + new URL(url).pathname);
}

/**
 * Work out the file for AoB: leave out books AoB does not have, make placeholder images
 * for books whose image a marketplace cannot fetch, and fill in missing languages.
 * Returns { csv, plan }, or null if the seller backs out or nothing can be sent.
 */
async function buildFile() {
  if (!hasInventory() && !ask('No AoB inventory is loaded on this device, so SKUs cannot be checked and images and languages cannot be fixed.\n\nSend these as they are?')) return null;
  const plan = currentPlan();
  if (plan.rows.length === 0) throw new Error('None of these SKUs are in AoB, so there is nothing to send.');

  const waiting = plan.rows.filter((row) => row.needsImage && !row.entry.fixImage);
  for (let i = 0; i < waiting.length; i += 4) {
    setSendStatus(`Making placeholder images… ${Math.min(i + 4, waiting.length)} of ${waiting.length}`);
    const batch = waiting.slice(i, i + 4);
    const urls = await storeImages(batch.map((row) => drawPlaceholder({ sku: row.sku, ...row.record })));
    // Remember each one on its saved row, so a retry does not make it again.
    batch.forEach((row, n) => { row.entry.fixImage = urls[n]; });
    save('bookscanner.locations', saved);
  }
  for (const row of plan.rows) if (row.needsImage) row.image = row.entry.fixImage;
  return { csv: buildLocationsCsv(plan.rows), plan };
}

function summarize(plan, verb) {
  const parts = [`${verb} ${plural(plan.rows.length, 'book')}.`];
  parts.push(`${plural(plan.corrected, 'SKU')} corrected, ${plural(plan.images, 'image')} replaced, ${plural(plan.languages, 'language')} filled, ${plural(plan.notSent.length, 'row')} not sent.`);
  $('sendSummary').textContent = parts.join(' ');
  $('sendSummary').hidden = false;
}

async function withSending(button, work) {
  if (busy) return;
  busy = true;
  $('savedError').hidden = true;
  $('sendSummary').hidden = true;
  button.disabled = true;
  button.classList.add('busy');
  try {
    await work();
  } catch (error) {
    $('savedError').textContent = error.message;
    $('savedError').hidden = false;
  } finally {
    busy = false;
    setSendStatus(null);
    button.disabled = false;
    button.classList.remove('busy');
    renderSlips();
    renderSaved();
  }
}

function sendLocations() {
  return withSending($('sendButton'), async () => {
    const file = await buildFile();
    if (!file) return;
    setSendStatus('Sending to AoB…');
    const name = locationsFilename();
    let result = await sendToAob(name, file.csv, settings.passcode);
    if (result.needsPasscode && askPasscode()) result = await sendToAob(name, file.csv, settings.passcode);
    if (!result.sent) throw new Error(result.message ?? 'The file could not be sent.');

    summarize(file.plan, 'Sent');
    // Record what was just fixed, so the same book is not fixed again next time.
    const updates = file.plan.rows
      .filter((row) => row.image || row.language)
      .map((row) => ({ sku: row.sku, image: row.image, language: row.language ? row.language.toLowerCase() : undefined }));
    if (inventory && updates.length) await patchInventory(inventory, updates, settings.passcode);

    if (ask('Sent to AoB. It usually shows up there within a few minutes.\n\nClear the sent books from the saved list?')) {
      const sent = new Set(file.plan.rows.map((row) => row.entry));
      saved = saved.filter((entry) => !sent.has(entry));
      save('bookscanner.locations', saved);
    }
  });
}

function exportLocations() {
  return withSending($('exportButton'), async () => {
    const file = await buildFile();
    if (!file) return;
    const blob = new Blob([file.csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = locationsFilename();
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    summarize(file.plan, 'Exported');
  });
}

// ---------- camera (optional; runs only while its section is open) ----------

const cameraWanted = () => $('cameraOption').open && !document.hidden;

function showCameraMessage(text, canRetry) {
  $('cameraMessageText').textContent = text;
  $('retryCamera').hidden = !canRetry;
  $('cameraMessage').hidden = false;
}

function stopCamera() {
  video.srcObject?.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
}

async function startCamera() {
  if (video.srcObject?.active || !cameraWanted()) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraMessage('This browser cannot use the camera here. Use a photo from your library instead.', false);
    return;
  }
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
    });
    $('cameraMessage').hidden = true;
  } catch (error) {
    showCameraMessage(error.name === 'NotAllowedError'
      ? 'Camera access is blocked. Allow it in your browser settings, or use a photo from your library.'
      : 'No camera was found. Use a photo from your library instead.', true);
  }
}

/** iPhones freeze the camera picture when a system dialog opens; bring it back. */
let reviving = false;
async function reviveCamera() {
  if (!cameraWanted() || reviving) return;
  reviving = true;
  try {
    const track = video.srcObject?.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') {
      stopCamera();
      await startCamera();
    } else if (video.paused) {
      await video.play().catch(() => {});
    }
  } finally {
    reviving = false;
  }
}
video.addEventListener('pause', () => setTimeout(reviveCamera, 100));

function snapshot(source, width, height) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function frame() {
  if (!video.videoWidth) { toast('The camera is still starting.'); return null; }
  return snapshot(video, video.videoWidth, video.videoHeight);
}

async function callRead(image, kind, retried = false) {
  let response;
  try {
    response = await fetch('/api/skus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-passcode': settings.passcode },
      body: JSON.stringify({ image, kind, quality: settings.quality }),
    });
  } catch {
    throw new Error('No connection to the server. Speak or type the SKUs instead.');
  }
  if (response.status === 401) {
    if (!retried && askPasscode()) return callRead(image, kind, true);
    throw new Error('That passcode was not accepted. Tap the shutter to try again.');
  }
  let body = null;
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !body) throw new Error(body?.message ?? `The server returned an error (${response.status}). Try again.`);
  if (body.read_error) throw new Error(body.read_error);
  return body;
}

async function withBusy(message, work) {
  if (busy) return;
  busy = true;
  $('shutter').disabled = true;
  $('readLocation').disabled = true;
  $('readError').hidden = true;
  $('readStatus').textContent = message;
  $('readStatus').hidden = false;
  renderSlips();
  try {
    await work();
  } catch (error) {
    $('readError').textContent = error.message;
    $('readError').hidden = false;
  } finally {
    busy = false;
    $('shutter').disabled = false;
    $('readLocation').disabled = false;
    $('readStatus').hidden = true;
    renderSlips();
  }
}

function readSlips(image) {
  return withBusy('Reading the slips…', async () => {
    const reading = await callRead(image, 'slips');
    if (reading.slips.length === 0) throw new Error('No SKU slips were found in that photo. Move closer and try again.');
    let added = 0;
    for (const slip of reading.slips) if (addSlip(slip.sku, 1, slip.unsure, $('prefix').value.trim())) added++;
    persistShelf();
    const repeats = reading.slips.length - added;
    toast(`Added ${added}${repeats ? `, ${repeats} already listed` : ''}`);
    navigator.vibrate?.(40);
  });
}

function readLocation() {
  const image = frame();
  if (!image) return;
  return withBusy('Reading the label…', async () => {
    const reading = await callRead(image, 'location');
    if (!reading.location) throw new Error('No label could be read. Move closer, or type the location.');
    $('location').value = reading.location;
    save('bookscanner.shelfLocation', reading.location);
    setShelfError(null);
  });
}

// ---------- the AoB inventory ----------

const dateText = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function renderInventory(problem = '') {
  const count = Object.keys(records()).length;
  const lines = [];
  if (count) {
    const loaded = inventory.meta?.loaded_at;
    lines.push(`${count.toLocaleString()} books${loaded ? `, from the export loaded ${dateText(loaded)}` : ''}.`);
    const missing = ['image', 'language'].filter((field) => !inventory.has?.[field]);
    if (missing.length) lines.push(`That file had no ${missing.join(' or ')} column, so ${missing.length === 2 ? 'those' : 'that'} will not be fixed.`);
  } else {
    lines.push('No inventory loaded. Without it, SKUs cannot be checked and old books cannot be fixed up.');
  }
  if (problem) lines.push(problem);
  $('inventoryStatus').textContent = lines.join(' ');
}

function useInventory(next, problem) {
  inventory = next;
  resolveAgain();
  renderInventory(problem);
  renderSlips();
  renderSaved();
  renderPreview();
}

/** Show this device's copy straight away, then check the server for a newer one. */
async function startInventory() {
  const cached = await loadCachedInventory();
  if (cached) useInventory(cached);
  else {
    // Before the shared copy existed, each browser kept its own { sku: title } list.
    const legacy = load('bookscanner.inventory', null);
    if (legacy && Object.keys(legacy).length) {
      const blank = (title) => ({ title, author: '', media: '', image: '', language: '' });
      useInventory({ meta: {}, has: { title: true }, records: Object.fromEntries(Object.entries(legacy).map(([sku, title]) => [sku, blank(title)])) });
    }
  }
  await refreshInventory();
}

async function refreshInventory(retried = false) {
  try {
    const fresh = await syncInventory(settings.passcode, inventory?.meta?.updated_at ? inventory : null);
    if (fresh && fresh !== inventory) useInventory(fresh);
  } catch (error) {
    if (error instanceof PasscodeNeeded) {
      if (!retried && askPasscode()) return refreshInventory(true);
      renderInventory('Enter the passcode to load the shared inventory.');
    }
    // Any other failure is no connection: carry on with the copy on this device.
  }
}

async function loadInventory(file, retried = false) {
  const parsed = parseInventoryRecords(await file.text());
  if (!parsed || Object.keys(parsed.records).length === 0) {
    toast('That file has no "sku" column. Use the inventory export from AoB.');
    return;
  }
  const count = Object.keys(parsed.records).length;
  $('inventoryStatus').textContent = `Saving ${count.toLocaleString()} books for all your devices…`;
  try {
    useInventory(await uploadInventory(parsed.records, parsed.has, settings.passcode));
    toast(`Loaded ${count.toLocaleString()} books`);
  } catch (error) {
    if (error instanceof PasscodeNeeded && !retried && askPasscode()) return loadInventory(file, true);
    // Usable on this device for now, but not saved for the others.
    useInventory({ meta: { loaded_at: new Date().toISOString() }, has: parsed.has, records: parsed.records },
      'It could not be saved for your other devices. Load the file again when you have a connection.');
  }
}

// ---------- wiring ----------

$('spoken').addEventListener('input', renderPreview);
$('spoken').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); addSpoken(); }
});
$('addSpoken').addEventListener('click', addSpoken);
$('saveShelf').addEventListener('click', saveLot);
$('sendButton').addEventListener('click', sendLocations);
$('exportButton').addEventListener('click', exportLocations);
$('clearSaved').addEventListener('click', () => {
  if (!ask(`Clear all ${saved.length} saved locations? Send or export first if you still need them.`)) return;
  saved = [];
  save('bookscanner.locations', saved);
  renderSaved();
});
$('location').addEventListener('input', () => {
  setShelfError(null);
  save('bookscanner.shelfLocation', $('location').value);
});

$('cameraOption').addEventListener('toggle', () => {
  if ($('cameraOption').open) startCamera(); else stopCamera();
});
$('shutter').addEventListener('click', () => { const image = frame(); if (image) readSlips(image); });
$('readLocation').addEventListener('click', readLocation);
$('retryCamera').addEventListener('click', startCamera);
$('fileInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const bitmap = await createImageBitmap(file);
    await readSlips(snapshot(bitmap, bitmap.width, bitmap.height));
    bitmap.close?.();
  } catch {
    toast(`Could not open ${file.name}.`);
  }
});
$('inventoryInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) await loadInventory(file);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera(); else startCamera();
});

// Pick up where the lot was left, so switching to the scanner and back loses nothing.
$('location').value = load('bookscanner.shelfLocation', '');
$('prefix').value = load('bookscanner.shelfPrefix', '');
$('prefix').addEventListener('input', () => {
  save('bookscanner.shelfPrefix', $('prefix').value.trim());
  renderPreview();
});
renderSlips();
renderSaved();
renderInventory();
startInventory();

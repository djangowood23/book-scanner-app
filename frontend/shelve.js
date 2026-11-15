import { buildLocationsCsv, matchSku, parseInventory, parseSpokenSkus, resolveSkuCase } from './lib.js';
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
let inventory = load('bookscanner.inventory', {});
/** The lot being worked on: { sku, qty, unsure } */
let slips = load('bookscanner.shelf', []);
/** Lots already saved, waiting to go to AOB: { sku, location, qty } */
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

// ---------- the lot being worked on ----------

/** Add a SKU to the lot, or update its quantity if it is already there. Returns true if new. */
function addSlip(sku, qty = 1, unsure = false) {
  const existing = slips.find((slip) => slip.sku === sku);
  if (existing) {
    if (qty > 1) existing.qty = qty;
    return false;
  }
  slips.push({ sku, qty, unsure });
  return true;
}

function renderSlips() {
  const list = $('slips');
  list.replaceChildren();
  slips.forEach((slip, index) => {
    const match = matchSku(slip.sku, inventory);
    const li = document.createElement('li');
    li.className = match.status === 'unknown' ? 'problem' : slip.unsure ? 'unsure' : '';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = slip.sku;
    input.maxLength = 24;
    input.autocapitalize = 'characters';
    input.setAttribute('aria-label', `SKU ${index + 1}`);
    input.addEventListener('change', () => {
      const value = input.value.trim();
      if (!value) { slips.splice(index, 1); } else { slip.sku = value; slip.unsure = false; }
      persistShelf();
    });

    const qty = document.createElement('input');
    qty.type = 'number';
    qty.className = 'qty';
    qty.min = '1';
    qty.inputMode = 'numeric';
    qty.value = String(slip.qty ?? 1);
    qty.setAttribute('aria-label', `Quantity of ${slip.sku}`);
    qty.addEventListener('change', () => {
      slip.qty = Math.max(1, parseInt(qty.value, 10) || 1);
      persistShelf();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${slip.sku}`);
    remove.addEventListener('click', () => { slips.splice(index, 1); persistShelf(); });

    const note = document.createElement('p');
    note.className = 'note';
    if (match.status === 'ok') note.textContent = match.title;
    else if (match.status === 'unknown') note.textContent = match.suggestions.length ? 'Not in your inventory. Did you mean:' : 'Not in your inventory. Check the SKU.';
    if (slip.unsure && match.status !== 'unknown') note.textContent = [note.textContent, 'Handwriting unclear, please check'].filter(Boolean).join(' · ');
    note.hidden = !note.textContent;

    li.append(input, qty, remove, note);

    if (match.suggestions.length) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const suggestion of match.suggestions) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = suggestion.title ? `${suggestion.sku} · ${suggestion.title.slice(0, 28)}` : suggestion.sku;
        chip.addEventListener('click', () => {
          if (slips.some((other) => other !== slip && other.sku === suggestion.sku)) slips.splice(index, 1);
          else { slip.sku = suggestion.sku; slip.unsure = false; }
          persistShelf();
        });
        chips.append(chip);
      }
      li.append(chips);
    }
    list.append(li);
  });
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

/** Show what the text in the box will become, so a misheard SKU is caught before it is added. */
const spokenOptions = () => ({ prefix: $('prefix').value.trim() });

function renderPreview() {
  const { steps, undo } = parseSpokenSkus($('spoken').value, spokenOptions());
  const parts = [];
  if (undo) parts.push(`Will remove the last ${plural(undo, 'SKU')}`);
  // Read out the steps in order: SKUs for the current shelf, then each move and what follows it.
  let run = [];
  const closeRun = () => { if (run.length) parts.push(`Will add: ${describe(run)}`); run = []; };
  for (const step of steps) {
    if (step.sku) run.push(step);
    else { closeRun(); parts.push(step.prefix ? `Prefix ${step.prefix}` : `Move to ${step.location}`); }
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
  // Speech has no upper or lower case, so take it from the inventory where that is clear.
  for (const step of steps) {
    if (step.sku) {
      if (addSlip(resolveSkuCase(step.sku, inventory), step.qty)) added++;
    } else if (step.prefix) {
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

/**
 * The saved lots, grouped by location. Tapping a location opens it, where its name,
 * and each book's SKU and quantity, can be corrected or removed before sending.
 */
function renderSaved() {
  const list = $('savedList');
  list.replaceChildren();
  const groups = new Map();
  for (const entry of saved) {
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
    for (const entry of entries) {
      const row = document.createElement('li');
      const sku = document.createElement('input');
      sku.type = 'text';
      sku.value = entry.sku;
      sku.maxLength = 24;
      sku.autocapitalize = 'characters';
      sku.setAttribute('aria-label', `SKU in ${location}`);
      sku.addEventListener('change', () => {
        const next = sku.value.trim();
        if (!next) saved = saved.filter((other) => other !== entry);
        else if (saved.some((other) => other !== entry && other.sku === next)) {
          toast(`${next} is already saved`);
          sku.value = entry.sku;
          return;
        } else entry.sku = next;
        persistSaved();
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
        persistSaved();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${entry.sku}`);
      remove.addEventListener('click', () => {
        saved = saved.filter((other) => other !== entry);
        persistSaved();
      });
      row.append(sku, qty, remove);
      rows.append(row);
    }

    const removeAll = document.createElement('button');
    removeAll.type = 'button';
    removeAll.className = 'link danger';
    removeAll.textContent = `Remove all of ${location}`;
    removeAll.addEventListener('click', () => {
      if (!ask(`Remove the ${plural(entries.length, 'book')} saved for ${location}?`)) return;
      saved = saved.filter((entry) => entry.location !== location);
      openLocations.delete(location);
      persistSaved();
    });

    details.append(summary, rename, rows, removeAll);
    li.append(details);
    list.append(li);
  }
  const any = saved.length > 0;
  $('savedHeading').textContent = any ? `Saved · ${plural(saved.length, 'book')}` : 'Saved';
  $('emptySaved').hidden = any;
  $('exportButton').hidden = !any;
  $('sendButton').hidden = !any;
  $('clearSaved').hidden = !any;
}

function saveLot() {
  const location = $('location').value.trim();
  if (!location) { setShelfError('Enter the shelf or tub first.'); $('location').focus(); return; }
  const unknown = slips.filter((slip) => matchSku(slip.sku, inventory).status === 'unknown');
  if (unknown.length && !ask(`${unknown.length} of these SKUs ${unknown.length === 1 ? 'is' : 'are'} not in your inventory. Save anyway?`)) return;
  commitLot(location);
  $('spoken').focus();
}

/** Move the current lot into the saved record under `location`. The location field is left alone. */
function commitLot(location) {
  // A book moved to a new shelf keeps only its latest location.
  const moving = new Set(slips.map((slip) => slip.sku));
  saved = saved.filter((entry) => !moving.has(entry.sku));
  for (const slip of slips) saved.push({ sku: slip.sku, location, qty: slip.qty ?? 1 });
  save('bookscanner.locations', saved);
  toast(`Saved ${plural(slips.length, 'book')} to ${location}`);
  slips = [];
  persistShelf();
  renderSaved();
}

function locationsFilename() {
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  return `aob_locations_${stamp}.csv`;
}

async function sendLocations() {
  const button = $('sendButton');
  $('savedError').hidden = true;
  button.disabled = true;
  button.classList.add('busy');
  let result = await sendToAob(locationsFilename(), buildLocationsCsv(saved), settings.passcode);
  if (result.needsPasscode && askPasscode()) {
    result = await sendToAob(locationsFilename(), buildLocationsCsv(saved), settings.passcode);
  }
  button.disabled = false;
  button.classList.remove('busy');
  if (!result.sent) {
    $('savedError').textContent = result.message ?? 'The file could not be sent.';
    $('savedError').hidden = false;
    return;
  }
  toast(`Sent ${saved.length} locations to AOB`);
  if (ask('Sent to AOB. It usually shows up there within a few minutes.\n\nClear the saved lots now?')) {
    saved = [];
    save('bookscanner.locations', saved);
    renderSaved();
  }
}

function exportLocations() {
  const blob = new Blob([buildLocationsCsv(saved)], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = locationsFilename();
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast(`Exported ${saved.length} locations`);
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
    for (const slip of reading.slips) if (addSlip(slip.sku, 1, slip.unsure)) added++;
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

// ---------- inventory ----------

function renderInventory() {
  const count = Object.keys(inventory).length;
  $('inventoryStatus').textContent = count
    ? `${count.toLocaleString()} SKUs loaded. Each SKU is checked against this list, and upper or lower case is taken from it.`
    : 'Shelving works without this. If you load your AOB inventory export, each SKU is checked against it and upper or lower case is taken from it.';
}

async function loadInventory(file) {
  const parsed = parseInventory(await file.text());
  if (!parsed || Object.keys(parsed).length === 0) {
    toast('That file has no "sku" column. Use the inventory export from AOB.');
    return;
  }
  inventory = parsed;
  if (!save('bookscanner.inventory', inventory)) {
    // Too big to keep with titles: keep the SKUs alone so the check still works after a reload.
    save('bookscanner.inventory', Object.fromEntries(Object.keys(inventory).map((sku) => [sku, ''])));
  }
  renderInventory();
  renderSlips();
  toast(`Loaded ${Object.keys(inventory).length.toLocaleString()} SKUs`);
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

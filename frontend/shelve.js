import { buildLocationsCsv, matchSku, parseInventory } from './lib.js';
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
/** SKUs read for the shelf being worked on: { sku, seenTitle, unsure } */
let slips = load('bookscanner.shelf', []);
/** Shelves already saved, waiting for export: { sku, location } */
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

// ---------- the shelf being worked on ----------

function addSlip(sku, seenTitle = '', unsure = false) {
  if (slips.some((slip) => slip.sku === sku)) return false;
  slips.push({ sku, seenTitle, unsure });
  return true;
}

function renderSlips() {
  const list = $('slips');
  list.replaceChildren();
  slips.forEach((slip, index) => {
    const match = matchSku(slip.sku, inventory, slip.seenTitle);
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

    const note = document.createElement('p');
    note.className = 'note';
    if (match.status === 'ok') note.textContent = match.title || 'In your inventory';
    else if (match.status === 'unverified') note.textContent = slip.unsure ? 'Handwriting unclear, please check' : '';
    else note.textContent = match.suggestions.length ? 'Not in your inventory. Did you mean:' : 'Not in your inventory. Check the slip.';
    if (match.status === 'ok' && slip.unsure) note.textContent += ' (handwriting unclear, please check)';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${slip.sku}`);
    remove.addEventListener('click', () => { slips.splice(index, 1); persistShelf(); });

    note.hidden = !note.textContent;
    li.append(input, remove, note);

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
  $('slipCount').textContent = `${slips.length} ${slips.length === 1 ? 'book' : 'books'}`;
  $('saveShelf').disabled = busy || slips.length === 0;
}

function persistShelf() {
  save('bookscanner.shelf', slips);
  setShelfError(null);
  renderSlips();
}

// ---------- saved shelves ----------

function renderSaved() {
  const list = $('savedList');
  list.replaceChildren();
  const counts = new Map();
  for (const { location } of saved) counts.set(location, (counts.get(location) ?? 0) + 1);
  for (const [location, count] of counts) {
    const li = document.createElement('li');
    li.className = 'saved-row';
    const name = document.createElement('span');
    name.className = 'title';
    name.textContent = location;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${count} ${count === 1 ? 'book' : 'books'}`;
    li.append(name, meta);
    list.append(li);
  }
  const any = saved.length > 0;
  $('emptySaved').hidden = any;
  $('exportButton').hidden = !any;
  $('sendButton').hidden = !any;
  $('clearSaved').hidden = !any;
}

function saveShelf() {
  const location = $('location').value.trim();
  if (!location) { setShelfError('Enter the shelf or tub first.'); $('location').focus(); return; }
  const unknown = slips.filter((slip) => matchSku(slip.sku, inventory).status === 'unknown');
  if (unknown.length && !confirm(`${unknown.length} of these SKUs ${unknown.length === 1 ? 'is' : 'are'} not in your inventory. Save anyway?`)) return;
  // A book moved to a new shelf keeps only its latest location.
  const moving = new Set(slips.map((slip) => slip.sku));
  saved = saved.filter((entry) => !moving.has(entry.sku));
  for (const slip of slips) saved.push({ sku: slip.sku, location });
  save('bookscanner.locations', saved);
  toast(`Saved ${slips.length} ${slips.length === 1 ? 'book' : 'books'} to ${location}`);
  slips = [];
  $('location').value = '';
  persistShelf();
  renderSaved();
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
  const result = await sendToAob(locationsFilename(), buildLocationsCsv(saved), settings.passcode);
  button.disabled = false;
  button.classList.remove('busy');
  if (!result.sent) {
    $('savedError').textContent = result.message ?? 'The file could not be sent.';
    $('savedError').hidden = false;
    return;
  }
  toast(`Sent ${saved.length} locations to AOB`);
  if (confirm('Sent to AOB. It usually shows up there within a few minutes.\n\nClear the saved shelves now?')) {
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

// ---------- camera ----------

function cameraOn() {
  return Boolean(video.srcObject?.active);
}

function showCameraMessage(text, canRetry) {
  $('cameraMessageText').textContent = text;
  $('retryCamera').hidden = !canRetry;
  $('cameraMessage').hidden = false;
}

async function startCamera() {
  if (cameraOn()) return;
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

// ---------- reading ----------

async function callRead(image, kind) {
  let response;
  try {
    response = await fetch('/api/skus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-passcode': settings.passcode },
      body: JSON.stringify({ image, kind, quality: settings.quality }),
    });
  } catch {
    throw new Error('No connection to the server. Check your signal and try again.');
  }
  if (response.status === 401) throw new Error('This site needs a passcode. Enter it in the scanner\'s Settings, then come back.');
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
    for (const slip of reading.slips) if (addSlip(slip.sku, slip.title, slip.unsure)) added++;
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
    setShelfError(null);
  });
}

// ---------- inventory ----------

function renderInventory() {
  const count = Object.keys(inventory).length;
  $('inventoryStatus').textContent = count
    ? `${count.toLocaleString()} SKUs loaded. Each SKU you read is checked against this list.`
    : 'Shelving works without this. If you load your AOB inventory export, each SKU you read is also checked against it.';
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
$('addForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const sku = $('manualSku').value.trim();
  if (!sku) return;
  if (!addSlip(sku)) toast(`${sku} is already listed`);
  $('manualSku').value = '';
  persistShelf();
});
$('saveShelf').addEventListener('click', saveShelf);
$('exportButton').addEventListener('click', exportLocations);
$('sendButton').addEventListener('click', sendLocations);
$('clearSaved').addEventListener('click', () => {
  if (!confirm(`Clear all ${saved.length} saved locations? Export first if you still need them.`)) return;
  saved = [];
  save('bookscanner.locations', saved);
  renderSaved();
});
$('inventoryInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) await loadInventory(file);
});
$('location').addEventListener('input', () => setShelfError(null));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    video.srcObject?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  } else {
    startCamera();
  }
});

renderSlips();
renderSaved();
renderInventory();
startCamera();

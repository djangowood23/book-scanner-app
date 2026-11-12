import { CONDITIONS, buildCsv, cleanIsbn, csvFilename, isValidIsbn, nextSku, parseSku } from './lib.js';

const MAX_PHOTOS = 4;
const MAX_EDGE = 1600; // long edge in pixels: plenty for reading print, small enough to upload quickly
const HINTS = ['Cover first', 'Now the copyright page', 'Title page or back cover', 'One more if it helps', 'Four photos is the limit'];

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('canvas');
const form = $('bookForm');
const FIELDS = ['title', 'author', 'isbn', 'release_date', 'publisher', 'edition', 'media', 'condition',
  'cond_text', 'price', 'qty', 'notes', 'volume', 'language', 'asin', 'cost', 'location', 'source', 'sku'];

// ---------- stored state ----------

const DEFAULT_SETTINGS = {
  nextSku: '',
  condition: 2,
  price: '',
  notes: 'NO WRITING OR MARKING IN TEXT A CLEAN AND SOLID BOOK',
  location: '',
  source: '',
  layout: 'full',
  passcode: '',
};

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
  } catch {
    toast('This browser is not saving data, so the list will be lost when the page closes.');
  }
}

let settings = { ...DEFAULT_SETTINGS, ...load('bookscanner.settings', {}) };
let books = load('bookscanner.books', []);

// ---------- the book being worked on ----------

/** @type {{dataUrl: string|null, url: string|null}[]} */
let photos = [];
let editingId = null;
let busy = false;

// ---------- small UI helpers ----------

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function setBanner(kind, title, detail) {
  const el = $('aiBanner');
  if (!kind) { el.hidden = true; return; }
  el.className = `banner ${kind}`;
  el.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = title;
  el.append(strong);
  if (detail) el.append(detail);
  el.hidden = false;
}

function setFormError(message) {
  $('formError').textContent = message ?? '';
  $('formError').hidden = !message;
}

function syncChips() {
  for (const group of document.querySelectorAll('.chips')) {
    const value = $(group.dataset.for).value.trim();
    for (const chip of group.children) chip.setAttribute('aria-pressed', String(chip.dataset.value === value));
  }
}

function fillSelect(select) {
  for (const { code, label } of CONDITIONS) select.add(new Option(label, String(code)));
}

// ---------- form ----------

function blankBook() {
  return {
    title: '', author: '', isbn: '', release_date: '', publisher: '', edition: '', media: '',
    condition: settings.condition, cond_text: '', price: settings.price, qty: 1, notes: settings.notes,
    volume: '', language: 'English', asin: '', cost: '', location: settings.location, source: settings.source,
    sku: settings.nextSku, signed: false,
  };
}

function writeForm(book) {
  for (const name of FIELDS) {
    form.elements[name].value = book[name] ?? '';
    form.elements[name].classList.remove('filled');
  }
  form.elements.signed.checked = Boolean(book.signed);
  syncChips();
}

function readForm() {
  const book = {};
  for (const name of FIELDS) book[name] = form.elements[name].value.trim();
  book.isbn = cleanIsbn(book.isbn);
  book.condition = Number(book.condition);
  book.qty = parseInt(book.qty, 10);
  book.price = book.price.replace(/^\$/, '');
  book.cost = book.cost.replace(/^\$/, '');
  book.signed = form.elements.signed.checked;
  return book;
}

function startNewBook() {
  photos = [];
  editingId = null;
  writeForm(blankBook());
  setBanner(null);
  setFormError(null);
  $('priceNote').hidden = true;
  $('isbnFlag').hidden = true;
  $('formHeading').textContent = 'Book details';
  $('addButton').textContent = 'Add to list';
  renderPhotos();
  renderBooks();
}

/** Put the AI's reading into the form. Empty answers leave what is already there. */
function applyReading(reading) {
  const map = {
    title: reading.title, author: reading.author, isbn: reading.isbn, release_date: reading.release_year,
    publisher: reading.publisher, edition: reading.edition, media: reading.media, volume: reading.volume,
    language: reading.language, cond_text: reading.condition_notes,
  };
  for (const [name, value] of Object.entries(map)) {
    if (!value) continue;
    form.elements[name].value = value;
    form.elements[name].classList.add('filled');
  }
  if (reading.signed) form.elements.signed.checked = true;

  if (reading.price_estimate > 0) {
    form.elements.price.value = reading.price_estimate.toFixed(2);
    form.elements.price.classList.add('filled');
    $('priceNote').textContent = `Estimate, not market data. ${reading.price_reasoning}`;
    $('priceNote').hidden = false;
  }
  syncChips();

  if (!reading.title && !reading.isbn) {
    setBanner('warn', 'Could not identify this book', reading.needs || 'Try a clearer photo of the cover or title page.');
  } else if (reading.confidence === 'high' && !reading.needs) {
    setBanner('ok', 'Filled in from your photos', 'Check the highlighted fields before adding.');
  } else {
    const title = reading.confidence === 'high' ? 'Filled in from your photos' : `Filled in, ${reading.confidence} confidence`;
    setBanner(reading.confidence === 'high' ? 'ok' : 'warn', title, reading.needs || 'Check the highlighted fields carefully.');
  }
}

// ---------- photos ----------

function renderPhotos() {
  const list = $('thumbs');
  list.replaceChildren();
  photos.forEach((photo, index) => {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = photo.dataUrl ?? photo.url;
    img.alt = `Photo ${index + 1}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove photo ${index + 1}`);
    remove.addEventListener('click', () => { photos.splice(index, 1); renderPhotos(); });
    li.append(img, remove);
    list.append(li);
  });
  const full = photos.length >= MAX_PHOTOS;
  $('shotCount').textContent = `${photos.length} / ${MAX_PHOTOS}`;
  $('shotHint').textContent = HINTS[photos.length];
  $('shutter').disabled = full || !cameraOn() || busy;
  $('fileInput').disabled = full || busy;
  // Photos loaded from a saved book only exist as links, so they cannot be sent for reading again.
  $('readButton').disabled = busy || photos.length === 0 || photos.some((photo) => !photo.dataUrl);
}

/** Draw an image source onto the shared canvas, scaled so its long edge is at most MAX_EDGE. */
function drawScaled(source, width, height) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

async function addPhoto(dataUrl) {
  if (photos.length >= MAX_PHOTOS) return;
  photos.push({ dataUrl, url: null });
  renderPhotos();
  await detectBarcode(canvas);
}

async function takePhoto() {
  if (!video.videoWidth) { toast('The camera is still starting.'); return; }
  await addPhoto(drawScaled(video, video.videoWidth, video.videoHeight));
}

async function addFiles(files) {
  for (const file of files) {
    if (photos.length >= MAX_PHOTOS) { toast(`Only ${MAX_PHOTOS} photos per book.`); break; }
    try {
      const bitmap = await createImageBitmap(file);
      await addPhoto(drawScaled(bitmap, bitmap.width, bitmap.height));
      bitmap.close?.();
    } catch {
      toast(`Could not open ${file.name}.`);
    }
  }
}

// ---------- camera + barcode ----------

function cameraOn() {
  return Boolean(video.srcObject?.active);
}

function showCameraMessage(text) {
  $('cameraMessageText').textContent = text;
  $('cameraMessage').hidden = false;
  $('shotHint').hidden = true;
}

async function startCamera() {
  if (cameraOn()) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraMessage('This browser cannot use the camera here. Add photos from your library instead.');
    $('retryCamera').hidden = true;
    return;
  }
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
    });
    $('cameraMessage').hidden = true;
    $('shotHint').hidden = false;
  } catch (error) {
    showCameraMessage(error.name === 'NotAllowedError'
      ? 'Camera access is blocked. Allow it in your browser settings, or add photos from your library.'
      : 'No camera was found. Add photos from your library instead.');
  }
  renderPhotos();
}

function stopCamera() {
  video.srcObject?.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
}

// Barcode reading is built into some browsers (Chrome on Android). Elsewhere the AI reads the ISBN from the photo.
let detector = null;
if ('BarcodeDetector' in window) {
  try { detector = new window.BarcodeDetector({ formats: ['ean_13'] }); } catch { detector = null; }
}

async function detectBarcode(source) {
  if (!detector || form.elements.isbn.value) return;
  try {
    const codes = await detector.detect(source);
    const hit = codes.map((code) => code.rawValue).find(isValidIsbn);
    if (!hit || form.elements.isbn.value) return;
    form.elements.isbn.value = hit;
    form.elements.isbn.classList.add('filled');
    $('isbnFlag').textContent = `ISBN ${hit}`;
    $('isbnFlag').hidden = false;
    navigator.vibrate?.(40);
  } catch {
    // A failed detection just means no barcode this time.
  }
}

setInterval(() => {
  if (cameraOn() && !document.hidden && video.videoWidth && !busy) detectBarcode(video);
}, 700);

// ---------- server ----------

class ScanError extends Error {}

async function callScan(read) {
  const isbn = cleanIsbn(form.elements.isbn.value);
  let response;
  try {
    response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-passcode': settings.passcode },
      body: JSON.stringify({
        images: photos.map((photo) => ({ data: photo.dataUrl, stored: Boolean(photo.url) })),
        isbn_hint: isValidIsbn(isbn) ? isbn : null,
        read,
      }),
    });
  } catch {
    throw new ScanError('No connection to the server. Check your signal and try again.');
  }
  if (response.status === 401) {
    openSettings();
    throw new ScanError('This site needs a passcode. Enter it in Settings, then try again.');
  }
  let body = null;
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !body) {
    throw new ScanError(body?.message ?? `The server returned an error (${response.status}). Try again.`);
  }
  body.image_urls.forEach((url, index) => { if (url) photos[index].url = url; });
  return body;
}

function setBusy(button, label) {
  busy = Boolean(label);
  button.classList.toggle('busy', busy);
  if (label) { button.dataset.label = button.textContent; button.textContent = label; }
  else if (button.dataset.label) button.textContent = button.dataset.label;
  $('addButton').disabled = busy;
  renderPhotos();
}

async function readBook() {
  const button = $('readButton');
  setBusy(button, 'Reading…');
  setBanner(null);
  $('readStatus').textContent = 'Reading the photos. This usually takes 10 to 20 seconds.';
  $('readStatus').hidden = false;
  try {
    const result = await callScan(true);
    if (result.book) {
      applyReading(result.book);
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      setBanner('error', 'The photos were not read', result.read_error ?? 'Fill the details in by hand.');
    }
    if (result.storage_error) toast(result.storage_error);
  } catch (error) {
    setBanner('error', 'The photos were not read', error instanceof ScanError ? error.message : 'Something went wrong. Try again.');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } finally {
    $('readStatus').hidden = true;
    setBusy(button, null);
  }
}

// ---------- adding to the list ----------

function validate(book) {
  if (!book.title && !book.isbn) return 'Add a title or an ISBN.';
  if (book.isbn && !isValidIsbn(book.isbn)) return 'That ISBN does not check out. Correct it or clear it.';
  if (!book.price || !(Number(book.price) > 0)) return 'Add a price.';
  if (!(book.qty >= 1)) return 'Quantity must be at least 1.';
  if (!book.sku) return 'Add a SKU.';
  if (books.some((other) => other.sku === book.sku && other.id !== editingId)) return `SKU ${book.sku} is already in this list.`;
  return null;
}

async function submitBook(event) {
  event.preventDefault();
  if (busy) return;
  const book = readForm();
  const problem = validate(book);
  setFormError(problem);
  if (problem) return;

  if (photos.some((photo) => !photo.url)) {
    const button = $('addButton');
    setBusy(button, 'Saving photos…');
    try {
      const result = await callScan(false);
      if (result.storage_error) throw new ScanError(result.storage_error);
    } catch (error) {
      setFormError(`${error instanceof ScanError ? error.message : 'The photos could not be saved.'} Try again, or remove the photos to add this book without them.`);
      return;
    } finally {
      setBusy(button, null);
    }
  }
  book.images = photos.map((photo) => photo.url);

  if (editingId) {
    book.id = editingId;
    books = books.map((other) => (other.id === editingId ? book : other));
    toast(`Saved ${book.title || book.sku}`);
  } else {
    book.id = crypto.randomUUID();
    books.push(book);
    // Count up from the SKU just used, whether it came from Settings or was typed for the first book.
    if (book.sku === settings.nextSku || (!settings.nextSku && parseSku(book.sku))) {
      settings.nextSku = nextSku(book.sku);
      save('bookscanner.settings', settings);
    }
    toast(`Added ${book.title || book.sku}`);
  }
  save('bookscanner.books', books);
  startNewBook();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function editBook(id) {
  const book = books.find((other) => other.id === id);
  if (!book) return;
  editingId = id;
  photos = (book.images ?? []).map((url) => ({ dataUrl: null, url }));
  writeForm(book);
  setBanner(null);
  setFormError(null);
  $('priceNote').hidden = true;
  $('formHeading').textContent = `Editing ${book.sku}`;
  $('addButton').textContent = 'Save changes';
  renderPhotos();
  renderBooks();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function removeBook(id) {
  const book = books.find((other) => other.id === id);
  if (!book || !confirm(`Remove ${book.title || book.sku} from the list?`)) return;
  books = books.filter((other) => other.id !== id);
  save('bookscanner.books', books);
  if (editingId === id) startNewBook(); else renderBooks();
}

function renderBooks() {
  const list = $('books');
  list.replaceChildren();
  for (const book of [...books].reverse()) {
    const li = document.createElement('li');
    li.classList.toggle('editing', book.id === editingId);

    const cover = document.createElement(book.images?.[0] ? 'img' : 'div');
    cover.className = 'cover';
    if (book.images?.[0]) { cover.src = book.images[0]; cover.alt = ''; cover.loading = 'lazy'; }

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'info';
    info.setAttribute('aria-label', `Edit ${book.title || book.sku}`);
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = book.title || `ISBN ${book.isbn}`;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = [book.sku, `$${book.price}`, book.author].filter(Boolean).join(' · ');
    info.append(title, meta);
    info.addEventListener('click', () => editBook(book.id));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${book.title || book.sku}`);
    remove.addEventListener('click', () => removeBook(book.id));

    li.append(cover, info, remove);
    list.append(li);
  }
  const any = books.length > 0;
  $('bookCount').textContent = books.length;
  $('emptyList').hidden = any;
  $('exportButton').hidden = !any;
  $('clearButton').hidden = !any;
}

function exportCsv() {
  const blob = new Blob([buildCsv(books, settings.layout)], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = csvFilename();
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast(`Exported ${books.length} ${books.length === 1 ? 'book' : 'books'}`);
}

function clearList() {
  if (!confirm(`Clear all ${books.length} books from this list? Export first if you still need them.`)) return;
  books = [];
  save('bookscanner.books', books);
  startNewBook();
}

// ---------- settings ----------

function openSettings() {
  $('setNextSku').value = settings.nextSku;
  $('setCondition').value = String(settings.condition);
  $('setPrice').value = settings.price;
  $('setNotes').value = settings.notes;
  $('setLocation').value = settings.location;
  $('setSource').value = settings.source;
  $('setLayout').value = settings.layout;
  $('setPasscode').value = settings.passcode;
  if (!$('settingsDialog').open) $('settingsDialog').showModal();
}

function saveSettings() {
  const before = blankBook();
  settings = {
    nextSku: $('setNextSku').value.trim(),
    condition: Number($('setCondition').value),
    price: $('setPrice').value.trim().replace(/^\$/, ''),
    notes: $('setNotes').value.trim(),
    location: $('setLocation').value.trim(),
    source: $('setSource').value.trim(),
    layout: $('setLayout').value,
    passcode: $('setPasscode').value,
  };
  save('bookscanner.settings', settings);
  if (settings.nextSku && !parseSku(settings.nextSku)) toast('That SKU has no number at the end, so it will not count up.');
  if (editingId) return;
  // Bring the new starting values into the open form wherever the old ones are still untouched.
  const after = blankBook();
  for (const name of ['sku', 'condition', 'price', 'notes', 'location', 'source']) {
    if (form.elements[name].value === String(before[name])) form.elements[name].value = after[name];
  }
}

// ---------- wiring ----------

fillSelect($('condition'));
fillSelect($('setCondition'));

$('shutter').addEventListener('click', takePhoto);
$('retryCamera').addEventListener('click', startCamera);
$('fileInput').addEventListener('change', async (event) => {
  await addFiles([...event.target.files]);
  event.target.value = '';
});
$('readButton').addEventListener('click', readBook);
form.addEventListener('submit', submitBook);
form.addEventListener('input', (event) => {
  event.target.classList?.remove('filled');
  if (event.target.name === 'price') $('priceNote').hidden = true;
  if (event.target.name === 'isbn') $('isbnFlag').hidden = true;
  setFormError(null);
  syncChips();
});
$('resetButton').addEventListener('click', () => {
  const dirty = photos.length > 0 || form.elements.title.value || form.elements.isbn.value;
  if (!dirty || confirm('Discard this book and start over?')) startNewBook();
});
for (const chip of document.querySelectorAll('.chips button')) {
  chip.addEventListener('click', () => {
    const input = $(chip.parentElement.dataset.for);
    input.value = input.value === chip.dataset.value ? '' : chip.dataset.value;
    input.classList.remove('filled');
    syncChips();
  });
}
$('exportButton').addEventListener('click', exportCsv);
$('clearButton').addEventListener('click', clearList);
$('settingsButton').addEventListener('click', openSettings);
$('settingsCancel').addEventListener('click', () => $('settingsDialog').close());
$('settingsForm').addEventListener('submit', saveSettings);

// Release the camera while the page is in the background, and take it back on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera(); else startCamera();
});

startNewBook();
startCamera();

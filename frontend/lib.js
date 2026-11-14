// Pure helpers shared by the app and the tests: SKU sequencing, ISBN checks, CSV export.

/** Split "AB-0042" into { prefix: "AB-", number: 42, pad: 4 }. Returns null without trailing digits. */
export function parseSku(text) {
  const match = /^(.*?)(\d+)$/.exec(String(text ?? '').trim());
  if (!match) return null;
  return { prefix: match[1], number: parseInt(match[2], 10), pad: match[2].length };
}

export function formatSku({ prefix, number, pad }) {
  return prefix + String(number).padStart(pad, '0');
}

/** The SKU that follows `text` in sequence, or '' when it has no trailing number. */
export function nextSku(text) {
  const parsed = parseSku(text);
  return parsed ? formatSku({ ...parsed, number: parsed.number + 1 }) : '';
}

export function cleanIsbn(text) {
  return String(text ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

/** True for an ISBN-10 or ISBN-13 with a correct check digit. */
export function isValidIsbn(text) {
  const isbn = cleanIsbn(text);
  if (/^\d{13}$/.test(isbn)) {
    if (!/^97[89]/.test(isbn)) return false;
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(isbn[i]) * (i % 2 ? 3 : 1);
    return sum % 10 === 0;
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (isbn[i] === 'X' ? 10 : Number(isbn[i])) * (10 - i);
    return sum % 11 === 0;
  }
  return false;
}

export const CONDITIONS = [
  { code: 11, label: 'New' },
  { code: 1, label: 'Used: Like New' },
  { code: 2, label: 'Used: Very Good' },
  { code: 3, label: 'Used: Good' },
  { code: 4, label: 'Used: Acceptable' },
  { code: 5, label: 'Collectible: Like New' },
  { code: 6, label: 'Collectible: Very Good' },
  { code: 7, label: 'Collectible: Good' },
  { code: 8, label: 'Collectible: Acceptable' },
];

// Column order of The Art of Books inventory file.
export const FULL_HEADERS = [
  'sku', 'location', 'cost', 'source', 'isbn', 'upc', 'title', 'author', 'publisher',
  'release_date', 'image', 'media', 'price', 'condition', 'notes', 'qty', 'intl',
  'expd', 'listed_date', 'last_update', 'z_browse', 'z_category', 'z_shipping',
  'z_storefront', 'price_amz', 'price_abe', 'price_ali', 'weight', 'flags',
  'list_flags', 'reprice_flags', 'stripped_title', 'ali_status',
  'product_id_type', 'asin1', 'asin2', 'asin3', 'p0', 'p1', 'p2', 'p3', 'p4',
  'cond_text', 'jcond_text', 'keywords', 'edition', 'signature', 'language', 'volume',
  'image_2', 'image_3', 'image_4',
];

// The shorter layout the first version of this app exported.
export const SHORT_HEADERS = [
  'sku', 'title', 'author', 'isbn', 'condition', 'cond_text', 'price', 'qty',
  'notes', 'publisher', 'release_date', 'media', 'location', 'cost', 'source',
  'image', 'signature', 'edition', 'language',
];

/** Map a saved book to CSV column values, keyed by header name. */
export function bookToRow(book) {
  const isbn = cleanIsbn(book.isbn);
  let productIdType = '';
  if (book.asin) productIdType = '1';
  else if (isbn.length === 13) productIdType = '3';
  else if (isbn.length === 10) productIdType = '4';
  const images = book.images ?? [];
  return {
    sku: book.sku,
    location: book.location,
    cost: book.cost,
    source: book.source,
    isbn,
    title: book.title,
    author: book.author,
    publisher: book.publisher,
    release_date: book.release_date,
    image: images[0] ?? '',
    image_2: images[1] ?? '',
    image_3: images[2] ?? '',
    image_4: images[3] ?? '',
    media: book.media,
    price: book.price,
    condition: book.condition,
    notes: book.notes,
    qty: book.qty,
    intl: 'n',
    expd: 'n',
    weight: '0',
    product_id_type: productIdType,
    asin1: book.asin,
    cond_text: book.cond_text,
    edition: book.edition,
    signature: book.signed ? 'Signed' : '',
    language: book.language,
    volume: book.volume,
  };
}

export function escapeCsvCell(value) {
  if (value == null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(books, layout = 'full') {
  const headers = layout === 'short' ? SHORT_HEADERS : FULL_HEADERS;
  const lines = [headers.join(',')];
  for (const book of books) {
    const row = bookToRow(book);
    lines.push(headers.map((header) => escapeCsvCell(row[header])).join(','));
  }
  return lines.join('\n');
}

export function csvFilename(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  return `aob_export_${stamp}.csv`;
}

// ---------- listing image: straighten a photographed cover onto a white background ----------

/** Corners are [x, y] pairs in the order top-left, top-right, bottom-right, bottom-left. */
export const DEFAULT_CORNERS = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];

/** True when four fractional corners form a sensible clockwise, convex outline of a book. */
export function validCorners(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) return false;
  if (!corners.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(v) && v >= 0 && v <= 1))) return false;
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    const [cx, cy] = corners[(i + 2) % 4];
    // With y pointing down, a clockwise outline turns the same way at every corner.
    if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) <= 0) return false;
    area += ax * by - bx * ay;
  }
  return area / 2 >= 0.05;
}

/** Width and height in pixels of the rectangle a quadrilateral (pixel corners) flattens to. */
export function quadSize(px) {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return {
    width: Math.max(dist(px[0], px[1]), dist(px[3], px[2])),
    height: Math.max(dist(px[0], px[3]), dist(px[1], px[2])),
  };
}

/** Projective transform taking the rectangle (0,0)-(w,h) onto the quadrilateral `px`. */
export function rectToQuad(w, h, px) {
  const from = [[0, 0], [w, 0], [w, h], [0, h]];
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = px[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8x9 system.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const factor = rows[r][col] / rows[col][col];
      for (let c = col; c < 9; c++) rows[r][c] -= factor * rows[col][c];
    }
  }
  return rows.map((row, i) => row[8] / row[i]);
}

/**
 * Flatten the quadrilateral `px` of a source image into an outW x outH RGBA image.
 * `src` is { data, width, height } as returned by canvas getImageData.
 */
export function warpQuad(src, px, outW, outH) {
  const [a, b, c, d, e, f, g, h] = rectToQuad(outW, outH, px);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const { data, width, height } = src;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const w = g * (x + 0.5) + h * (y + 0.5) + 1;
      const sx = Math.min(Math.max((a * (x + 0.5) + b * (y + 0.5) + c) / w - 0.5, 0), width - 1);
      const sy = Math.min(Math.max((d * (x + 0.5) + e * (y + 0.5) + f) / w - 0.5, 0), height - 1);
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * width + x0) * 4, i10 = (y0 * width + x1) * 4;
      const i01 = (y1 * width + x0) * 4, i11 = (y1 * width + x1) * 4;
      const o = (y * outW + x) * 4;
      for (let k = 0; k < 3; k++) {
        const top = data[i00 + k] * (1 - fx) + data[i10 + k] * fx;
        const bottom = data[i01 + k] * (1 - fx) + data[i11 + k] * fx;
        out[o + k] = top * (1 - fy) + bottom * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

// Marketplace main-image rules: pure white background, the item filling most of the
// frame, and at least 1000 pixels on the longest side so zoom works.
export const LISTING_MARGIN = 0.04;
export const LISTING_MIN_EDGE = 1000;
export const LISTING_MAX_EDGE = 2000;

/** Pixel sizes for the flattened book and the white canvas around it. */
export function listingSize(bookW, bookH) {
  const natural = Math.max(bookW, bookH) / (1 - 2 * LISTING_MARGIN);
  const edge = Math.min(Math.max(natural, LISTING_MIN_EDGE), LISTING_MAX_EDGE);
  const scale = edge / natural;
  const innerW = Math.round(bookW * scale), innerH = Math.round(bookH * scale);
  const pad = Math.round(edge * LISTING_MARGIN);
  return { innerW, innerH, pad, width: innerW + 2 * pad, height: innerH + 2 * pad };
}

// ---------- shelving: check handwritten SKUs against the AOB inventory export ----------

/**
 * Read an AOB inventory export (tab-delimited, or comma-separated) into { sku: title }.
 * Only the sku column is required. Returns null when there is no sku column.
 */
export function parseInventory(text) {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return null;
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const clean = (cell) => cell.trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"');
  const headers = lines[0].split(delimiter).map((cell) => clean(cell).toLowerCase());
  const skuAt = headers.indexOf('sku');
  const titleAt = headers.indexOf('title');
  if (skuAt === -1) return null;
  const inventory = {};
  for (const line of lines.slice(1)) {
    const cells = line.split(delimiter);
    const sku = clean(cells[skuAt] ?? '');
    if (sku) inventory[sku] = titleAt === -1 ? '' : clean(cells[titleAt] ?? '');
  }
  return inventory;
}

/** True when two strings are the same or differ by one changed, added or missing character. */
export function withinOneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

function titleOverlap(a, b) {
  const words = (text) => new Set(String(text).toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  const seen = words(a);
  let shared = 0;
  for (const word of words(b)) if (seen.has(word)) shared++;
  return shared;
}

/**
 * Check a SKU as read from a slip against the inventory.
 * status: 'ok' (a real SKU), 'unknown' (not in the inventory; see suggestions),
 * or 'unverified' (no inventory loaded).
 */
export function matchSku(sku, inventory, seenTitle = '') {
  if (!inventory || Object.keys(inventory).length === 0) return { status: 'unverified', title: '', suggestions: [] };
  if (Object.hasOwn(inventory, sku)) return { status: 'ok', title: inventory[sku], suggestions: [] };
  const lower = sku.toLowerCase();
  const suggestions = Object.keys(inventory)
    .filter((other) => withinOneEdit(lower, other.toLowerCase()))
    .map((other) => ({
      sku: other,
      title: inventory[other],
      // Same letters in different case is the likeliest slip of all; then a matching book title.
      score: (other.toLowerCase() === lower ? 100 : 0) + titleOverlap(seenTitle, inventory[other]),
    }))
    .sort((a, b) => b.score - a.score || a.sku.localeCompare(b.sku))
    .slice(0, 4)
    .map(({ sku: other, title }) => ({ sku: other, title }));
  return { status: 'unknown', title: '', suggestions };
}

/** A file AOB can import to set each book's location and mark it in stock, touching nothing else. */
export function buildLocationsCsv(assignments) {
  // A book just placed on a shelf is in stock, so its quantity is set to 1 as well.
  const lines = ['sku,location,qty'];
  for (const { sku, location } of assignments) lines.push(`${escapeCsvCell(sku)},${escapeCsvCell(location)},1`);
  return lines.join('\n');
}

// ---------- SKU slips as a PDF, for printing without the phone's print dialog ----------

const PAGE_W = 612, PAGE_H = 792, PAGE_MARGIN = 28.8; // US Letter in points, 0.4in margin
const SLIP_COLS = 5, SLIP_ROWS = 2;

/** Text safe to place in a PDF string using the built-in Latin fonts. */
function pdfText(text) {
  return String(text ?? '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?').replace(/([\\()])/g, '\\$1');
}

function wrapText(text, perLine, maxLines) {
  const lines = [];
  let line = '';
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > perLine) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
    while (line.length > perLine) { lines.push(line.slice(0, perLine)); line = line.slice(perLine); }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

/**
 * A PDF of cut-out slips, ten to a US Letter page: the SKU in bold at the top of each
 * slip, the title lower down, dashed cut lines between. Returns the file as a string of
 * single-byte characters.
 */
export function buildSlipsPdf(books) {
  const slipW = (PAGE_W - 2 * PAGE_MARGIN) / SLIP_COLS;
  const slipH = (PAGE_H - 2 * PAGE_MARGIN) / SLIP_ROWS;
  const perPage = SLIP_COLS * SLIP_ROWS;
  const pages = [];
  for (let start = 0; start < books.length; start += perPage) {
    const ops = ['0.5 w [3 3] 0 d 0.5 G'];
    books.slice(start, start + perPage).forEach((book, i) => {
      const x = PAGE_MARGIN + (i % SLIP_COLS) * slipW;
      const top = PAGE_H - PAGE_MARGIN - Math.floor(i / SLIP_COLS) * slipH;
      ops.push(`${x.toFixed(2)} ${(top - slipH).toFixed(2)} ${slipW.toFixed(2)} ${slipH.toFixed(2)} re S`);
      const sku = String(book.sku ?? '');
      const size = sku.length > 12 ? 10 : sku.length > 8 ? 14 : 20;
      const skuLines = wrapText(sku, size === 10 ? 16 : 99, 2);
      skuLines.forEach((line, n) => {
        ops.push(`BT /F1 ${size} Tf ${(x + 7).toFixed(2)} ${(top - 26 - n * (size + 2)).toFixed(2)} Td (${pdfText(line)}) Tj ET`);
      });
      wrapText(book.title || (book.isbn ? `ISBN ${book.isbn}` : ''), 24, 4).forEach((line, n) => {
        ops.push(`BT /F2 8 Tf ${(x + 7).toFixed(2)} ${(top - 110 - n * 10).toFixed(2)} Td (${pdfText(line)}) Tj ET`);
      });
    });
    pages.push(ops.join('\n'));
  }

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  pages.forEach((content, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

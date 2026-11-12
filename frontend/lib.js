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
  'image_2',
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

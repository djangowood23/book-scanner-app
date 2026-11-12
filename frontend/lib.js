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

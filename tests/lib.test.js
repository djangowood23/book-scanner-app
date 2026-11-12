import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FULL_HEADERS, buildCsv, csvFilename, isValidIsbn, nextSku, parseSku } from '../frontend/lib.js';

test('SKU sequence keeps prefix and zero padding', () => {
  assert.deepEqual(parseSku('AB-0099'), { prefix: 'AB-', number: 99, pad: 4 });
  assert.equal(nextSku('AB-0099'), 'AB-0100');
  assert.equal(nextSku('ITEM999'), 'ITEM1000');
  assert.equal(nextSku('7'), '8');
  assert.equal(nextSku('NO-NUMBER'), '');
});

test('ISBN check digits', () => {
  assert.ok(isValidIsbn('9780306406157'));
  assert.ok(isValidIsbn('978-0-306-40615-7'));
  assert.ok(isValidIsbn('0306406152'));
  assert.ok(isValidIsbn('080442957X'));
  assert.ok(!isValidIsbn('9780306406158'));
  assert.ok(!isValidIsbn('0306406153'));
  assert.ok(!isValidIsbn('4006381333931')); // valid EAN-13, but not a book
  assert.ok(!isValidIsbn(''));
});

const book = {
  sku: 'AB-0001', title: 'Dune, "Deluxe"', author: 'Frank Herbert', isbn: '978-0-306-40615-7',
  publisher: 'Chilton', release_date: '1965', edition: 'First Edition', media: 'Hardcover',
  condition: 2, cond_text: 'DJ chipped', price: '45.00', qty: 1, notes: 'Line one\nLine two',
  volume: '', language: 'English', asin: '', cost: '', location: 'A1', source: '', signed: true,
  images: ['https://example.com/img/a.jpg', 'https://example.com/img/b.jpg'],
};

test('full CSV follows the AOB column order and quotes awkward cells', () => {
  const csv = buildCsv([book]);
  const [header, ...rest] = csv.split('\n');
  assert.equal(header, FULL_HEADERS.join(','));
  const row = rest.join('\n');
  assert.ok(row.startsWith('AB-0001,A1,,,9780306406157,,"Dune, ""Deluxe""",Frank Herbert,Chilton,1965,https://example.com/img/a.jpg,Hardcover,45.00,2,"Line one\nLine two",1,n,n,'));
  assert.ok(row.endsWith(',DJ chipped,,,First Edition,Signed,English,,https://example.com/img/b.jpg,,'));
  // ISBN-13 with no ASIN is product id type 3.
  assert.ok(row.includes(',3,,,,'));
});

test('short CSV matches the original export', () => {
  const [header, row] = buildCsv([{ ...book, notes: 'Clean' }], 'short').split('\n');
  assert.equal(header, 'sku,title,author,isbn,condition,cond_text,price,qty,notes,publisher,release_date,media,location,cost,source,image,signature,edition,language');
  assert.equal(row, 'AB-0001,"Dune, ""Deluxe""",Frank Herbert,9780306406157,2,DJ chipped,45.00,1,Clean,Chilton,1965,Hardcover,A1,,,https://example.com/img/a.jpg,Signed,First Edition,English');
});

test('export filename carries a timestamp', () => {
  assert.equal(csvFilename(new Date('2026-11-12T03:04:05Z')), 'aob_export_20261112030405.csv');
});

import { DEFAULT_CORNERS, listingSize, quadSize, rectToQuad, validCorners, warpQuad } from '../frontend/lib.js';

test('corner validation', () => {
  assert.ok(validCorners(DEFAULT_CORNERS));
  assert.ok(validCorners([[0.2, 0.1], [0.8, 0.15], [0.85, 0.9], [0.15, 0.85]]));
  assert.ok(!validCorners([[0.1, 0.1], [0.1, 0.9], [0.9, 0.9], [0.9, 0.1]])); // counter-clockwise
  assert.ok(!validCorners([[0.1, 0.1], [0.9, 0.9], [0.9, 0.1], [0.1, 0.9]])); // crossed
  assert.ok(!validCorners([[0.4, 0.4], [0.5, 0.4], [0.5, 0.5], [0.4, 0.5]])); // too small
  assert.ok(!validCorners([[0, 0], [1.2, 0], [1, 1], [0, 1]])); // outside the photo
  assert.ok(!validCorners(null));
});

test('projective transform lands rectangle corners on the quadrilateral', () => {
  const quad = [[120, 80], [900, 140], [860, 1100], [90, 1040]];
  const [a, b, c, d, e, f, g, h] = rectToQuad(600, 800, quad);
  const map = (x, y) => [(a * x + b * y + c) / (g * x + h * y + 1), (d * x + e * y + f) / (g * x + h * y + 1)];
  [[0, 0], [600, 0], [600, 800], [0, 800]].forEach(([x, y], i) => {
    const [u, v] = map(x, y);
    assert.ok(Math.abs(u - quad[i][0]) < 1e-6 && Math.abs(v - quad[i][1]) < 1e-6);
  });
  const size = quadSize(quad);
  assert.ok(Math.abs(size.width - Math.hypot(780, 60)) < 1e-9);
});

test('warping a full-frame rectangle reproduces the image', () => {
  const width = 4, height = 3;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([i * 20, 255 - i * 20, i, 255], i * 4);
  const out = warpQuad({ data, width, height }, [[0, 0], [4, 0], [4, 3], [0, 3]], 4, 3);
  assert.deepEqual([...out], [...data]);
});

test('warping picks out the chosen region', () => {
  // 4x4 image, black except a white 2x2 block in the middle.
  const data = new Uint8ClampedArray(64);
  for (let i = 0; i < 16; i++) data[i * 4 + 3] = 255;
  for (const i of [5, 6, 9, 10]) data.set([255, 255, 255, 255], i * 4);
  const out = warpQuad({ data, width: 4, height: 4 }, [[1, 1], [3, 1], [3, 3], [1, 3]], 2, 2);
  assert.deepEqual([...out], Array(4).fill([255, 255, 255, 255]).flat());
});

test('listing image meets the marketplace size rules', () => {
  const small = listingSize(450, 700); // upscaled so the long side reaches 1000
  assert.equal(Math.max(small.width, small.height), 1000);
  assert.ok(small.innerH / small.height >= 0.85);
  const big = listingSize(3000, 4000);
  assert.ok(Math.max(big.width, big.height) <= 2000);
  const mid = listingSize(900, 1300);
  assert.equal(mid.innerH, 1300);
});

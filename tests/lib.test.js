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
  assert.ok(row.endsWith(',DJ chipped,,,First Edition,Signed,English,,https://example.com/img/b.jpg'));
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

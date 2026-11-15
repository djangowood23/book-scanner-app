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

import { buildLocationsCsv, matchSku, parseInventory, withinOneEdit } from '../frontend/lib.js';

test('inventory export parsing', () => {
  const inventory = parseInventory('sku\tprice\ttitle\tlocation\r\nK-5405\t25.00\tEncounters with Paradise\tA1\r\ng-8425\t30\t"The ""Old"" Book"\t\r\n\r\n');
  assert.deepEqual(inventory, { 'K-5405': 'Encounters with Paradise', 'g-8425': 'The "Old" Book' });
  assert.deepEqual(parseInventory('SKU,Price\nT-1,20'), { 'T-1': '' });
  assert.equal(parseInventory('title\tprice\nx\t1'), null);
});

test('one-edit comparison', () => {
  assert.ok(withinOneEdit('k-5405', 'k-5905'));
  assert.ok(withinOneEdit('k-540', 'k-5405'));
  assert.ok(withinOneEdit('k-54005', 'k-5405'));
  assert.ok(!withinOneEdit('k-5405', 'k-5950'));
  assert.ok(!withinOneEdit('k-54', 'k-5405'));
});

test('SKU matching against the inventory', () => {
  const inventory = { 'K-5405': 'Encounters with Paradise: Views of Hawaii', 'K-5905': 'A History of Rome', 'G-5560': 'Gardens', 'g-8425': 'Maps' };
  assert.deepEqual(matchSku('K-5405', inventory), { status: 'ok', title: 'Encounters with Paradise: Views of Hawaii', suggestions: [] });
  assert.equal(matchSku('K-5405', {}).status, 'unverified');
  // Wrong case is not a real SKU, and the right-case one is offered first.
  const wrongCase = matchSku('g-5560', inventory);
  assert.equal(wrongCase.status, 'unknown');
  assert.equal(wrongCase.suggestions[0].sku, 'G-5560');
  // A misread digit: both neighbours are offered, the one whose title matches the cover first.
  const misread = matchSku('K-5805', inventory, 'Encounters with Paradise');
  assert.deepEqual(misread.suggestions.map((s) => s.sku), ['K-5405', 'K-5905']);
  assert.deepEqual(matchSku('ZZ-1', inventory).suggestions, []);
});

test('locations file', () => {
  assert.equal(buildLocationsCsv([{ sku: 'K-5405', location: 'Tub 12' }, { sku: 'T-1', location: 'Shelf A, row 2', qty: 3 }]),
    'sku,location,qty,image,language\nK-5405,Tub 12,1,,\nT-1,"Shelf A, row 2",3,,');
});

import { buildSlipsPdf } from '../frontend/lib.js';

test('slips PDF is well formed', () => {
  const books = Array.from({ length: 12 }, (_, i) => ({ sku: `K-${5400 + i}`, title: 'Encounters with Paradise (Views of Hawaii) — café' }));
  books.push({ sku: 'LONGPREFIX-000123-EXTRA', title: '', isbn: '9780441478125' });
  const pdf = buildSlipsPdf(books);
  assert.ok(pdf.startsWith('%PDF-1.4\n') && pdf.endsWith('%%EOF\n'));
  assert.ok(pdf.includes('/Count 2'), 'thirteen slips need two pages');
  assert.ok(pdf.includes('(K-5400) Tj') && pdf.includes('(ISBN 9780441478125) Tj'));
  assert.ok(pdf.includes('\\(Views of'), 'parentheses are escaped');
  assert.ok(![...pdf].some((ch) => ch.charCodeAt(0) > 255), 'every character is one byte');
  // The cross-reference table must point at the real object positions.
  const xref = Number(/startxref\n(\d+)\n/.exec(pdf)[1]);
  assert.ok(pdf.slice(xref).startsWith('xref\n'));
  const entries = pdf.slice(xref).split('\n').slice(3).filter((line) => / n $/.test(line));
  entries.forEach((line, i) => assert.ok(pdf.slice(Number(line.slice(0, 10))).startsWith(`${i + 1} 0 obj\n`)));
  // Declared stream lengths must match.
  for (const m of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) assert.equal(m[2].length, Number(m[1]));
});

import { formatSku, parseSpokenSkus, resolveSkuCase } from '../frontend/lib.js';

test('dash goes between prefix and number', () => {
  assert.equal(formatSku('L1233'), 'L-1233');
  assert.equal(formatSku('k-5405'), 'K-5405');
  assert.equal(formatSku('3ha023'), '3HA-023');
  assert.equal(formatSku('ra11-1-5'), 'RA11-1-5');
  assert.equal(formatSku('G8425', true), 'g-8425');
});

test('dictated SKUs', () => {
  const skus = (text) => parseSpokenSkus(text).entries.map((entry) => (entry.qty === 1 ? entry.sku : `${entry.sku} x${entry.qty}`));
  assert.deepEqual(skus('L1233'), ['L-1233']);
  assert.deepEqual(skus('L 1233 K 5405'), ['L-1233', 'K-5405']);
  assert.deepEqual(skus('l 12 33, k5405. T-3290'), ['L-1233', 'K-5405', 'T-3290']);
  assert.deepEqual(skus('el one two three three kay 5405'), ['L-1233', 'K-5405']);
  assert.deepEqual(skus('L twelve thirty three'), ['L-1233']);
  assert.deepEqual(skus('T 3290 quantity 3 K 5405'), ['T-3290 x3', 'K-5405']);
  assert.deepEqual(skus('T3290 qty three next K5405 x2'), ['T-3290 x3', 'K-5405 x2']);
  assert.deepEqual(skus('lowercase g 8425 G 5560'), ['g-8425', 'G-5560']);
  assert.deepEqual(skus('R A 11 dash 1 dash 5 next 3 H A 0 2 3'), ['RA11-1-5', '3HA-023']);
  assert.deepEqual(skus('L 1233 K 5405 undo T 3290'), ['L-1233', 'T-3290']);
  assert.deepEqual(skus('L 1233 scratch that'), []);
  assert.deepEqual(skus('hello there 55'), [], 'words and bare numbers are not SKUs');
  assert.equal(parseSpokenSkus('undo').undo, 1);
});

test('a new shelf or tub can be named in the flow', () => {
  const steps = (text) => parseSpokenSkus(text).steps.map((step) => step.location ?? (step.qty === 1 ? step.sku : `${step.sku} x${step.qty}`));
  assert.deepEqual(steps('L 1233 K 5405 new tub 13 T 3290'), ['L-1233', 'K-5405', 'TUB 13', 'T-3290']);
  assert.deepEqual(steps('tub twelve'), ['TUB 12']);
  assert.deepEqual(steps('shelf A, L 1233'), ['SHELF A', 'L-1233']);
  assert.deepEqual(steps('tub 12 L 1233'), ['TUB 12', 'L-1233']);
  // Shelves and tubs with codes of their own keep them, without the word in front.
  assert.deepEqual(steps('tub B T 25 L 1233'), ['BT-25', 'L-1233']);
  assert.deepEqual(steps('new shelf W 1 dash 2 K5405 quantity 2'), ['W1-2', 'K-5405 x2']);
  assert.deepEqual(steps('L 1233 next tub G 18 dash 18'), ['L-1233', 'G18-18']);
  assert.deepEqual(steps('location BT25'), ['BT-25']);
  assert.deepEqual(steps('L 1233 box 4 undo'), ['BOX 4'], 'undo removes the last SKU, not the move');
  assert.deepEqual(parseSpokenSkus('tub 13 T 3290').entries, [{ sku: 'T-3290', qty: 1 }]);
});

test('a default prefix lets the numbers be said alone', () => {
  const skus = (text, prefix) => parseSpokenSkus(text, { prefix }).steps.map((step) => step.prefix ? `prefix ${step.prefix}` : step.qty === 1 ? step.sku : `${step.sku} x${step.qty}`);
  assert.deepEqual(skus('231 and 232 and 1', 'KEV'), ['KEV-231', 'KEV-232', 'KEV-1']);
  assert.deepEqual(skus('zero zero one and 12 33', 'KEV'), ['KEV-001', 'KEV-1233']);
  assert.deepEqual(skus('1233 1234 quantity 2', 'G'), ['G-1233', 'G-1234 x2'], 'whole numbers in a row are separate books');
  assert.deepEqual(skus('55 and 56', 'W1'), ['W1-55', 'W1-56']);
  assert.deepEqual(skus('231 and G 5560 and 232', 'KEV'), ['KEV-231', 'G-5560', 'KEV-232'], 'a spoken prefix wins for that book');
  assert.deepEqual(skus('231 K E V 232', 'G'), ['G-231', 'KEV-232']);
  assert.deepEqual(skus('231 undo 232', 'G'), ['G-232']);
  assert.deepEqual(parseSpokenSkus('tub 12 and 231', { prefix: 'G' }).steps, [{ location: 'TUB 12' }, { sku: 'G-231', qty: 1 }]);
  assert.deepEqual(skus('231 and 232', ''), [], 'without a prefix a bare number is not a SKU');
  // Changing the default by voice.
  assert.deepEqual(skus('prefix K E V and 231 and 232'), ['prefix KEV', 'KEV-231', 'KEV-232']);
  assert.deepEqual(skus('5560 prefix W 1 and 2 and 3', 'G'), ['G-5560', 'prefix W1', 'W1-2', 'W1-3']);
  assert.deepEqual(skus('prefix G 1233 and 1234'), ['prefix G', 'G-1233', 'G-1234']);
});

test('case is taken from the inventory when it is unambiguous', () => {
  const inventory = { 'g-8425': '', 'K-5405': '', 'G-5560': '', 'g-5560': '' };
  assert.equal(resolveSkuCase('G-8425', inventory), 'g-8425');
  assert.equal(resolveSkuCase('K-5405', inventory), 'K-5405');
  assert.equal(resolveSkuCase('G-5560', inventory), 'G-5560');
  assert.equal(resolveSkuCase('Z-1', inventory), 'Z-1');
  assert.equal(resolveSkuCase('Z-1', {}), 'Z-1');
});

import {
  cleanTitle, guessLanguage, isBadImage, parseDelimited, parseInventoryRecords, packInventory, planLocations,
  resolveSku, unpackInventory,
} from '../frontend/lib.js';

test('delimited parsing handles quoted cells', () => {
  assert.deepEqual(parseDelimited('sku\ttitle\tnotes\r\nA-1\t"Tab\tinside"\t"She said ""hi"""\r\nA-2\tPlain\t\r\n'),
    [['sku', 'title', 'notes'], ['A-1', 'Tab\tinside', 'She said "hi"'], ['A-2', 'Plain', '']]);
  // A quote that never closes is literal and does not swallow the following rows.
  assert.deepEqual(parseDelimited('sku\ttitle\nA-1\t"Unclosed title\nA-2\t12" record\nA-3\tOK'),
    [['sku', 'title'], ['A-1', '"Unclosed title'], ['A-2', '12" record'], ['A-3', 'OK']]);
  assert.deepEqual(parseDelimited('sku,title\nA-1,"Line one\nline two, with comma"\nA-2,"x"'),
    [['sku', 'title'], ['A-1', 'Line one\nline two, with comma'], ['A-2', 'x']]);
  assert.deepEqual(parseDelimited(''), []);
});

test('inventory records keep the fields the fix-up needs', () => {
  const file = 'SKU\tprice\tTitle\tAuthor\tMedia\tImage\tqty\nSKU-KEV-481\t20\tOld Book\tA. Writer\tHardcover\thttp://ecx.images-amazon.com/x.jpg\t0\n';
  const { records, has } = parseInventoryRecords(file);
  assert.deepEqual(records, { 'SKU-KEV-481': { title: 'Old Book', author: 'A. Writer', media: 'Hardcover', image: 'http://ecx.images-amazon.com/x.jpg', language: '' } });
  assert.deepEqual(has, { title: true, author: true, media: true, image: true, language: false });
  assert.deepEqual(unpackInventory(packInventory(records)), records);
  assert.equal(parseInventoryRecords('title\nx'), null);
});

const INVENTORY = {
  'SKU-KEV-481': { title: 'LYRISCHE GEDICHTE [Hardcover] HERMANN PALM', author: 'Hermann Palm', media: 'Hardcover', image: 'http://ecx.images-amazon.com/images/I/51MGMifsJvL._SL75_.jpg', language: '' },
  'G-7374': { title: 'A History of Rome', author: '', media: 'Paperback', image: 'https://storage.googleapis.com/aob-scanner-book-images/book_covers/G-7374.png', language: 'English' },
  'g-8425': { title: 'Maps', author: '', media: '', image: 'Publishers', language: 'English' },
  'IN-5': { title: 'Really starts with IN', author: '', media: '', image: '', language: '' },
};

test('the real export shape: many columns, lowercase languages, stray quotes', () => {
  const filler = Array.from({ length: 130 }, (_, i) => `c${i}`);
  const header = ['sku', ...filler.slice(0, 60), 'title', 'author', 'image', 'media', 'language', ...filler.slice(60)].join('\t');
  const line = (sku, title, language) => [sku, ...filler.slice(0, 60).map(() => ''), title, 'Someone', 'Publishers', 'Hardcover', language, ...filler.slice(60).map(() => '')].join('\t');
  const file = [header, line('A-1', 'The 12" Single', 'english'), line('A-2', '"Quoted" at the start', ''), line('A-3', '"Wholly quoted"', 'polish')].join('\r\n');
  const { records, has } = parseInventoryRecords(file);
  assert.deepEqual(Object.keys(records), ['A-1', 'A-2', 'A-3']);
  assert.equal(records['A-1'].title, 'The 12" Single');
  assert.equal(records['A-2'].title, '"Quoted" at the start');
  assert.equal(records['A-3'].title, 'Wholly quoted');
  assert.equal(records['A-3'].language, 'polish');
  assert.ok(has.image && has.language && has.author && has.media);
  // Any language already there is left alone, whatever it is; only a blank is guessed.
  const rows = planLocations(Object.keys(records).map((sku) => ({ sku, location: 'X', qty: 1 })), records, has).rows;
  assert.deepEqual(rows.map((row) => row.language), ['', 'English', '']);
});

test('SKU resolution', () => {
  assert.deepEqual(resolveSku('G-7374', INVENTORY), { sku: 'G-7374', status: 'ok' });
  assert.deepEqual(resolveSku('G-8425', INVENTORY), { sku: 'g-8425', status: 'ok' }, 'case comes from the inventory');
  // Old books entered with "SKU-" in front.
  assert.deepEqual(resolveSku('KEV-481', INVENTORY), { sku: 'SKU-KEV-481', status: 'corrected', from: 'KEV-481' });
  assert.deepEqual(resolveSku('kev-481', INVENTORY), { sku: 'SKU-KEV-481', status: 'corrected', from: 'kev-481' });
  // Dictation heard "and" as "in".
  assert.deepEqual(resolveSku('IN-7374', INVENTORY, 'G'), { sku: 'G-7374', status: 'corrected', from: 'IN-7374' });
  assert.deepEqual(resolveSku('IN-481', INVENTORY, 'KEV'), { sku: 'SKU-KEV-481', status: 'corrected', from: 'IN-481' });
  assert.deepEqual(resolveSku('IN-7374', INVENTORY), { sku: 'IN-7374', status: 'unknown' }, 'no prefix, no guess');
  assert.deepEqual(resolveSku('IN-9999', INVENTORY, 'G'), { sku: 'IN-9999', status: 'unknown' }, 'a guess not in the inventory is not used');
  assert.deepEqual(resolveSku('IN-5', INVENTORY, 'G'), { sku: 'IN-5', status: 'ok' }, 'a real IN SKU is left alone');
  assert.deepEqual(resolveSku('ZZ-1', INVENTORY), { sku: 'ZZ-1', status: 'unknown' });
  assert.deepEqual(resolveSku('ZZ-1', {}), { sku: 'ZZ-1', status: 'unverified' });
});

test('bad images', () => {
  assert.ok(isBadImage('http://ecx.images-amazon.com/images/I/51MGMifsJvL._SL75_.jpg'));
  assert.ok(isBadImage('http://g-ecx.images-amazon.com/images/G/01/x-site/icons/no-img-sm._CB192198896_.gif'));
  assert.ok(isBadImage('Publishers'));
  assert.ok(isBadImage(''));
  assert.ok(isBadImage(undefined));
  assert.ok(isBadImage('https://m.media-amazon.com/images/I/x.jpg'));
  assert.ok(!isBadImage('https://storage.googleapis.com/aob-scanner-book-images/book_covers/K-5405.png'));
  assert.ok(!isBadImage('https://sage-biscochitos-e77053.netlify.app/img/0b1c2d3e-0000-4000-8000-000000000000.png'));
});

test('title cleanup and language guess', () => {
  const title = 'LYRISCHE GEDICHTE [Hardcover] HERMANN PALM';
  assert.equal(cleanTitle(title), 'Lyrische Gedichte');
  assert.equal(guessLanguage(title), 'German');
  assert.equal(cleanTitle('The Old Man and the Sea [Paperback] Hemingway, Ernest.'), 'The Old Man and the Sea');
  assert.equal(cleanTitle('A HISTORY OF THE WORLD IN 100 OBJECTS.'), 'A History of the World in 100 Objects');
  assert.equal(cleanTitle('Mixed Case Stays: As It Is,'), 'Mixed Case Stays: As It Is');
  assert.equal(guessLanguage('A History of Rome'), 'English');
  assert.equal(guessLanguage('Dune'), 'English');
  assert.equal(guessLanguage('The School of Athens'), 'English');
  assert.equal(guessLanguage('Die Geschichte der deutschen Literatur'), 'German');
  assert.equal(guessLanguage('Les Fleurs du mal'), 'French');
  assert.equal(guessLanguage('Cien años de soledad'), 'Spanish');
  assert.equal(guessLanguage('Il nome della rosa'), 'Italian');
});

test('what goes into the file for AOB', () => {
  const has = { title: true, author: true, media: true, image: true, language: true };
  const saved = [
    { sku: 'SKU-KEV-481', location: 'BT-25', qty: 1, from: 'KEV-481' },
    { sku: 'G-7374', location: 'BT-25', qty: 2 },
    { sku: 'ZZ-1', location: 'BT-25', qty: 1 },
  ];
  const { rows, notSent } = planLocations(saved, INVENTORY, has);
  assert.deepEqual(notSent.map((entry) => entry.sku), ['ZZ-1']);
  assert.deepEqual(rows.map((row) => [row.sku, row.needsImage, row.language]), [['SKU-KEV-481', true, 'German'], ['G-7374', false, '']]);
  rows[0].image = 'https://sage-biscochitos-e77053.netlify.app/img/abc.png';
  const csv = buildLocationsCsv(rows);
  assert.equal(csv, 'sku,location,qty,image,language\nSKU-KEV-481,BT-25,1,https://sage-biscochitos-e77053.netlify.app/img/abc.png,german\nG-7374,BT-25,2,,');
  assert.ok(!csv.includes('ZZ-1'), 'an unknown SKU is left out');
  assert.ok(csv.startsWith('sku,'));

  // The seller's own choice of language wins over the guess.
  assert.equal(planLocations([{ ...saved[0], language: 'English' }], INVENTORY, has).rows[0].language, 'English');
  // Columns the inventory file did not have are not treated as blank.
  const partial = planLocations(saved, INVENTORY, { image: false, language: false }).rows;
  assert.deepEqual(partial.map((row) => [row.needsImage, row.language]), [[false, ''], [false, '']]);
  // With no inventory nothing can be checked, so everything is sent as it is.
  assert.deepEqual(planLocations(saved, {}).rows.map((row) => row.sku), ['SKU-KEV-481', 'G-7374', 'ZZ-1']);
});

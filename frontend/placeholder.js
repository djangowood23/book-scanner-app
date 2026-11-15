// Draws the "photo available upon request" image used for old books whose AOB image
// cannot be fetched by a marketplace.

import { cleanTitle } from './lib.js';

const SIZE = 1200;
const CARD = 40; // card inset from the edge
const PAD = 80; // text inset from the edge (card inset plus 40)
const BAR = 215; // height of the black bar
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", Times, serif';
const INK = 'rgb(26,26,26)';
const GREY = 'rgb(120,117,110)';

/** Draw text centred on x with extra space between letters (canvas letter-spacing is not universal). */
function spaced(ctx, text, x, y, gap) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  let at = x - (widths.reduce((sum, w) => sum + w, 0) + gap * (text.length - 1)) / 2;
  ctx.textAlign = 'left';
  [...text].forEach((ch, i) => { ctx.fillText(ch, at, y); at += widths[i] + gap; });
  ctx.textAlign = 'center';
}

function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * A 1200 x 1200 PNG for one book, as a data URL.
 * `book` is { sku, title, author, media }.
 */
export function drawPlaceholder(book) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const width = SIZE - 2 * PAD;
  const centre = SIZE / 2;

  ctx.fillStyle = '#faf9f5';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = 'rgb(200,196,186)';
  ctx.lineWidth = 1;
  ctx.strokeRect(CARD + 0.5, CARD + 0.5, SIZE - 2 * CARD - 1, SIZE - 2 * CARD - 1);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Shop name and rule.
  ctx.fillStyle = GREY;
  ctx.font = `700 34px ${SANS}`;
  spaced(ctx, 'VOYAGER BOOKS', centre, 138, 9);
  ctx.fillRect(PAD, 170, width, 1);

  // Title, shrunk until it fits the space above the author line and the bar.
  const title = cleanTitle(book.title) || 'Untitled';
  const byline = [String(book.author ?? '').trim(), String(book.media ?? '').trim()].filter(Boolean).join(' / ');
  const top = 230;
  const bottom = SIZE - CARD - BAR - 60;
  const bylineSpace = byline ? 90 : 0;
  let size = 92;
  let lines = [];
  for (; size >= 30; size -= 4) {
    ctx.font = `700 ${size}px ${SERIF}`;
    lines = wrap(ctx, title, width);
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
    if (widest <= width && lines.length * size * 1.22 <= bottom - top - bylineSpace) break;
  }
  const lineHeight = size * 1.22;
  const blockHeight = lines.length * lineHeight + bylineSpace;
  let y = top + (bottom - top - blockHeight) / 2 + size;
  ctx.fillStyle = INK;
  for (const line of lines) { ctx.fillText(line, centre, y, width); y += lineHeight; }

  if (byline) {
    ctx.fillStyle = GREY;
    let bylineSize = 40;
    ctx.font = `400 ${bylineSize}px ${SERIF}`;
    while (bylineSize > 24 && ctx.measureText(byline).width > width) {
      bylineSize -= 2;
      ctx.font = `400 ${bylineSize}px ${SERIF}`;
    }
    ctx.fillText(byline, centre, y - lineHeight + 72, width); // y is one line past the title's last baseline
  }

  // Black bar across the bottom of the card.
  const barTop = SIZE - CARD - BAR;
  ctx.fillStyle = INK;
  ctx.fillRect(CARD, barTop, SIZE - 2 * CARD, BAR);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 46px ${SANS}`;
  spaced(ctx, 'PHOTO AVAILABLE', centre, barTop + 70, 4);
  spaced(ctx, 'UPON REQUEST', centre, barTop + 126, 4);
  ctx.fillStyle = 'rgb(168,165,158)';
  ctx.font = `400 30px ${SANS}`;
  ctx.fillText(String(book.sku ?? ''), centre, barTop + 180, width);

  return canvas.toDataURL('image/png');
}

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checkPasscode, decodeDataUrl, EXTENSIONS, json, type DecodedImage } from "../lib/http.mts";

// The everyday read uses the small model, at a fraction of a cent per book. The seller can
// ask for a careful re-read, which uses the most capable one for edition and value calls.
const QUICK_MODEL = "claude-haiku-5-5";
const CAREFUL_MODEL = "claude-opus-5-5";
const MAX_IMAGES = 4;
export const PHOTO_STORE = "book-photos";

const Point = z.object({
  x: z.number().describe("Fraction of the photo's width, 0 at the left edge to 1 at the right."),
  y: z.number().describe("Fraction of the photo's height, 0 at the top edge to 1 at the bottom."),
});

const BookSchema = z.object({
  title: z.string().describe("Full title including subtitle, in title case. Empty if unreadable."),
  author: z.string().describe("Author(s) as printed, e.g. 'Jane Doe' or 'Jane Doe; John Roe'. Empty if unknown."),
  isbn: z.string().describe("ISBN-13 or ISBN-10, digits only (X allowed as ISBN-10 check digit). Empty if none is visible."),
  publisher: z.string().describe("Publisher of this copy. Empty if unknown."),
  release_year: z.string().describe("Four-digit publication year of this printing/edition. Empty if unknown."),
  edition: z.string().describe("Edition statement in at most 32 characters, e.g. 'First Edition', '1st Ed., 3rd Printing', 'Book Club Edition'. Empty if not determinable from the photos."),
  volume: z.string().describe("Volume number or name for multi-volume works. Empty otherwise."),
  language: z.string().describe("Language of the text, e.g. 'English'."),
  media: z.enum(["Hardcover", "Paperback", "Mass Market Paperback", "Audio CD", "DVD", ""]).describe("Binding or media type. Empty if it cannot be told from the photos."),
  signed: z.boolean().describe("True only if a signature or inscription by the author is visible."),
  condition_notes: z.string().describe("Visible condition points in at most 32 characters, e.g. 'DJ chipped, spine sunned'. Empty if nothing notable is visible."),
  price_estimate: z.number().describe("Suggested used listing price in US dollars for this edition. 0 if the book could not be identified."),
  price_reasoning: z.string().describe("One sentence explaining the price: what drives it and how sure you are."),
  confidence: z.enum(["high", "medium", "low"]).describe("How confident you are that the identification is of the right book and edition."),
  cover_photo: z.number().describe("Number of the photo (1 for the first) that shows the whole front cover most squarely. 0 if no photo shows the whole front cover."),
  cover_corners: z.object({
    top_left: Point,
    top_right: Point,
    bottom_right: Point,
    bottom_left: Point,
  }).describe("The four outer corners of the book in the cover photo, named as the cover reads upright. All zeros when cover_photo is 0."),
  needs: z.string().describe("If something important could not be read, one short sentence saying which photo would help (e.g. 'A photo of the copyright page would confirm the edition'). Empty otherwise."),
});

export type Book = z.infer<typeof BookSchema>;

const SYSTEM = `You catalogue used and rare books for an online bookseller. You are given one to four photos of a single book: typically the front cover, and sometimes the title page, the copyright page, the back cover or the barcode. Your reading goes straight into a listing form that the seller reviews before it is published, so a blank field is better than a guess presented as fact.

Read what is printed in the photos first. Use your own knowledge of the book to fill gaps such as the publisher or year only when you are sure which book and edition this is, and never to override what the photos show.

Edition matters most for value. Work it out from the copyright page when there is one: an explicit edition statement, the number line (the lowest number present is the printing), and the dates. If no copyright page is shown, leave the edition empty unless the cover itself states it, and say in "needs" that a copyright page photo would confirm it.

Only report an ISBN you can actually read in the photos, from the barcode area or the copyright page. Do not recall one from memory. If the seller supplied a scanned barcode ISBN, treat it as correct.

The seller also needs a clean listing image, made by cutting the front cover out of its photo. Pick the photo that shows the whole front cover most squarely and give the four outer corners of the book in it, at the physical edges of the cover or dust jacket rather than the edges of the artwork. If the cover is cut off by the frame or no photo shows it, set cover_photo to 0.

For the price, suggest what a seller would reasonably list this specific edition for in used Very Good condition unless the photos show otherwise. You do not have live market data, so this is an informed estimate: say what it rests on in the reasoning, and lower your confidence for scarce or collectible items where prices vary widely.`;

function isIsbn(value: unknown): value is string {
  return typeof value === "string" && /^(97[89])?\d{9}[\dX]$/i.test(value);
}

async function storePhotos(images: DecodedImage[], skip: boolean[], origin: string): Promise<(string | null)[]> {
  const store = getStore(PHOTO_STORE);
  return Promise.all(
    images.map(async (image, i) => {
      if (skip[i]) return null;
      const name = `${randomUUID()}.${EXTENSIONS[image.mediaType]}`;
      const bytes = image.bytes;
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      await store.set(name, body, { metadata: { type: image.mediaType } });
      return `${origin}/img/${name}`;
    }),
  );
}

async function readBook(images: DecodedImage[], isbnHint: string | null, careful: boolean): Promise<Book> {
  // CLAUDE_ACCESS is an alternative name for the same key, for when Netlify's
  // form objects to a variable that looks like a secret.
  const apiKey = (Netlify.env.get("ANTHROPIC_API_KEY") || Netlify.env.get("CLAUDE_ACCESS") || "").trim();
  if (!apiKey) {
    throw new ReadError("AI reading is not set up yet: add ANTHROPIC_API_KEY to this site's environment variables in Netlify and redeploy.");
  }
  // One attempt inside Netlify's 60 second limit for synchronous functions.
  const client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 0 });

  const instruction = isbnHint
    ? `Catalogue this book. The seller scanned this ISBN from the barcode: ${isbnHint}.`
    : "Catalogue this book.";

  const response = await client.beta.messages.parse({
    model: careful ? CAREFUL_MODEL : QUICK_MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { effort: "medium", format: betaZodOutputFormat(BookSchema) },
    // If the careful model declines a request, the API retries it on a fallback model in the
    // same call. The small model has no such fallback.
    ...(careful ? { betas: ["server-side-fallback-2026-07-01" as const], fallbacks: "default" as const } : {}),
    messages: [
      {
        role: "user",
        content: [
          ...images.map((image) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: image.mediaType, data: image.base64 },
          })),
          { type: "text" as const, text: instruction },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new ReadError("The AI declined to read these photos. Fill the details in by hand.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new ReadError("The AI reading came back incomplete. Try again, or fill the details in by hand.");
  }

  const book = response.parsed_output;
  book.isbn = book.isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
  if (!isIsbn(book.isbn)) book.isbn = "";
  if (isbnHint) book.isbn = isbnHint;
  book.edition = book.edition.slice(0, 32);
  book.condition_notes = book.condition_notes.slice(0, 32);
  book.price_estimate = Math.max(0, Math.round(book.price_estimate * 100) / 100);
  book.cover_photo = Number.isInteger(book.cover_photo) && book.cover_photo >= 1 && book.cover_photo <= images.length ? book.cover_photo : 0;
  return book;
}

/** An error whose message is safe and useful to show the seller. */
class ReadError extends Error {}

function describeError(error: unknown): string {
  if (error instanceof ReadError) return error.message;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return "The ANTHROPIC_API_KEY set in Netlify was rejected. Check the key and redeploy.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "The AI service is rate limiting this key. Wait a moment and try again.";
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return "The AI took too long to answer. Try again, or use fewer photos.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach the AI service. Try again.";
  }
  if (error instanceof Anthropic.APIError) {
    console.error("Anthropic API error", error.status, error.message);
    return `The AI service returned an error (${error.status ?? "unknown"}). Try again.`;
  }
  console.error("Unexpected read error", error);
  return "Something went wrong reading the photos. Try again.";
}

export default async (req: Request): Promise<Response> => {
  const denied = checkPasscode(req);
  if (denied) return denied;

  let payload: { images?: unknown; isbn_hint?: unknown; read?: unknown; store?: unknown; careful?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad_request", message: "Request body must be JSON." }, 400);
  }

  const raw = Array.isArray(payload.images) ? payload.images : [];
  if (raw.length === 0 || raw.length > MAX_IMAGES) {
    return json({ error: "bad_request", message: `Send between 1 and ${MAX_IMAGES} photos.` }, 400);
  }
  const images: DecodedImage[] = [];
  const skip: boolean[] = [];
  for (const entry of raw) {
    const image = decodeDataUrl((entry as { data?: unknown } | null)?.data);
    if (!image) {
      return json({ error: "bad_request", message: "Photos must be JPEG, PNG or WebP." }, 400);
    }
    images.push(image);
    skip.push((entry as { stored?: unknown }).stored === true);
  }

  const isbnHint = isIsbn(payload.isbn_hint) ? payload.isbn_hint.toUpperCase() : null;
  const wantRead = payload.read !== false;
  const wantStore = payload.store !== false;
  const origin = new URL(req.url).origin;

  const [stored, read] = await Promise.allSettled([
    wantStore ? storePhotos(images, skip, origin) : Promise.resolve(images.map(() => null)),
    wantRead ? readBook(images, isbnHint, payload.careful === true) : Promise.resolve(null),
  ]);

  if (stored.status === "rejected") console.error("Photo storage failed", stored.reason);

  return json({
    image_urls: stored.status === "fulfilled" ? stored.value : images.map(() => null),
    storage_error: stored.status === "rejected" ? "Photos could not be saved, so this book will have no image links." : null,
    book: read.status === "fulfilled" ? read.value : null,
    read_error: read.status === "rejected" ? describeError(read.reason) : null,
  });
};

export const config: Config = {
  path: "/api/scan",
  method: "POST",
};

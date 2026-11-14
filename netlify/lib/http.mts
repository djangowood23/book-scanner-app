import { timingSafeEqual } from "node:crypto";

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Optional shared passcode. When the APP_PASSCODE environment variable is set,
 * every API request must send the same value in the `x-app-passcode` header.
 * Returns a 401 response to send back, or null when the request may proceed.
 */
export function checkPasscode(req: Request): Response | null {
  const expected = Netlify.env.get("APP_PASSCODE")?.trim();
  if (!expected) return null;
  // Phone keyboards often leave a stray space after a typed word.
  const given = Buffer.from((req.headers.get("x-app-passcode") ?? "").trim());
  const want = Buffer.from(expected);
  if (given.length === want.length && timingSafeEqual(given, want)) return null;
  return json({ error: "passcode", message: "Wrong or missing passcode." }, 401);
}

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export type DecodedImage = {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
  bytes: Buffer;
};

/** Decode a `data:image/...;base64,` URL. Returns null when it is not one we accept. */
export function decodeDataUrl(value: unknown): DecodedImage | null {
  if (typeof value !== "string") return null;
  const match = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match || !ALLOWED.has(match[1])) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) return null;
  return { mediaType: match[1] as DecodedImage["mediaType"], base64: match[2], bytes };
}

export const EXTENSIONS: Record<DecodedImage["mediaType"], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

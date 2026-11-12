import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { describeError, fallbackParams, makeClient, MODELS, parseQuality, ReadError } from "../lib/claude.mts";
import { checkPasscode, decodeDataUrl, json } from "../lib/http.mts";

const ShelfSchema = z.object({
  location: z.string().describe("The shelf, tub or box label exactly as written, when the photo is of a location label. Empty otherwise."),
  slips: z.array(z.object({
    sku: z.string().describe("The SKU exactly as handwritten on the slip, keeping upper and lower case as written."),
    title: z.string().describe("Title printed on the book this slip is tucked into, if any of it is readable in the photo. Empty otherwise."),
    unsure: z.boolean().describe("True if any character of the SKU could reasonably be read another way."),
  })).describe("One entry per SKU slip visible in the photo, left to right, top to bottom."),
});

export type ShelfReading = z.infer<typeof ShelfSchema>;

const SYSTEM = `You help a used bookseller record where books are shelved. Each book has a paper slip tucked into it, sticking out of the top, with the book's stock number (SKU) handwritten on it. A photo shows one book or a row of books with their slips.

Read every slip you can see and report its SKU exactly as written. SKUs are a short prefix of letters and digits, a dash, then a number, such as K-8906, T-3290, g-8425, RA11-1-5 or 3HA-023. Upper and lower case are different stock numbers, so copy the case you see rather than normalising it. These feed a stock system, so a wrong SKU puts a book in the wrong place: when a character could be read two ways, give your best reading and mark the slip unsure. Leave out a slip you cannot read at all rather than inventing one. Never report printed text on a book (a title, ISBN or price) as a SKU.

For each slip, also give the title of the book it is tucked into when you can read it, as a cross-check.

When asked for a location instead, the photo is of a shelf, tub or box label: report that label exactly as written and return no slips.`;

async function read(image: NonNullable<ReturnType<typeof decodeDataUrl>>, kind: "slips" | "location", quality: keyof typeof MODELS): Promise<ShelfReading> {
  const client = makeClient();
  const response = await client.beta.messages.parse({
    model: MODELS[quality],
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { effort: "medium", format: betaZodOutputFormat(ShelfSchema) },
    ...fallbackParams(quality),
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
          { type: "text", text: kind === "location" ? "Read the location label in this photo." : "Read the SKU slips in this photo." },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new ReadError("The AI declined to read this photo. Type the SKUs in by hand.");
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new ReadError("The reading came back incomplete. Try again with fewer books in the photo.");
  }
  const reading = response.parsed_output;
  reading.location = reading.location.trim();
  reading.slips = reading.slips
    .map((slip) => ({ ...slip, sku: slip.sku.replace(/\s+/g, ""), title: slip.title.trim() }))
    .filter((slip) => slip.sku.length > 0 && slip.sku.length <= 24);
  return reading;
}

export default async (req: Request): Promise<Response> => {
  const denied = checkPasscode(req);
  if (denied) return denied;

  let payload: { image?: unknown; kind?: unknown; quality?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad_request", message: "Request body must be JSON." }, 400);
  }
  const image = decodeDataUrl(payload.image);
  if (!image) return json({ error: "bad_request", message: "Send one JPEG, PNG or WebP photo." }, 400);

  try {
    const reading = await read(image, payload.kind === "location" ? "location" : "slips", parseQuality(payload.quality));
    return json({ ...reading, read_error: null });
  } catch (error) {
    return json({ location: "", slips: [], read_error: describeError(error) });
  }
};

export const config: Config = {
  path: "/api/skus",
  method: "POST",
};

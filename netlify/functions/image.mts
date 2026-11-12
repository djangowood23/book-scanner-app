import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

// Keep in sync with PHOTO_STORE in scan.mts.
const PHOTO_STORE = "book-photos";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * Serves a stored book photo. These URLs go into the exported CSV so the
 * listing tools can fetch the images, which is why this route is public.
 * Names are random UUIDs, so a photo is only reachable by someone given its URL.
 */
export default async (_req: Request, context: Context): Promise<Response> => {
  const name = context.params.name ?? "";
  const match = /^[0-9a-f-]{36}\.(jpg|png|webp)$/.exec(name);
  if (!match) return new Response("Not found", { status: 404 });

  const data = await getStore(PHOTO_STORE).get(name, { type: "arrayBuffer" });
  if (data === null) return new Response("Not found", { status: 404 });

  return new Response(data, {
    headers: {
      "content-type": TYPES[match[1]],
      // A stored photo never changes under its name.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
};

export const config: Config = {
  path: "/img/:name",
  method: "GET",
};

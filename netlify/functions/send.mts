import type { Config } from "@netlify/functions";
import { Client } from "basic-ftp";
import { Readable } from "node:stream";
import { checkPasscode, json } from "../lib/http.mts";

// Files the app produces: new listings and shelf locations.
const FILENAME = /^aob_(export|locations)_\d{14}\.csv$/;
const MAX_BYTES = 2_000_000;

async function upload(name: string, content: string, secure: boolean): Promise<void> {
  const client = new Client(20_000);
  try {
    await client.access({
      host: Netlify.env.get("AOB_FTP_HOST") || "ftp.theartofbooks.com",
      user: Netlify.env.get("AOB_FTP_USER"),
      password: Netlify.env.get("AOB_FTP_PASSWORD"),
      secure,
    });
    const folder = (Netlify.env.get("AOB_FTP_DIR") || "").replace(/^\/+|\/+$/g, "");
    if (folder) await client.cd(folder);
    await client.uploadFrom(Readable.from(Buffer.from(content, "utf8")), name);
  } finally {
    client.close();
  }
}

/**
 * Delivers an inventory file to The Art of Books over FTP, where AOB picks it up on its
 * next cycle. Because this writes to the seller's live inventory, it refuses to run
 * unless the site has a passcode set.
 */
export default async (req: Request): Promise<Response> => {
  if (!Netlify.env.get("APP_PASSCODE")) {
    return json({ sent: false, message: "Sending to AOB is switched off until a passcode is set for this site (APP_PASSCODE in Netlify)." });
  }
  const denied = checkPasscode(req);
  if (denied) return denied;

  if (!Netlify.env.get("AOB_FTP_USER") || !Netlify.env.get("AOB_FTP_PASSWORD")) {
    return json({ sent: false, message: "Sending to AOB is not set up yet: the AOB FTP login has not been added in Netlify." });
  }

  let payload: { filename?: unknown; content?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad_request", message: "Request body must be JSON." }, 400);
  }
  const { filename, content } = payload;
  if (typeof filename !== "string" || !FILENAME.test(filename)) {
    return json({ error: "bad_request", message: "Unexpected file name." }, 400);
  }
  if (typeof content !== "string" || !content.startsWith("sku,") || Buffer.byteLength(content) > MAX_BYTES) {
    return json({ error: "bad_request", message: "That does not look like an inventory file." }, 400);
  }

  try {
    try {
      await upload(filename, content, true);
    } catch (secureError) {
      // Older FTP servers do not offer an encrypted connection; fall back to a plain one.
      console.warn("Encrypted FTP failed, retrying without encryption", secureError);
      await upload(filename, content, false);
    }
    return json({ sent: true, message: null });
  } catch (error) {
    console.error("AOB upload failed", error);
    const code = (error as { code?: number }).code;
    const message = code === 530
      ? "AOB rejected the FTP login. Check the username and password saved in Netlify."
      : "The file could not be delivered to AOB. Use Export instead and upload it by hand.";
    return json({ sent: false, message });
  }
};

export const config: Config = {
  path: "/api/send",
  method: "POST",
};

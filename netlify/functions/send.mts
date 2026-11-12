import type { Config } from "@netlify/functions";
import SftpClient from "ssh2-sftp-client";
import { checkPasscode, json } from "../lib/http.mts";

// Files the app produces: new listings and shelf locations.
const FILENAME = /^aob_(export|locations)_\d{14}\.csv$/;
const MAX_BYTES = 2_000_000;

async function upload(name: string, content: string): Promise<string> {
  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: Netlify.env.get("AOB_FTP_HOST") || "ftp.theartofbooks.com",
      port: Number(Netlify.env.get("AOB_FTP_PORT")) || 22,
      username: Netlify.env.get("AOB_FTP_USER"),
      password: Netlify.env.get("AOB_FTP_PASSWORD"),
      readyTimeout: 20_000,
    });
    // AOB watches a folder for inventory files. Use the configured one if set, otherwise
    // an inventory inbox if the account has one, otherwise the main directory.
    let folder = (Netlify.env.get("AOB_FTP_DIR") || "").replace(/^\/+|\/+$/g, "");
    if (!folder) {
      const entries = await sftp.list(".");
      console.log("AOB folders:", entries.filter((entry) => entry.type === "d").map((entry) => entry.name).join(", ") || "(none)");
      folder = entries.find((entry) => entry.type === "d" && /^inv/i.test(entry.name) && !/down/i.test(entry.name))?.name ?? "";
    }
    const path = folder ? `${folder}/${name}` : name;
    await sftp.put(Buffer.from(content, "utf8"), path);
    return path;
  } finally {
    await sftp.end().catch(() => {});
  }
}

/**
 * Delivers an inventory file to The Art of Books over SFTP, where AOB picks it up on its
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
    return json({ sent: false, message: "Sending to AOB is not set up yet: the AOB SFTP login has not been added in Netlify." });
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
    const path = await upload(filename, content);
    console.log("Delivered to AOB:", path);
    return json({ sent: true, message: null });
  } catch (error) {
    console.error("AOB upload failed", error);
    const level = (error as { level?: string }).level;
    const message = level === "client-authentication" || /authentication/i.test(String((error as Error).message))
      ? "AOB rejected the login. Check the username and password saved in Netlify."
      : "The file could not be delivered to AOB. Use Export instead and upload it by hand.";
    return json({ sent: false, message });
  }
};

export const config: Config = {
  path: "/api/send",
  method: "POST",
};

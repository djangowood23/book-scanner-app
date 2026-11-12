import Anthropic from "@anthropic-ai/sdk";

// The seller picks the reading quality in Settings. "best" is the default because edition
// and price calls matter most; the others trade some judgement for a lower cost per read.
export const MODELS = {
  best: "claude-opus-5-5",
  balanced: "claude-sonnet-5-5",
  cheapest: "claude-haiku-5-5",
} as const;
export type Quality = keyof typeof MODELS;

export function parseQuality(value: unknown): Quality {
  return typeof value === "string" && value in MODELS ? (value as Quality) : "best";
}

/**
 * If the model declines a request, the API retries it on a fallback model in the same
 * call. The smallest model has no such fallback.
 */
export function fallbackParams(quality: Quality) {
  return quality === "cheapest" ? {} : { betas: ["server-side-fallback-2026-07-01" as const], fallbacks: "default" as const };
}

export function makeClient(): Anthropic {
  // CLAUDE_ACCESS is an alternative name for the same key, for when Netlify's
  // form objects to a variable that looks like a secret.
  const apiKey = (Netlify.env.get("ANTHROPIC_API_KEY") || Netlify.env.get("CLAUDE_ACCESS") || "").trim();
  if (!apiKey) {
    throw new ReadError("AI reading is not set up yet: add ANTHROPIC_API_KEY to this site's environment variables in Netlify and redeploy.");
  }
  // One attempt inside Netlify's 60 second limit for synchronous functions.
  return new Anthropic({ apiKey, timeout: 50_000, maxRetries: 0 });
}

/** An error whose message is safe and useful to show the seller. */
export class ReadError extends Error {}

export function describeError(error: unknown): string {
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

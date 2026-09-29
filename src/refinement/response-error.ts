/** Error carrying the provider response (or error details) that caused
 *  it, so the frontend's error modal can offer a "View response" pane.
 *  Lets the user tell a provider-side failure (rate limit, filter,
 *  empty completion) apart from a genuine output-format problem. */
export class HoneResponseError extends Error {
  readonly raw: unknown;
  constructor(message: string, raw: unknown) {
    super(message);
    this.name = "HoneResponseError";
    this.raw = raw;
  }
}

/** Cap on the serialized payload shipped to the frontend. Completions
 *  are plain text so this is generous; it only guards against a
 *  pathological response flooding the backend->frontend channel. */
const MAX_RAW_CHARS = 200_000;

/** Plain-object view of a thrown value: `JSON.stringify` drops an
 *  Error's non-enumerable `name`/`message`/`stack`, and host errors often
 *  hang provider details (status, body) off extra fields or `cause`. */
export function describeThrown(err: unknown, depth = 0): unknown {
  if (!(err instanceof Error)) return err;
  const out: Record<string, unknown> = { name: err.name, message: err.message };
  for (const key of Object.keys(err)) {
    out[key] = (err as unknown as Record<string, unknown>)[key];
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined && depth < 3) out.cause = describeThrown(cause, depth + 1);
  return out;
}

/** Pretty-printed JSON of the raw payload attached to `err`, or
 *  undefined when the error carries none. */
export function formatRawForError(err: unknown): string | undefined {
  if (!(err instanceof HoneResponseError) || err.raw === undefined) return undefined;
  let text: string;
  try {
    text = JSON.stringify(err.raw, null, 2) ?? String(err.raw);
  } catch (e) {
    text = `[unserializable: ${e instanceof Error ? e.message : String(e)}]`;
  }
  if (text.length > MAX_RAW_CHARS) {
    text = `${text.slice(0, MAX_RAW_CHARS)}\n… [truncated ${text.length - MAX_RAW_CHARS} chars]`;
  }
  return text;
}

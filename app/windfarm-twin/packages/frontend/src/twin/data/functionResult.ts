/**
 * What a function of the app returned, as the shape the page expects.
 *
 * The functions return JSON text. The Rayfin client parses JSON text by itself before it hands the
 * answer over (`FunctionClient.invoke` of `@microsoft/rayfin-functions`: "Auto-parse JSON-encoded
 * output strings"), so the page normally receives the object, not the text. Both are accepted: the
 * object as it is, text parsed here. The first deployment showed only "did not return JSON", because
 * the page parsed a second time what was already an object.
 */
export function fromFunction<T>(value: unknown, name: string): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      throw new Error(`The function ${name} did not return JSON. It returned: ${value.slice(0, 200)}`);
    }
  }
  if (value === null || value === undefined || typeof value !== 'object') {
    throw new Error(`The function ${name} returned ${value === undefined ? 'nothing' : String(value)}.`);
  }
  return value as T;
}

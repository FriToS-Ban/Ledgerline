/** Only same-origin relative paths are allowed as a post-login target (no open redirect). */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  // control characters or backslashes can be normalised into "//host" by some browsers
  if (/[\u0000-\u001f\\]/.test(raw)) return "/";
  return raw;
}

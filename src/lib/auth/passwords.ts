/** Hard cap so a megabyte "password" can't be used to burn CPU in scrypt. */
export const MAX_PASSWORD_LENGTH = 128;

export const MIN_PASSWORD_LENGTH = 10;

/**
 * Passwords that show up at the top of every breach list (lower-cased). Anything here, or a
 * case-insensitive match after stripping trailing digits/symbols, is refused.
 */
const COMMON = new Set(
  `password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword qwerty qwerty123 qwertyuiop
  qwertyuiop1 qwerty12345 1q2w3e4r 1q2w3e4r5t 1q2w3e4r5t6y q1w2e3r4t5 q1w2e3r4t5y6 zaq12wsx zaq1zaq1 1qaz2wsx
  asdfghjkl asdfghjkl1 asdf1234 zxcvbnm zxcvbnm123 iloveyou iloveyou1 letmein letmein123 welcome welcome1 welcome123
  admin admin123 admin1234 administrator changeme changeme123 default monkey dragon football baseball basketball
  superman batman trustno1 sunshine princess master master123 shadow michael jennifer jordan23 starwars whatever
  freedom ninja mustang access abc123 abcd1234 abcdefg abcdefgh abcdefghij secret secret123 login login123
  computer internet hello123 helloworld hello1234 summer2024 summer2025 summer2026 winter2024 winter2025 winter2026
  spring2025 autumn2025 qazwsxedc qazwsx123 mypassword mypassword1 yourpassword passwordpassword pa55word pa55w0rd
  ledgerline ledgerline1 ledgerline123 invoice invoice123 invoices accounting accounts payable payables finance
  finance123 company company123 business business123 manager manager123 office office123 temp1234 temporary
  test1234 testtest testing123 user1234 guest1234 root1234 toor1234 server123 database pokemon minecraft
  liverpool chelsea arsenal barcelona realmadrid charlie charlie123 thomas thomas123 daniel daniel123 andrew
  computer1 cheese pepper ginger cookie soccer hockey killer hunter hunter2 buster tigger jessica ashley
  nicole matrix internet1 samsung google google123 facebook microsoft apple123 iphone android lovely loveme
  babygirl angel angel123 flower sweety blink182 metallica corvette ferrari mercedes porsche harley`.split(/\s+/),
);

const KEYBOARD_ROWS = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm", "abcdefghijklmnopqrstuvwxyz"];

function isSequence(pw: string) {
  const s = pw.toLowerCase();
  for (const row of KEYBOARD_ROWS) {
    const both = row + row; // allow wrap-around like "7890123456"
    const rev = [...both].reverse().join("");
    if (both.includes(s) || rev.includes(s)) return true;
  }
  return false;
}

/**
 * Returns why `pw` is not acceptable, or null when it is. Rules: 10..128 characters, at least 4
 * distinct characters, not a keyboard/alphabet run, not a common password (also after stripping
 * trailing digits/symbols, so "Password2026!" is refused), and not built from the email.
 */
export function passwordProblem(pw: string, ctx: { email?: string; name?: string } = {}): string | null {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (pw.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  const lower = pw.toLowerCase();
  if (new Set(lower).size < 4) return "Use more than a few different characters.";
  if (isSequence(lower)) return "Avoid keyboard or alphabet runs like 1234567890 or qwertyuiop.";
  const core = lower.replace(/[^a-z]+$/g, "").replace(/^[^a-z]+/g, "");
  const leet = core.replace(/0/g, "o").replace(/[1!]/g, "i").replace(/3/g, "e").replace(/[4@]/g, "a").replace(/\$|5/g, "s");
  if (COMMON.has(lower) || COMMON.has(core) || COMMON.has(leet) || (core.length >= 3 && /^(.+?)\1+$/.test(lower))) {
    return "That password is too common or too easy to guess.";
  }
  const local = ctx.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && lower.includes(local)) return "Don't build your password from your email.";
  const name = ctx.name?.trim().toLowerCase();
  if (name && name.length >= 4 && lower.includes(name.replace(/\s+/g, ""))) return "Don't build your password from your name.";
  return null;
}

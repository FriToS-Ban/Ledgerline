/**
 * Indian GST identity checks. A GSTIN is 15 characters: 2-digit state code, the holder's 10-char
 * PAN, an entity number, "Z" by default, and a mod-36 check character. A fabricated or mistyped
 * GSTIN fails the checksum, and input-tax credit cannot be claimed against it.
 */

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka",
  "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
  "97": "Other Territory", "99": "Centre Jurisdiction",
};

const FORMAT = /^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$/;

export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARSET.indexOf(first14[i]);
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

export type GstinCheck =
  | { valid: true; gstin: string; stateCode: string; state: string; pan: string }
  | { valid: false; gstin: string; reason: string };

export function validateGstin(raw: string): GstinCheck {
  const gstin = raw.replace(/\s/g, "").toUpperCase();
  const m = gstin.match(FORMAT);
  if (!m) return { valid: false, gstin, reason: "not in GSTIN format (15 characters: state, PAN, entity, Z, check)" };
  if (!GST_STATES[m[1]]) return { valid: false, gstin, reason: `unknown state code ${m[1]}` };
  const expected = gstinCheckChar(gstin.slice(0, 14));
  if (expected !== gstin[14]) return { valid: false, gstin, reason: `check character should be ${expected}, not ${gstin[14]}` };
  return { valid: true, gstin, stateCode: m[1], state: GST_STATES[m[1]], pan: m[2] };
}

/** "Uttarakhand(5)", "Uttarakhand (05)", "05-Uttarakhand" or a state name → two-digit code. */
export function placeOfSupplyCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const num = raw.match(/\((\d{1,2})\)|^(\d{2})\b/);
  const n = num?.[1] ?? num?.[2];
  if (n) return n.padStart(2, "0");
  const name = raw.replace(/[^a-z ]/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const hit = Object.entries(GST_STATES).find(([, s]) => s.toLowerCase() === name);
  return hit?.[0] ?? null;
}

/** Which GST heads the bill charges: intra-state = CGST + SGST/UTGST, inter-state = IGST. */
export function gstHeads(text: string): { intra: boolean; inter: boolean } {
  return { intra: /\b(?:CGST|SGST|UTGST)\b/i.test(text), inter: /\bIGST\b/i.test(text) };
}

import type { DocumentSlice, ExtraField, Extraction, LineItem, Party } from "@/lib/invoice/schema";
import { round2 } from "@/lib/utils";
import { parseBankDetails } from "@/lib/invoice/bank";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;
const PDF_EXT = /\.pdf$/i;

export function isImageFilename(name?: string): boolean {
  return !!name && IMAGE_EXT.test(name);
}

export function isPdfFilename(name?: string): boolean {
  return !!name && PDF_EXT.test(name);
}

export function sniffKind(filename?: string, bytes?: Uint8Array): "pdf" | "image" | "unknown" {
  if (filename && isImageFilename(filename)) return "image";
  if (filename && isPdfFilename(filename)) return "pdf";
  if (bytes && bytes.length >= 5) {
    const head = String.fromCharCode(...bytes.slice(0, 5));
    if (head.startsWith("%PDF")) return "pdf";
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image";
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image";
    if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image";
  }
  return "unknown";
}

function grab(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m?.[1]?.trim() || null;
}

/** Drop the next PDF label when text is flattened onto one line. */
export function cleanPersonName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const name = raw
    .replace(/\s+/g, " ")
    .replace(
      /\b(delivery address|gstin|place of supply|invoice (?:no|number|date)|customer details|unregistered)\b.*$/i,
      "",
    )
    .replace(/[:#]+$/g, "")
    .trim();
  return name.length >= 2 ? name : null;
}

function customerNameFrom(text: string): string | null {
  return cleanPersonName(
    grab(
      text,
      /Customer(?:\s+Name)?\s*[:#]?\s*([A-Za-z][A-Za-z'.-]+(?:\s+[A-Za-z][A-Za-z'.-]+){0,4})(?=\s+(?:Delivery|GSTIN|Place|Invoice|Customer Details)|\s{2,}|\n|$)/i,
    ) ?? grab(text, /Customer(?:\s+Name)?\s*[:#]?\s*([A-Za-z][A-Za-z .']{2,80})/i),
  );
}

function parseMoney(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/₹/g, "").replace(/Rs\.?/gi, "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? round2(n) : null;
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) {
    const dd = dmy[1].padStart(2, "0");
    const mm = dmy[2].padStart(2, "0");
    return `${dmy[3]}-${mm}-${dd}`;
  }
  return raw;
}

function looksInr(text: string): boolean {
  return /₹|INR|rupee|gstin|cgst|sgst|igst|swiggy|zomato|eternal limited/i.test(text);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "21 Oct 2026" / "Oct 21, 2026" -> ISO. A trailing "?" means the scan was unsure: refuse. */
function monthNameDate(text: string): string | null {
  const dmy = text.match(/\bDate[ \t]*[:#]?[ \t]*(\d{1,2})[ \t]+([A-Za-z]{3})[a-z]*\.?,?[ \t]+(\d{4})(?![ \t]*\?)/i);
  const mdy = text.match(/\bDate[ \t]*[:#]?[ \t]*([A-Za-z]{3})[a-z]*\.?[ \t]+(\d{1,2}),?[ \t]+(\d{4})(?![ \t]*\?)/i);
  const parts = dmy ? [dmy[1], dmy[2], dmy[3]] : mdy ? [mdy[2], mdy[1], mdy[3]] : null;
  if (!parts) return null;
  const m = MONTHS.indexOf(parts[1].toLowerCase());
  if (m < 0) return null;
  return `${parts[2]}-${String(m + 1).padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
}

const BANNER = /scanned|copy|degraded|invoice|statement|page \d|^date\b|^total\b|^tel\b|^www\./i;

/** First plausible company-name line near the top of a B2B invoice. */
function vendorFromLines(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\t+/g, " ").trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    if (BANNER.test(line) || /[:?]/.test(line) || /^\d/.test(line)) continue;
    if (/^[A-Za-z][A-Za-z0-9 .,&'-]{2,60}$/.test(line)) return line;
  }
  return null;
}

/** Table rows between the "Description ... Amount" header and the Subtotal/Total line. */
function tableLines(text: string, taxIncluded: boolean): LineItem[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\t+/g, " ").trim());
  const start = lines.findIndex((l) => /^description\b.*\bamount\b/i.test(l));
  if (start < 0) return [];
  const items: LineItem[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^(sub\s*total|tax|shipping|freight|total|note)\b/i.test(line)) break;
    const po = line.match(/^PO[ \t]+(PO-[A-Z0-9-]+)$/i);
    if (po && items.length) {
      items[items.length - 1].poNumber = po[1].toUpperCase();
      continue;
    }
    const m = line.match(/^(.+?)[ \t]+(-?\d[\d,]*\.\d{2})$/);
    if (!m) continue;
    items.push({
      id: `l${items.length + 1}`,
      description: m[1].trim(),
      quantity: null,
      unitPrice: null,
      amount: round2(Number(m[2].replace(/,/g, ""))),
      taxIncluded,
    });
  }
  return items;
}

export function parseInvoiceText(text: string): Extraction {
  // [ \t] not \s: a label must never match across a line break ("Invoice" + next line's "Northwind").
  const invoiceNumber =
    grab(text, /Invoice[ \t]*(?:No\b\.?|Number|#)[ \t]*[:#.]?[ \t]*([A-Z0-9][A-Z0-9/-]{3,})/i) ??
    grab(text, /\bInv(?:oice)?[ \t]*ID[ \t]*[:#]?[ \t]*([A-Z0-9][A-Z0-9/-]{3,})/i);

  const invoiceDate = normalizeDate(
    grab(text, /Invoice[ \t]*Date[ \t]*[:#]?[ \t]*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{2,4})/i) ??
      grab(text, /\bDate[ \t]*[:#]?[ \t]*([0-9]{4}-[0-9]{2}-[0-9]{2})/i) ??
      grab(text, /\bDate[ \t]*[:#]?[ \t]*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{4})/i) ??
      monthNameDate(text),
  );

  const vendorName =
    grab(text, /Legal Entity Name\s*[:#]?\s*(.+?)(?=\s{2,}Restaurant Name|\s+Restaurant Name|\s+GSTIN|\n)/i) ??
    grab(text, /Restaurant Name\s*[:#]?\s*(.+?)(?=\s{2,}Restaurant Address|\s+Restaurant Address|\n)/i) ??
    grab(text, /(?:Sold by|Merchant|Vendor|From)[ \t]*[:#][ \t]*([^\n]+)/i) ??
    (looksInr(text) ? null : vendorFromLines(text)) ??
    grab(text, /(Barbeque Nation Hospitality Ltd\.?)/i) ??
    grab(text, /(Barbeque Nation)/i) ??
    grab(text, /(Swiggy(?: Instant)?(?: Pvt\.? Ltd\.?)?)/i) ??
    grab(text, /(ETERNAL LIMITED|Zomato Limited|Zomato)/i) ??
    vendorFromLines(text) ??
    "Unknown vendor";

  const orderId =
    grab(text, /Order\s*ID\s*[:#]?\s*([0-9]{6,})/i) ??
    grab(text, /against Order ID:\s*([0-9]{6,})/i);

  const poNumbers = [
    // Whole token incl. prefix (PO-7701), so "PO: PO-7701, PO-7702" can't yield a stray "7702".
    ...[...text.matchAll(/\bPO-[A-Z0-9][A-Z0-9-]*/gi)].map((m) => m[0].toUpperCase()),
    ...[...text.matchAll(/\bPO[ \t]*(?:no\.?|number|#)[ \t]*[:#]?[ \t]*(\d[A-Z0-9-]{2,})/gi)].map(
      (m) => `PO-${m[1].toUpperCase()}`,
    ),
    ...(orderId ? [orderId] : []),
  ].filter((p) => !/none|wered/i.test(p));

  const uniquePos = [...new Set(poNumbers)];

  const total =
    parseMoney(grab(text, /Amount of INR\s*([0-9,.]+)/i)) ??
    parseMoney(grab(text, /Amount of\s*₹\s*([0-9,.]+)/i)) ??
    parseMoney(grab(text, /Total Value[^\n]*?([0-9]+(?:\.[0-9]+)?)\s*$/im)) ??
    parseMoney(grab(text, /Grand\s*Total\s*[:#]?\s*₹?\s*([0-9,.]+)/i)) ??
    parseMoney(grab(text, /Amount Payable\s*[:#]?\s*₹?\s*([0-9,.]+)/i)) ??
    parseMoney(grab(text, /(?<![A-Za-z])Total[ \t]*:[ \t]*[$€£]?([0-9][0-9,]*\.?[0-9]*)/i));

  const subtotal =
    parseMoney(grab(text, /Item\(s\)\s*Total[^\n]*?\s([0-9]+(?:\.[0-9]+)?)\s*$/im)) ??
    parseMoney(grab(text, /Sub[ \t]?total[ \t]*[:#]?[ \t]*[₹$€£]?[ \t]*([0-9][0-9,]*\.?[0-9]*)/i));

  const gstTax = (() => {
    const row = text.match(/Total Value[ \t]+[0-9.]+[ \t]+([0-9.]+)[ \t]+([0-9.]+)[ \t]+[0-9.]+[ \t]*$/im);
    return row ? round2(Number(row[1]) + Number(row[2])) : null;
  })();
  const tax =
    gstTax ??
    parseMoney(grab(text, /(?:^|\n)[ \t]*Tax[ \t]*[:#]?[ \t]*[₹$€£]?[ \t]*([0-9][0-9,]*\.?[0-9]*)/i)) ??
    parseMoney(grab(text, /Total Tax\s*[:#]?\s*₹?\s*([0-9,.]+)/i));

  const shipping =
    parseMoney(grab(text, /Packaging Charge\s+([0-9]+(?:\.[0-9]+)?)/i)) ??
    parseMoney(grab(text, /Packaging Charge[\s\S]{0,80}?\s([0-9]+\.[0-9]{2})[ \t]+0\.00[ \t]/i)) ??
    parseMoney(grab(text, /(?:Shipping|Freight)[ \t]*[:#]?[ \t]*[₹$€£]?[ \t]*([0-9][0-9,]*\.?[0-9]*)/i));

  const lineItems: LineItem[] = [];
  // The row total is the LAST number of the row ("... 2.5% 5.35 224.7"); it may have 1-3 decimals,
  // so the amount must not be followed by more digits, a dot or a "%".
  const qtyLines = [
    ...text.matchAll(
      /(\d+)\s*x\s+([A-Za-z][A-Za-z0-9 ,&'()/+-]{2,70}?)\s+(?:[\d.]+\s*%?\s+){0,10}(\d+\.\d{1,3})(?![\d.%])/g,
    ),
  ];
  let i = 0;
  for (const m of qtyLines) {
    const amount = Number(m[3]);
    if (!Number.isFinite(amount)) continue;
    lineItems.push({
      id: `l${++i}`,
      description: m[2].replace(/\s+/g, " ").replace(/[-+\s]+$/, "").trim(),
      quantity: Number(m[1]),
      unitPrice: null,
      amount: round2(amount),
      taxIncluded: looksInr(text),
    });
  }
  if (!lineItems.length) {
    lineItems.push(...tableLines(text, /tax incl|vat included|incl(?:uding)?\.? tax/i.test(text)));
  }
  // Platform fee belongs on the separate marketplace invoice (slices), not the restaurant total.

  const currency = looksInr(text) ? "INR" : (grab(text, /Currency:\s*([A-Z]{3})/i) ?? "USD");

  const extras: ExtraField[] = [];
  const pushExtra = (key: string, label: string, value: string | null, kind: ExtraField["kind"] = "text") => {
    if (!value) return;
    extras.push({ key, label, value: value.replace(/\s+/g, " ").trim(), kind });
  };

  const gstins = [...text.matchAll(/\bGSTIN\s*[:#]?\s*([0-9A-Z]{15})/gi)].map((m) => m[1]);
  if (gstins[0]) pushExtra("seller_gstin", "Seller GSTIN", gstins[0], "tax");
  if (gstins[1]) pushExtra("platform_gstin", "Platform GSTIN", gstins[1], "tax");
  pushExtra("hsn", "HSN", grab(text, /HSN Code\s*[:#]?\s*([0-9]{4,8})/i), "id");
  pushExtra("fssai", "FSSAI", grab(text, /FSSAI\s*[:#]?\s*([0-9]{8,14})/i), "id");
  const customerName = customerNameFrom(text);
  pushExtra("customer", "Customer", customerName);
  pushExtra("order_id", "Order ID", orderId, "id");
  pushExtra(
    "place_of_supply",
    "Place of supply",
    grab(text, /Place of Supply[:\s]*([A-Za-z][A-Za-z ]+\(?\d{0,2}\)?)/i),
  );

  const marketplace =
    grab(text, /(ETERNAL LIMITED[^\n]{0,40}|Zomato Limited|Swiggy)/i) ??
    (/zomato|eternal limited/i.test(text) ? "Eternal Limited (Zomato)" : null);
  const buyer = customerName;
  const parties: Party[] = [
    { role: "seller", name: vendorName.replace(/\s+/g, " ").trim(), taxId: gstins[0] ?? null },
  ];
  if (marketplace) {
    parties.push({
      role: "marketplace",
      name: marketplace.replace(/\s+/g, " ").trim(),
      taxId: gstins[1] ?? null,
    });
  }
  if (buyer) parties.push({ role: "buyer", name: buyer.trim() });

  const secondInvoice = [...text.matchAll(/Invoice\s*No\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9/-]{4,})/gi)]
    .map((m) => m[1])
    .find((n) => n !== invoiceNumber);
  const platformTotal = parseMoney(grab(text, /Amount of\s*₹\s*([0-9,.]+)/i));
  const slices: DocumentSlice[] = [];
  if (invoiceNumber && total != null) {
    slices.push({
      title: vendorName.replace(/\s+/g, " ").trim(),
      invoiceNumber,
      total,
      currency,
      note: orderId ? `Against order ${orderId}` : undefined,
    });
  }
  if (secondInvoice && platformTotal != null && platformTotal !== total) {
    slices.push({
      title: marketplace?.replace(/\s+/g, " ").trim() || "Platform fee",
      invoiceNumber: secondInvoice,
      total: platformTotal,
      currency,
      note: "Separate platform invoice in the same file",
    });
  }

  const documentKind =
    slices.length > 1
      ? "mixed_pack"
      : marketplace && /swiggy|zomato|eternal/i.test(marketplace)
        ? "marketplace_invoice"
        : invoiceNumber
          ? "supplier_invoice"
          : "unknown";

  return {
    source: "digital",
    documentKind,
    vendorName: vendorName.replace(/\s+/g, " ").trim(),
    vendorConfidence: vendorName === "Unknown vendor" ? 0.4 : 0.9,
    invoiceNumber,
    invoiceNumberConfidence: invoiceNumber ? 0.92 : 0.2,
    invoiceDate,
    invoiceDateConfidence: invoiceDate ? 0.92 : 0.2,
    currency,
    poNumbers: uniquePos,
    lineItems,
    subtotal,
    tax,
    shipping,
    total,
    totalConfidence: total != null ? 0.93 : 0.2,
    annotations: orderId ? [`order:${orderId}`] : [],
    parties,
    extras,
    slices,
    pageCount: 1,
    bankDetails: parseBankDetails(text),
    classification: { digitalPages: 1, scannedPages: 0, mixed: false },
    rawText: text,
  };
}

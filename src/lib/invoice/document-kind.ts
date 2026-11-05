import type { Extraction } from "./schema";

export function isMarketplaceDocument(x: Extraction): boolean {
  if (
    x.documentKind === "marketplace_invoice" ||
    x.documentKind === "mixed_pack" ||
    x.documentKind === "order_receipt"
  ) {
    return true;
  }
  const blob = [
    x.vendorName,
    ...(x.parties ?? []).map((p) => p.name),
    ...(x.extras ?? []).map((e) => `${e.label} ${e.value}`),
    x.rawText ?? "",
  ].join(" ");
  return /zomato|swiggy|eternal limited|barbeque nation|restaurant gstin|platform fee|taco bell restro|burger singh/i.test(
    blob,
  );
}

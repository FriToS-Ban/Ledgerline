import { NextResponse } from "next/server";
import { computeAccuracy } from "@/lib/accuracy";
import { requireSignedIn } from "@/lib/auth/users";

export async function GET() {
  const unauth = await requireSignedIn();
  if (unauth) return unauth;
  return NextResponse.json(await computeAccuracy());
}

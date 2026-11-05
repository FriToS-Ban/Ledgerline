import { NextResponse } from "next/server";
import { computeAccuracy } from "@/lib/accuracy";

export async function GET() {
  return NextResponse.json(await computeAccuracy());
}

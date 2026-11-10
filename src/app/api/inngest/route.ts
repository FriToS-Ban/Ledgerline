import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { inngestFunctions } from "@/inngest/functions";
import { inngestDevBlocked } from "@/inngest/dev-guard";

const handlers = serve({
  client: inngest,
  functions: inngestFunctions,
});

// In production the SDK verifies INNGEST_SIGNING_KEY signatures (required by lib/env.ts). In dev the
// SDK skips verification, so state-changing calls are refused unless INNGEST_DEV=1 (or signed).
const guard = (h: (req: Request, ctx: unknown) => Promise<Response>) => async (req: Request, ctx: unknown) =>
  inngestDevBlocked(req.method, req.headers)
    ? Response.json({ error: "unsigned Inngest call refused; set INNGEST_DEV=1 for local dev" }, { status: 403 })
    : h(req, ctx);

export const GET = handlers.GET;
export const POST = guard(handlers.POST as never);
export const PUT = guard(handlers.PUT as never);

import { z } from "zod";
import { NextResponse } from "next/server";
import { MAX_PASSWORD_LENGTH, passwordProblem } from "./passwords";
import { ORG_ROLES } from "./roles";

const email = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.email({ message: "Enter a valid email address." }).max(254, { message: "Email is too long." }),
);

export const loginSchema = z.object({
  email: z.string({ message: "Email and password are required." }).trim().min(1, { message: "Email and password are required." }).max(254),
  password: z
    .string({ message: "Email and password are required." })
    .min(1, { message: "Email and password are required." })
    .max(MAX_PASSWORD_LENGTH * 8),
});

export const registerSchema = z
  .object({
    email,
    name: z
      .string({ message: "Enter your name." })
      .trim()
      .min(1, { message: "Enter your name." })
      .max(80, { message: "Name is too long (80 characters max)." }),
    password: z.string({ message: "Choose a password." }),
    /** Optional one-time setup secret (BOOTSTRAP_ADMIN_TOKEN) that makes this account the first admin. */
    bootstrapToken: z.string({ message: "Setup token must be text." }).max(512).optional(),
    /** Optional invite token: joins the inviting organization instead of creating a personal one. */
    inviteToken: z.string({ message: "Invite token must be text." }).max(512).optional(),
  })
  .superRefine((v, ctx) => {
    const problem = passwordProblem(v.password, { email: v.email, name: v.name });
    if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: problem });
  });

export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ message: "Enter your current password." })
    .min(1, { message: "Enter your current password." })
    .max(MAX_PASSWORD_LENGTH * 8),
  newPassword: z.string({ message: "Choose a new password." }),
});

export const roleChangeSchema = z.object({
  email: z.string({ message: "email is required" }).trim().toLowerCase().min(1, { message: "email is required" }),
  role: z.enum(ORG_ROLES, { message: `role must be one of: ${ORG_ROLES.join(", ")}` }),
});

/** Field -> first message, for form UIs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const k = String(issue.path[0] ?? "form");
    out[k] ??= issue.message;
  }
  return out;
}

/** 400 with `{ error, fields }`; `error` is the first field message. */
export function validationError(error: z.ZodError) {
  const fields = fieldErrors(error);
  return NextResponse.json({ error: Object.values(fields)[0] ?? "Invalid request", fields }, { status: 400 });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

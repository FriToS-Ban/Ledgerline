import { NextRequest, NextResponse } from "next/server";
import { COOKIE, createToken, verifyPassword } from "@/lib/auth/session";
import { findUser } from "@/lib/auth/users";

export async function POST(req: NextRequest) {
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const user = email && password ? await findUser(email) : null;
  // Same message for unknown user and wrong password.
  if (!user || !verifyPassword(password!, user.hash)) {
    return NextResponse.json({ error: "Email or password is incorrect" }, { status: 401 });
  }
  const res = NextResponse.json({ email: user.email, name: user.name, role: user.role });
  res.cookies.set(COOKIE, createToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return res;
}

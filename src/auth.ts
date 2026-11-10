import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/cookies";
import { authenticate } from "@/lib/auth/credentials";
import { clientIp } from "@/lib/auth/net";
import type { Role } from "@/lib/auth/roles";
import { authSecret } from "@/lib/auth/secret";
import { type AppClaims, initialClaims, refreshClaims, SESSION_MAX_AGE_S } from "@/lib/auth/token";
import type { OrgRole } from "@/lib/auth/users";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

declare module "next-auth" {
  interface Session {
    userId: string;
    activeOrgId: string;
    orgRole: OrgRole;
    role: Role;
  }
}

/** Surfaced to the login UI as `code` (`locked:<seconds>`) so it can show the lockout countdown. */
class LockedError extends CredentialsSignin {
  constructor(seconds: number) {
    super();
    this.code = `locked:${seconds}`;
  }
}

/**
 * Auth.js (next-auth v5). Credentials sign-in cannot use database sessions, so sessions are JWTs
 * (in an httpOnly cookie) and revocation is a `token_version` on the user that the `jwt` callback
 * compares on every read (see lib/auth/token.ts). The Drizzle adapter owns the Auth.js tables.
 *
 * The config is a function so it is built per request, never at import/build time: AUTH_SECRET is
 * checked when first used, not when `next build` collects pages.
 */
export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth(() => ({
  secret: authSecret(),
  adapter: DrizzleAdapter(getDb(), {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  session: { strategy: "jwt" as const, maxAge: SESSION_MAX_AGE_S },
  useSecureCookies: process.env.NODE_ENV === "production",
  cookies: { sessionToken: { name: SESSION_COOKIE, options: sessionCookieOptions() } },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const r = await authenticate(credentials, clientIp(request.headers));
        if (!r.ok) {
          if (r.reason === "locked") throw new LockedError(r.retryAfterSeconds);
          return null;
        }
        return { id: r.user.id, email: r.user.email, name: r.user.name, tokenVersion: r.user.tokenVersion } as never;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      const claims = user
        ? initialClaims(user as unknown as { id: string; email: string; name: string; tokenVersion: number })
        : (token as AppClaims);
      // `session` on an update is client-influenced: only the requested org is read from it, and
      // refreshClaims verifies membership server-side before honouring it.
      const requested = trigger === "update" ? (session as { activeOrgId?: unknown } | undefined)?.activeOrgId : undefined;
      const fresh = await refreshClaims(claims, requested);
      return fresh ? { ...token, ...fresh } : null;
    },
    session({ session, token }) {
      const t = token as AppClaims;
      if (t.userId) {
        session.userId = t.userId;
        session.activeOrgId = t.activeOrgId as string;
        session.orgRole = t.orgRole as OrgRole;
        session.role = t.role as Role;
      }
      return session;
    },
  },
}));

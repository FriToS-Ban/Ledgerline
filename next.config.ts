import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * CSP without nonces (see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 * 'unsafe-inline' scripts are needed by Next's inline bootstrap without nonces; 'unsafe-eval' only in
 * dev (React debugging / HMR). blob: workers cover three.js / r3f and pdf.js; fonts are self-hosted
 * by next/font. Everything else is same-origin.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  `connect-src 'self' blob: data:${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

/** Invoice files are shown in an <iframe> on the case page, so they may be framed by this origin only. */
const sameOriginFraming = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
];

const nextConfig: NextConfig = {
  cacheComponents: false,
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Later entries override earlier ones for the same key.
      { source: "/api/files/:path*", headers: sameOriginFraming },
      { source: "/demos/:path*", headers: sameOriginFraming },
      { source: "/uploads/:path*", headers: sameOriginFraming },
    ];
  },
  serverExternalPackages: [
    "@mastra/core",
    "@mastra/libsql",
    "@mastra/loggers",
    "@libsql/client",
    "tesseract.js",
    "pdfjs-dist",
    "inngest",
    "imapflow",
    "mailparser",
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

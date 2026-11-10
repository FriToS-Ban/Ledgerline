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
// The case page embeds the browser PDF viewer as an object, so only /cases/* allows it.
const casesCsp = csp.replace("object-src 'none'", "object-src 'self'");

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

/**
 * Invoice files (PDF/images) are shown in an <iframe> on the case page, so this origin may frame
 * them. Their CSP is the base policy made STRICTER: no scripts, no connections, no forms, so even
 * a stray HTML/SVG file could not run anything. `object-src 'self'` keeps the browser PDF viewer
 * working (it is a plugin embed); `sandbox` is NOT used here because Chrome refuses to render
 * PDFs in sandboxed documents. Served types are also allow-listed in /api/files and save-upload.
 */
const fileCsp = [
  "default-src 'none'",
  "img-src 'self' data: blob:",
  "style-src 'unsafe-inline'",
  "object-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");
const framedFileHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: fileCsp },
];
const nextConfig: NextConfig = {
  cacheComponents: false,
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Later entries override earlier ones for the same key.
      { source: "/cases/:path*", headers: [{ key: "Content-Security-Policy", value: casesCsp }] },
      { source: "/api/files/:path*", headers: framedFileHeaders },
      { source: "/demos/:path*", headers: framedFileHeaders },
    ];
  },
  serverExternalPackages: [
    "@mastra/core",
    "@mastra/loggers",
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

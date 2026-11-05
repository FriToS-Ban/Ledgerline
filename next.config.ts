import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: false,
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

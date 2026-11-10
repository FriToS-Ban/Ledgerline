export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` evaluates the server with NODE_ENV=production but without runtime secrets.
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    const { assertEnvOrExit } = await import("@/lib/env");
    assertEnvOrExit();
  }
  if (process.env.DISABLE_WORKER !== "1") {
    const { startWorker } = await import("@/lib/queue/worker");
    startWorker();
  }
}

let registered = false;

export async function register() {
  if (registered) {
    return;
  }

  registered = true;

  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  if (process.env.RUN_BACKGROUND_WORKER !== "1") {
    return;
  }

  const { startBackgroundWorker } = await import("@/lib/background/worker");
  startBackgroundWorker();
}

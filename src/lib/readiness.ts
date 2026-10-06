// A probe has one shared deadline; failures never cross the public boundary.
export async function probeReadiness(
  checks: Array<(signal: AbortSignal) => Promise<unknown>>,
  timeoutMs = 5000,
): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.all(checks.map((check) => check(controller.signal))).then(
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(false);
        }, timeoutMs);
      }),
    ]);
  } catch {
    controller.abort();
    return false;
  } finally {
    clearTimeout(timer);
  }
}

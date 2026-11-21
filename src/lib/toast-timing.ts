const confirmationDuration = 6000;

export function scheduleToastExpiry(paused: boolean, expire: () => void) {
  if (paused) return;
  const timer = setTimeout(expire, confirmationDuration);
  return () => clearTimeout(timer);
}

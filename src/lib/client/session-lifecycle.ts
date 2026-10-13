import { namespace } from "@/lib/project";
// One cancellation scope for browser HTTP requests in the current document.
const requests = new AbortController();
export const sessionRequestSignal = () => requests.signal;
export function invalidateBrowserSession() {
  requests.abort();
  window.dispatchEvent(new Event("base-session-invalidated"));
}
export function announceSessionChange() {
  try {
    localStorage.setItem(namespace("session-event"), crypto.randomUUID());
  } catch {
    // Navigation and clearing this document must work with storage disabled.
  }
  invalidateBrowserSession();
  location.replace("/account");
}

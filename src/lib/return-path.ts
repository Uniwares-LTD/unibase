// Same-origin page path to resume after sign-in; anything else is discarded.
export function safeReturnPath(value: string | null | undefined) {
  if (!value?.startsWith("/") || /^\/\/|\\|\s/.test(value)) return undefined;
  const base = "http://return.invalid";
  try {
    const url = new URL(value, base);
    // Dot segments can normalize into "//host", so check the resolved path too.
    if (
      url.origin !== base ||
      /^\/[\\/]/.test(url.pathname) ||
      url.pathname.startsWith("/api/")
    )
      return;
    const path = url.pathname + url.search + url.hash;
    return url.pathname === "/account" ? undefined : path;
  } catch {
    return undefined;
  }
}

export function signInPath(next?: string | null) {
  const path = safeReturnPath(next);
  return path ? `/account?next=${encodeURIComponent(path)}` : "/account";
}

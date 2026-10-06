const COVER_SELECTOR = 'meta[property="og:image"]';

/** Only ordinary image URLs from page metadata; never credentials or executable URLs. */
export function resolvePageCover(
  value: string | null,
  base: string,
): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value, base);
    const page = new URL(base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    if (page.protocol === "https:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Follow metadata, including streamed tags and client navigation. No account state. */
export function watchPageCover(
  doc: Document,
  apply: (url: string | null) => void,
) {
  let current: string | null | undefined;
  let cancelLoad = () => {};
  const refresh = () => {
    const url = resolvePageCover(
      doc.querySelector<HTMLMetaElement>(COVER_SELECTOR)?.content ?? null,
      doc.baseURI,
    );
    if (url === current) return;
    current = url;
    cancelLoad();
    apply(null); // A previous page's artwork must not survive a new/failed cover.
    if (!url) return;
    const image = new Image();
    let active = true;
    const timer = setTimeout(() => cancelLoad(), 10000);
    cancelLoad = () => {
      active = false;
      clearTimeout(timer);
      image.onload = image.onerror = null;
      image.removeAttribute("src");
    };
    image.referrerPolicy = "no-referrer";
    image.onload = () => {
      if (active && image.naturalWidth > 0) apply(url);
      clearTimeout(timer);
    };
    image.onerror = () => cancelLoad();
    image.src = url;
  };
  const hasMetadata = (node: Node) =>
    node instanceof Element &&
    (node.matches("meta") || Boolean(node.querySelector("meta")));
  const observer = new MutationObserver((records) => {
    if (
      records.some((record) =>
        record.type === "attributes"
          ? record.target instanceof HTMLMetaElement
          : [...record.addedNodes, ...record.removedNodes].some(hasMetadata),
      )
    )
      refresh();
  });
  // Next can stream metadata into body; observing only head misses those tags.
  observer.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["content", "property"],
  });
  refresh();
  return () => {
    observer.disconnect();
    cancelLoad();
    apply(null);
  };
}

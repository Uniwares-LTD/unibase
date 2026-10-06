// Routing only; this never authorizes a payment or grants credits.
export async function paymentContext(input: {
  referrer: string;
  search: string;
  markedPlay: boolean;
  digitalGoods?: () => Promise<unknown>;
}): Promise<"web" | "play"> {
  if (
    input.markedPlay ||
    input.referrer.startsWith("android-app://") ||
    new URLSearchParams(input.search).get("client") === "play"
  )
    return "play";
  if (input.digitalGoods) {
    try {
      await input.digitalGoods();
      return "play";
    } catch {
      /* ordinary web browsers have no Play service */
    }
  }
  return "web";
}

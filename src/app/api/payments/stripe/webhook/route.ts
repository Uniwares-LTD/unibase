import { AppError } from "@/lib/auth-policy";
import { endpoint, json, readText } from "@/lib/server/http";
import { stripeClient, stripeSettings } from "@/lib/server/stripe";
import { stripeNotice } from "@/lib/server/stripe-provider";
import { database } from "@/lib/server/mongo";
import { enqueuePaymentNotice } from "@/lib/server/store/payments";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(async () => {
    const settings = stripeSettings();
    const raw = await readText(request, 256000);
    let event;
    try {
      event = stripeClient().webhooks.constructEvent(
        raw,
        request.headers.get("stripe-signature") ?? "",
        settings.webhookSecret,
      );
    } catch {
      throw new AppError(
        "INVALID_WEBHOOK",
        "Payment notification signature is invalid.",
      );
    }
    const notice = stripeNotice(event, settings.key.startsWith("sk_live_"));
    if (notice) await enqueuePaymentNotice(database(), notice);
    // Acknowledge only after durable inbox storage. No financial writes here.
    return json({ received: true });
  });
}

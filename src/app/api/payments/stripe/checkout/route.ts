import { z } from "zod";
import { endpoint, json, readJson, checkMutation } from "@/lib/server/http";
import { startStripeCheckout } from "@/lib/server/stripe";
const schema = z
  .object({ packId: z.string().max(64), key: z.string().min(1).max(128) })
  .strict();
export async function POST(request: Request) {
  return endpoint(request, async () => {
    await checkMutation(request);
    const input = await readJson(request, schema);
    return json(await startStripeCheckout(input.packId, input.key));
  });
}

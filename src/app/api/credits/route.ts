import { currentCreditAccount } from "@/lib/server/credits";
import { endpoint, json } from "@/lib/server/http";
import { AppError } from "@/lib/auth-policy";

export async function GET(request: Request) {
  return endpoint(request, async () => {
    const raw = new URL(request.url).searchParams.get("before");
    const before = raw === null ? undefined : Number(raw);
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1))
      throw new AppError("INVALID_INPUT", "Choose a valid history page.");
    return json(await currentCreditAccount(before));
  });
}

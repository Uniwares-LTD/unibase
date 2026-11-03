import { z } from "zod";
import { AppError } from "../auth-policy";
export const ratePolicies = z.strictObject({
  read: z.number().int().min(1).max(100000).default(120),
  mutation: z.number().int().min(1).max(100000).default(30),
  upload: z.number().int().min(1).max(100000).default(10),
  part: z.number().int().min(1).max(100000).default(240),
  admission: z.number().int().min(1).max(100000).default(10),
  mcp: z.number().int().min(1).max(100000).default(120),
});
export type RatePolicy = keyof z.infer<typeof ratePolicies>;
export function rateConfig(
  env: Record<string, string | undefined> = process.env,
) {
  try {
    const policies = ratePolicies.parse(
      JSON.parse(env.RATE_LIMITS_JSON || "{}"),
    );
    const url = env.REDIS_URL;
    if (!url && (!env.APP_ENV || env.APP_ENV === "local"))
      return { url: null, policies };
    const parsed = new URL(url!);
    if (
      !["redis:", "rediss:"].includes(parsed.protocol) ||
      !parsed.hostname ||
      !parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error();
    return { url: url!, policies };
  } catch {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "Rate-limit configuration is unavailable.",
      503,
    );
  }
}

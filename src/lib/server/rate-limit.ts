import "server-only";
import { createHash } from "node:crypto";
import { AppError } from "../auth-policy";
import { project } from "../project";
import { redis, resetBrokenRedis } from "./redis";

import { rateConfig, type RatePolicy } from "../config/rate-limits";
export class RateLimitError extends AppError {
  constructor(public retryAfter: number) {
    super("RATE_LIMITED", "Too many requests. Please try again shortly.", 429);
  }
}
export const windowScript =
  "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return {n,redis.call('TTL',KEYS[1])}";
export async function rateReady() {
  const { url } = rateConfig();
  if (url)
    await (await redis(url)).withAbortSignal(AbortSignal.timeout(1500)).ping();
}
export async function limitRequest(actor: string, policy: RatePolicy) {
  const { url, policies } = rateConfig();
  // Cloud-free local mode; configure Redis locally to exercise shared limits.
  if (!url) return;
  try {
    const key = [
      project.slug,
      process.env.APP_ENV ?? "local",
      "limits",
      policy,
      createHash("sha256").update(actor).digest("hex"),
    ].join(":");
    const result = (await (
      await redis(url)
    )
      .withAbortSignal(AbortSignal.timeout(1500))
      .eval(windowScript, { keys: [key], arguments: [] })) as number[];
    if (result[0] > policies[policy])
      throw new RateLimitError(Math.max(1, result[1]));
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    resetBrokenRedis();
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "Request protection is temporarily unavailable.",
      503,
    );
  }
}
export function requestPolicy(request: Request): RatePolicy {
  const path = new URL(request.url).pathname;
  if (request.method === "GET") return "read";
  if (
    path === "/api/run-uploads" ||
    path.endsWith("/uploads") ||
    path === "/api/files"
  )
    return "upload";
  if (path === "/api/runs") return "admission";
  return "mutation";
}

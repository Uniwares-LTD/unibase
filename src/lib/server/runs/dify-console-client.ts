import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/auth-policy";
function baseUrl(management: boolean) {
  const value = management
    ? process.env.DIFY_CONSOLE_URL
    : process.env.DIFY_BASE_URL;
  if (!value)
    throw new AppError(
      "DIFY_NOT_CONFIGURED",
      "Dify connection is not configured.",
      409,
    );
  const url = new URL(value);
  const local =
    process.env.APP_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new AppError("DIFY_CONFIGURATION", "Invalid Dify connection.", 503);
  return url.href.replace(/\/$/, "");
}
export async function difyJson(
  path: string,
  options: { management?: boolean; key?: string; body?: unknown } = {},
) {
  const management = options.management ?? false;
  const key = management ? process.env.DIFY_MANAGEMENT_KEY : options.key;
  if (!key || (management && !process.env.DIFY_WORKSPACE_ID))
    throw new AppError(
      "DIFY_NOT_CONFIGURED",
      "Dify management is disabled. Use registered orchestrators and repository DSL files.",
      409,
    );
  let response: Response;
  try {
    response = await fetch(`${baseUrl(management)}${path}`, {
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(management
          ? {
              "X-WORKSPACE-ID": z
                .string()
                .uuid()
                .parse(process.env.DIFY_WORKSPACE_ID),
            }
          : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(30000),
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    throw new AppError(
      "DIFY_OUTCOME_UNKNOWN",
      "Dify did not confirm this request. Check its status before repeating a mutation.",
      503,
    );
  }
  if (
    !response.ok &&
    !(management && path.startsWith("/apps/imports") && response.status === 400)
  ) {
    await response.body?.cancel();
    throw new AppError(
      "DIFY_REJECTED",
      `Dify rejected the request (${response.status}).`,
      response.status === 401 || response.status === 403 ? 409 : 502,
    );
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new AppError(
      "DIFY_INVALID_RESPONSE",
      "Dify returned no response.",
      502,
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1024 * 1024) {
      await reader.cancel();
      throw new AppError(
        "DIFY_INVALID_RESPONSE",
        "Dify response exceeds the limit.",
        502,
      );
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new AppError(
      "DIFY_INVALID_RESPONSE",
      "Dify returned an invalid response.",
      502,
    );
  }
}

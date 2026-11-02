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
  options: {
    management?: boolean;
    key?: string;
    body?: unknown;
    timeoutMs?: number;
    method?: "GET" | "POST" | "PUT";
  } = {},
) {
  const management = options.management ?? false;
  const key = management ? process.env.DIFY_MANAGEMENT_KEY : options.key;
  if (!key || (management && !process.env.DIFY_WORKSPACE_ID))
    throw new AppError(
      "DIFY_NOT_CONFIGURED",
      management
        ? "Configure the Dify Console connection and management key."
        : "The app execution key is not configured on the server. Set the referenced DIFY_KEY_* variable to this app’s API key.",
      409,
    );
  let response: Response;
  try {
    response = await fetch(`${baseUrl(management)}${path}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
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
      signal: AbortSignal.timeout(
        Math.min(30000, Math.max(1000, options.timeoutMs ?? 30000)),
      ),
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
  if (!response.ok) {
    await response.body?.cancel();
    if (
      management &&
      path === "/workspaces/current/tool-provider/mcp" &&
      options.body !== undefined &&
      [400, 401, 403, 404, 405, 409, 422, 429].includes(response.status)
    )
      throw new AppError(
        "DIFY_MCP_SETUP_REJECTED",
        `Dify rejected MCP connection setup (${response.status}). Check management permissions and connection name, identifier and endpoint uniqueness, then retry.`,
        409,
      );
    if (
      management &&
      options.body === undefined &&
      response.status === 404 &&
      /^\/apps\/[a-f0-9-]+$/.test(path)
    )
      throw new AppError(
        "DIFY_APP_NOT_FOUND",
        "This workflow is no longer available in Dify.",
        404,
      );
    if (
      management &&
      path === "/apps/imports" &&
      options.body !== undefined &&
      [401, 403, 404, 405, 429].includes(response.status)
    )
      throw new AppError(
        "DIFY_IMPORT_REJECTED",
        `Dify rejected workflow creation (${response.status}). Check import permissions and retry.`,
        409,
      );
    if (
      management &&
      options.body !== undefined &&
      /^\/apps\/[a-f0-9-]+\/api-keys$/.test(path) &&
      [400, 401, 403, 404, 405, 422, 429].includes(response.status)
    )
      throw new AppError(
        "DIFY_KEY_CREATION_REJECTED",
        `Dify rejected app key creation (${response.status}). Check management permissions and the app’s key limit.`,
        409,
      );
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

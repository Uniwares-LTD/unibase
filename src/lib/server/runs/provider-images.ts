import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/auth-policy";
import { readProviderBytes } from "../ai/dify";

const fileSchema = z.object({
  type: z.literal("image"),
  transfer_method: z.literal("tool_file"),
  related_id: z.string().uuid(),
  url: z.string().max(2048),
});

// Only the explicit End output opts into native Dify tool images. URLs are
// signed first-party file capabilities, never arbitrary model-selected URLs.
export function providerImages(outputs: Record<string, unknown> | null) {
  if (!outputs || !("unibase_images" in outputs)) return [];
  const result =
    typeof outputs.result === "string"
      ? JSON.parse(outputs.result)
      : outputs.result;
  z.object({
    version: z.literal(1),
    outcome: z.literal("success"),
    text: z.string(),
    cards: z.array(z.unknown()),
    images: z.array(z.unknown()),
  }).parse(result);
  return z.array(fileSchema).min(1).max(10).parse(outputs.unibase_images);
}

export async function downloadProviderImage(
  file: ReturnType<typeof providerImages>[number],
  baseUrl: string,
  limit: number,
  fetcher: typeof fetch = fetch,
) {
  const origin = new URL(baseUrl).origin;
  const url = new URL(file.url, origin);
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.hash ||
    !new RegExp(
      `^/files/tools/${file.related_id}\\.(png|jpg|jpeg|webp)$`,
      "i",
    ).test(url.pathname) ||
    [...url.searchParams.keys()].some(
      (k) => !["timestamp", "nonce", "sign", "as_attachment"].includes(k),
    ) ||
    ["timestamp", "nonce", "sign"].some(
      (k) =>
        url.searchParams.getAll(k).length !== 1 || !url.searchParams.get(k),
    )
  )
    throw new AppError(
      "INVALID_IMAGE",
      "The generated image reference is invalid.",
    );
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(30000),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError("INVALID_IMAGE", "The generated image is unavailable.");
  }
  if (
    !/^image\/(png|jpeg|webp)(;|$)/i.test(
      response.headers.get("content-type") ?? "",
    )
  ) {
    await response.body?.cancel();
    throw new AppError(
      "INVALID_IMAGE",
      "The generated image format is unsupported.",
    );
  }
  return readProviderBytes(response, limit);
}

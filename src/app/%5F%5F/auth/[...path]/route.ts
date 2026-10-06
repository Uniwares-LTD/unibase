import { getAuthConfig } from "@/lib/server/auth-config";
import { endpoint, readText } from "@/lib/server/http";
import { unstable_rethrow } from "next/navigation";
import { AppError } from "@/lib/auth-policy";

// Firebase helper endpoints only. The upstream host is derived from a validated
// project ID, never from a request URL. No application cookies reach Firebase.
async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const config = getAuthConfig();
  if (
    config.server.mode !== "firebase" ||
    path.length !== 1 ||
    !/^(handler|iframe|handler\.js|iframe\.js|experiments\.js|links)$/.test(
      path[0],
    )
  )
    return new Response(null, { status: 404 });
  const target = new URL(
    `https://${config.public.projectId}.firebaseapp.com/__/auth/${path[0]}`,
  );
  target.search = new URL(request.url).search;
  try {
    const upstream = await fetch(target, {
      method: request.method,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      headers: {
        "content-type":
          request.headers.get("content-type") ?? "application/octet-stream",
      },
      ...(request.method === "POST"
        ? { body: await readText(request, 65536) }
        : {}),
    });
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const key of ["content-type", "location"]) {
      const value = upstream.headers.get(key);
      if (value) headers.set(key, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AppError)
      return new Response(error.message, { status: error.status });
    return new Response("Authentication helper unavailable.", { status: 502 });
  }
}
export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return endpoint(() => proxy(request, context));
}
export const POST = GET;

import { NextResponse } from "next/server";

// Return the status before App Router streaming starts. The page also guards
// its content; this proxy only applies to the development showcase path.
export function proxy() {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }
  return NextResponse.next();
}

export const config = { matcher: "/design-system/:path*" };

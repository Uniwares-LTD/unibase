import { PageMessages } from "@/components/page-messages";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-patterns";
import { DesignShowcase } from "@/components/design-showcase";
import { getConfig } from "@/lib/server/config";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ cover?: string }>;
}): Promise<Metadata> {
  const { cover } = await searchParams;
  const path =
    cover === "broken"
      ? "/design-system/missing-cover.png"
      : "/design-system/cover.svg";
  return {
    title: "Design system",
    robots: { index: false, follow: false },
    openGraph: {
      images:
        cover === "none" ? [] : [new URL(path, getConfig().server.origin).href],
    },
  };
}
export default function DesignSystemPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <PageMessages path="/design-system">
      {
        <div className="page-stack">
          <PageHeader
            title="Design system"
            eyebrow="Design reference"
            description="A reference for changing and testing visual tokens, components and page patterns."
          />
          <DesignShowcase />
        </div>
      }
    </PageMessages>
  );
}

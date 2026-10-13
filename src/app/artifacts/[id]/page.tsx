import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AppError } from "@/lib/auth-policy";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/server/session";
import Image from "next/image";
import { z } from "zod";
import { artifactDetail } from "@/lib/server/runs/artifacts";
import { ArtifactControls } from "@/components/runs/artifact-controls";
import { PageHeader } from "@/components/page-patterns";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const translate = await getTranslations("ui");

  if (!(await getSession())?.email_verified) redirect("/account");
  const parsed = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!parsed.success) notFound();
  const row = await artifactDetail(
    parsed.data,
    (await searchParams).cursor,
  ).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  return (
    <PageMessages path="/artifacts/[id]">
      {
        <div className="page-stack">
          <PageHeader
            title={row.title}
            description={`Current revision ${row.revision}; approved revision ${row.approvedRevision ?? "none"}.`}
          />
          <Button asChild>
            <Link href={`/runs/new?artifactId=${row.id}`}>
              {translate("meeac60ddb135")}{" "}
            </Link>
          </Button>
          <Accordion
            type="multiple"
            defaultValue={
              row.revisions.rows.length
                ? [String(row.revisions.rows[0].revision)]
                : []
            }
          >
            {row.revisions.rows.map((r) => (
              <AccordionItem value={String(r.revision)} key={r.revision}>
                <AccordionTrigger>
                  <span className="flex flex-wrap items-center gap-2">
                    <span>
                      {translate("m2e516d68f42f")} {r.revision}
                    </span>
                    {r.revision === row.revision && (
                      <Badge variant="secondary">
                        {translate("m8730d3c2022a")}
                      </Badge>
                    )}
                    {r.approvalSource && (
                      <Badge variant="outline">
                        {translate("m87b42e40c2a2")}
                      </Badge>
                    )}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <p className="whitespace-pre-wrap break-words">{r.text}</p>
                  {r.approvalSource && (
                    <p>
                      {translate("m8e838c460986")}{" "}
                      {r.approvalSource.type === "persona"
                        ? `persona revision ${r.approvalSource.personaRevision}`
                        : "user"}
                      .
                    </p>
                  )}
                  <Link className="underline" href={`/runs/${r.logicalId}`}>
                    {translate("mf8cecbf46477")}{" "}
                  </Link>
                  {r.assets.map((id, index) => (
                    <Image
                      key={id}
                      src={`/api/run-assets/${id}`}
                      alt={`Revision ${r.revision} illustration ${index + 1}`}
                      width={400}
                      height={400}
                      unoptimized
                      className="h-auto max-w-full rounded-lg"
                    />
                  ))}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          {row.revisions.next && (
            <Button asChild variant="outline">
              <Link
                href={`/artifacts/${row.id}?cursor=${encodeURIComponent(row.revisions.next)}`}
              >
                {translate("m11ad78ef6152")}{" "}
              </Link>
            </Button>
          )}
          <ArtifactControls id={row.id} />
        </div>
      }
    </PageMessages>
  );
}

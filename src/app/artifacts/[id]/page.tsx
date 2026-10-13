import Link from "next/link";
import { redirect } from "next/navigation";
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
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await getSession())?.email_verified) redirect("/account");
  const row = await artifactDetail(
    z
      .string()
      .uuid()
      .parse((await params).id),
  );
  return (
    <div className="page-stack">
      <PageHeader
        title={row.title}
        description={`Current revision ${row.revision}; approved revision ${row.approvedRevision ?? "none"}.`}
      />
      <Button asChild>
        <Link href={`/runs/new?artifactId=${row.id}`}>
          Start associated Run
        </Link>
      </Button>
      <Accordion
        type="multiple"
        defaultValue={
          row.revisions.length ? [String(row.revisions[0].revision)] : []
        }
      >
        {row.revisions.map((r) => (
          <AccordionItem value={String(r.revision)} key={r.revision}>
            <AccordionTrigger>
              <span className="flex flex-wrap items-center gap-2">
                <span>Revision {r.revision}</span>
                {r.revision === row.revision && (
                  <Badge variant="secondary">Latest</Badge>
                )}
                {r.approvalSource && <Badge variant="outline">Approved</Badge>}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-4">
              <p className="whitespace-pre-wrap break-words">{r.text}</p>
              {r.approvalSource && (
                <p>
                  Approved by{" "}
                  {r.approvalSource.type === "persona"
                    ? `persona revision ${r.approvalSource.personaRevision}`
                    : "user"}
                  .
                </p>
              )}
              <Link className="underline" href={`/runs/${r.logicalId}`}>
                Source Run
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
      <ArtifactControls id={row.id} />
    </div>
  );
}

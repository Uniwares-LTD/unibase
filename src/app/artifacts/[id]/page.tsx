import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import Image from "next/image";
import { z } from "zod";
import { artifactDetail } from "@/lib/server/runs/artifacts";
import { ArtifactControls } from "@/components/runs/artifact-controls";
import { PageHeader } from "@/components/page-patterns";
import { Button } from "@/components/ui/button";
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
      {row.revisions.map((r) => (
        <section className="space-y-2" key={r.revision}>
          <h2 className="text-xl font-semibold">Revision {r.revision}</h2>
          <p className="whitespace-pre-wrap">{r.text}</p>
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
        </section>
      ))}
      {row.assets.map((id) => (
        <Image
          key={id}
          src={`/api/run-assets/${id}`}
          alt="Saved artifact illustration"
          width={400}
          height={400}
          unoptimized
          className="h-auto max-w-full rounded-lg"
        />
      ))}
      <ArtifactControls id={row.id} />
    </div>
  );
}

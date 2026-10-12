import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { listArtifacts } from "@/lib/server/runs/artifacts";
import { ArtifactControls } from "@/components/runs/artifact-controls";
import { PageHeader } from "@/components/page-patterns";
export default async function Page() {
  if (!(await getSession())?.email_verified) redirect("/account");
  const rows = await listArtifacts();
  return (
    <div className="page-stack">
      <PageHeader
        title="Saved artifacts"
        description="Owned content and images retained independently of Run history."
      />
      <ArtifactControls />
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id}>
            <Link className="underline" href={`/artifacts/${row.id}`}>
              {row.title}
            </Link>{" "}
            · Revision {row.revision}
          </li>
        ))}
      </ul>
      {!rows.length && <p>No saved artifacts yet.</p>}
    </div>
  );
}

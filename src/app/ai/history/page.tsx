import Link from "next/link";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/auth-policy";
import { myAiHistory } from "@/lib/server/ai/service";
import { PageHeader } from "@/components/page-patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
export const metadata = { title: "AI history" };
export default async function History({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const page = await myAiHistory(cursor).catch((error: unknown) => {
    if (
      error instanceof AppError &&
      ["UNAUTHENTICATED", "EMAIL_UNVERIFIED"].includes(error.code)
    )
      redirect("/account");
    if (error instanceof AppError && error.code === "INVALID_CURSOR")
      redirect("/ai/history");
    throw error;
  });
  return (
    <div className="page-stack">
      <PageHeader
        title="AI execution history"
        description="Your saved executions, newest first."
      />
      <Button asChild variant="outline">
        <Link href="/ai">Back to workspace</Link>
      </Button>
      {!page.jobs.length && <p>No executions on this page.</p>}
      {page.jobs.map((job) => (
        <Card key={job.id}>
          <CardContent className="space-y-2 py-4">
            <Link className="underline" href={`/ai/${job.id}`}>
              {job.capability} · {job.status}
            </Link>
            <p>{job.createdAt.slice(0, 19).replace("T", " ")} UTC</p>
            <p>
              {job.cleanedAt
                ? "Content removed by administrator cleanup; billing history retained."
                : `${job.chargedCredits ?? "Pending"} credits charged`}
            </p>
          </CardContent>
        </Card>
      ))}
      <div className="flex gap-3">
        <Button asChild variant="outline">
          <Link href="/ai/history">Newest</Link>
        </Button>
        {page.next && (
          <Button asChild>
            <Link href={`/ai/history?cursor=${encodeURIComponent(page.next)}`}>
              Older executions
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

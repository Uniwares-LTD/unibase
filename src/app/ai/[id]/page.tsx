import Link from "next/link";
import { pricingDescription } from "@/lib/ai-pricing";
import { notFound, redirect } from "next/navigation";
import { AppError } from "@/lib/auth-policy";
import { getMyAiJob } from "@/lib/server/ai/service";
import { PageHeader } from "@/components/page-patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "AI execution" };
export default async function AiDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const job = await getMyAiJob((await params).id).catch((error: unknown) => {
    if (
      error instanceof AppError &&
      ["UNAUTHENTICATED", "EMAIL_UNVERIFIED"].includes(error.code)
    )
      redirect("/account");
    if (
      error instanceof AppError &&
      ["NOT_FOUND", "AI_INVALID_ID"].includes(error.code)
    )
      notFound();
    throw error;
  });
  return (
    <div className="page-stack">
      <PageHeader
        title="Execution details"
        description={`${job.capability} · ${job.status}`}
        actions={
          <Button variant="outline" asChild>
            <Link href="/ai">Back to workspace</Link>
          </Button>
        }
      />
      <p className="break-all text-sm">{job.id}</p>
      {job.cleanedAt && (
        <p>
          Prompt and result content were removed by administrator cleanup.
          Billing and usage records remain available.
        </p>
      )}
      <p>
        {job.chargedCredits === null
          ? `${job.credits} credits reserved`
          : `${job.chargedCredits} credits charged (${job.credits} maximum)`}{" "}
        · {job.simulated ? "Simulated provider" : "Dify"}
      </p>
      <p className="text-sm text-muted-foreground">
        {pricingDescription(job.pricing)}
      </p>
      {job.capped && (
        <p>
          The calculated charge exceeded the maximum; only the agreed maximum
          was charged.
        </p>
      )}
      {job.outputs && (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap break-words text-sm">
              {typeof job.outputs.text === "string"
                ? job.outputs.text
                : JSON.stringify(job.outputs, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Usage evidence</h2>
        <p className="text-sm text-muted-foreground">
          Unknown cost is not zero. Execution totals and individual nodes can
          overlap; do not add their token counts together. Costs retain their
          reported currency.
        </p>
        {!job.usage.length && <p>No usage has been reported yet.</p>}
        {job.usage.map((item, index) => (
          <Card key={index}>
            <CardContent className="space-y-1 py-4 text-sm">
              <p>
                {item.scope} ·{" "}
                {item.simulated ? "Simulated" : "Provider reported"}
              </p>
              <p>Total tokens: {item.totalTokens ?? "Unknown"}</p>
              <p>
                Cost:{" "}
                {item.cost
                  ? `${item.cost.amount} ${item.cost.currency}`
                  : "Unknown"}
              </p>
              <p>
                Duration:{" "}
                {item.elapsedMs === null ? "Unknown" : `${item.elapsedMs} ms`}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}

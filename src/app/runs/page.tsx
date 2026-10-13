import { StateLabel, DateLabel } from "@/components/localized-value";
import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { listRuns } from "@/lib/server/runs/service";
import { PageHeader } from "@/components/page-patterns";
import { Button } from "@/components/ui/button";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; status?: string }>;
}) {
  const translate = await getTranslations("ui");

  const q = await searchParams;
  const data = await listRuns(q.cursor, q.status);
  return (
    <PageMessages path="/runs">
      {
        <div className="page-stack">
          <PageHeader
            title={translate("m848f54e89660")}
            description={translate("m9f45d2baab84")}
          />
          <Button asChild>
            <Link href="/runs/new">{translate("m9f88e18da1c5")}</Link>
          </Button>
          <nav
            aria-label={translate("m50a126c9b501")}
            className="flex flex-wrap gap-3"
          >
            {[
              "all",
              "queued",
              "unknown",
              "cancelled",
              "partial",
              "running",
              "paused",
              "succeeded",
              "failed",
              "needs-review",
            ].map((status) => (
              <Link
                key={status}
                className="underline"
                href={status === "all" ? "/runs" : `/runs?status=${status}`}
              >
                {status === "paused"
                  ? translate("ma8115bed7408")
                  : status === "unknown"
                    ? translate("m7cf9168fae51")
                    : status === "partial"
                      ? translate("m24421344abc3")
                      : status}
              </Link>
            ))}
          </nav>
          {data.rows.map((run) => (
            <div className="rounded-lg border p-4" key={run.id}>
              <Link
                className="font-semibold underline"
                href={`/runs/${run.id}`}
              >
                {run.name}
              </Link>
              <p>
                <StateLabel value={run.status} /> ? {run.attempts}{" "}
                {translate("maad7e03ae319")} <DateLabel value={run.createdAt} />
              </p>
            </div>
          ))}
          {!data.rows.length && <p>{translate("m72a85758b69c")}</p>}
          {data.next && (
            <Link
              className="underline"
              href={`/runs?cursor=${encodeURIComponent(data.next)}${q.status ? `&status=${q.status}` : ""}`}
            >
              {translate("m5a0522cb269a")}{" "}
            </Link>
          )}
        </div>
      }
    </PageMessages>
  );
}

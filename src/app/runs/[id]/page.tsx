import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AppError } from "@/lib/auth-policy";
import { runIdSchema } from "@/lib/contracts/runs";
import { RunDetail } from "@/components/runs/run-ui";
import { runDetail } from "@/lib/server/runs/service";
import { PageHeader } from "@/components/page-patterns";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const translate = await getTranslations("ui");

  const parsed = runIdSchema.safeParse((await params).id);
  if (!parsed.success) notFound();
  const data = await runDetail(parsed.data).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  return (
    <PageMessages path="/runs/[id]">
      {
        <div className="page-stack">
          <PageHeader
            title={data.name}
            description={translate("m672baa4d7bf4")}
          />
          <RunDetail initial={data} />
        </div>
      }
    </PageMessages>
  );
}

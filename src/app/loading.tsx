import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  const translate = useTranslations("ui");

  return (
    <div
      role="status"
      aria-label={translate("m91bf928d3527")}
      className="space-y-8"
    >
      <span className="sr-only">{translate("m707b5b7e9581")}</span>
      <Skeleton className="h-72 w-full rounded-2xl" />
      <div className="grid gap-5 sm:grid-cols-2">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  );
}

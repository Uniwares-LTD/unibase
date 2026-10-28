import { StateLabel } from "./localized-value";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { events } from "@/lib/diagnostics";
import { auditEvents, type ReportFilters } from "@/lib/contracts/reports";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./ui/select";

export function ReportFiltersForm({ filters }: { filters: ReportFilters }) {
  const translate = useTranslations("ui");

  const eventOptions = filters.kind === "audit" ? auditEvents : events;
  return (
    <form
      action="/admin/reports"
      method="get"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <input type="hidden" name="kind" value={filters.kind} />
      <div className="space-y-2">
        <Label htmlFor="report-event">{translate("m4e1f49a9c8ae")}</Label>
        <Select name="event" defaultValue={filters.event ?? "any"}>
          <SelectTrigger id="report-event" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{translate("m20b8487b3804")}</SelectItem>
            {eventOptions.map((event) => (
              <SelectItem key={event} value={event}>
                <StateLabel value={event} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {filters.kind === "runtime" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="report-severity">
              {translate("m5e9f98120dbe")}
            </Label>
            <Select name="severity" defaultValue={filters.severity ?? "any"}>
              <SelectTrigger id="report-severity" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">
                  {translate("m222b823b4b06")}
                </SelectItem>
                {["info", "warn", "error"].map((severity) => (
                  <SelectItem key={severity} value={severity}>
                    <StateLabel value={severity} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-request">{translate("md561f528baf7")}</Label>
            <Input
              id="report-request"
              name="requestId"
              defaultValue={filters.requestId}
              maxLength={36}
            />
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="report-actor">{translate("m547a040caa3f")}</Label>
            <Input
              id="report-actor"
              name="actorUid"
              defaultValue={filters.actorUid}
              maxLength={128}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-target">{translate("m7b7cac4c5726")}</Label>
            <Input
              id="report-target"
              name="targetUid"
              defaultValue={filters.targetUid}
              maxLength={128}
            />
          </div>
        </>
      )}
      <div className="space-y-2">
        <Label htmlFor="report-from">{translate("mbec5d54fdef3")}</Label>
        <Input
          id="report-from"
          name="from"
          type="date"
          defaultValue={filters.from}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="report-to">{translate("m615e9f898f44")}</Label>
        <Input id="report-to" name="to" type="date" defaultValue={filters.to} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Button type="submit">{translate("md80ab19b7edb")}</Button>
        <Button variant="outline" asChild>
          <Link href={`/admin/reports?kind=${filters.kind}`}>
            {translate("m7179ea0035fc")}
          </Link>
        </Button>
      </div>
    </form>
  );
}

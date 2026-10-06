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
  const eventOptions = filters.kind === "audit" ? auditEvents : events;
  return (
    <form
      action="/admin/reports"
      method="get"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <input type="hidden" name="kind" value={filters.kind} />
      <div className="space-y-2">
        <Label htmlFor="report-event">Event</Label>
        <Select name="event" defaultValue={filters.event ?? "any"}>
          <SelectTrigger id="report-event" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">All events</SelectItem>
            {eventOptions.map((event) => (
              <SelectItem key={event} value={event}>
                {event}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {filters.kind === "runtime" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="report-severity">Severity</Label>
            <Select name="severity" defaultValue={filters.severity ?? "any"}>
              <SelectTrigger id="report-severity" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">All severities</SelectItem>
                {["info", "warn", "error"].map((severity) => (
                  <SelectItem key={severity} value={severity}>
                    {severity}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-request">Request ID</Label>
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
            <Label htmlFor="report-actor">Actor UID</Label>
            <Input
              id="report-actor"
              name="actorUid"
              defaultValue={filters.actorUid}
              maxLength={128}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-target">Target UID</Label>
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
        <Label htmlFor="report-from">From (UTC)</Label>
        <Input
          id="report-from"
          name="from"
          type="date"
          defaultValue={filters.from}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="report-to">Through (UTC)</Label>
        <Input id="report-to" name="to" type="date" defaultValue={filters.to} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Button type="submit">Apply filters</Button>
        <Button variant="outline" asChild>
          <Link href={`/admin/reports?kind=${filters.kind}`}>
            Clear filters
          </Link>
        </Button>
      </div>
    </form>
  );
}

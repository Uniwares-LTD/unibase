import { z } from "zod";
import { events } from "../diagnostics";

export const auditEvents = [
  "admin-bootstrap",
  "access-change",
  "admin-profile-edit",
  "credit-adjustment",
  "ai-resolution",
  "ai-cleanup",
  "payment-review",
] as const;
export const reportFilterSchema = z
  .object({
    kind: z.enum(["runtime", "audit"]).default("runtime"),
    severity: z.enum(["info", "warn", "error"]).optional(),
    event: z.string().max(80).optional(),
    requestId: z.uuid().optional(),
    actorUid: z.string().min(1).max(128).optional(),
    targetUid: z.string().min(1).max(128).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    cursor: z.string().max(512).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.event &&
      !(value.kind === "audit" ? auditEvents : events).some(
        (event) => event === value.event,
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["event"],
        message: "Unknown report event.",
      });
    if (value.from && value.to && value.from > value.to)
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "Invalid date range.",
      });
    if (
      (value.kind === "runtime" && (value.actorUid || value.targetUid)) ||
      (value.kind === "audit" && (value.severity || value.requestId))
    )
      ctx.addIssue({
        code: "custom",
        message: "Filters do not match the report type.",
      });
  });
export type ReportFilters = z.infer<typeof reportFilterSchema>;
export function reportParameters(
  params: URLSearchParams,
): Record<string, string> {
  return Object.fromEntries(
    [...params].filter(
      ([key, value]) =>
        value !== "" &&
        !(["event", "severity"].includes(key) && value === "any"),
    ),
  );
}

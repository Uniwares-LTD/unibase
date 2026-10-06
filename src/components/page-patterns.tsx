import type { ReactNode } from "react";
import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Card, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header flex flex-wrap items-start justify-between gap-5">
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">
            {eyebrow}
          </p>
        )}
        <h1 className="page-title">{title}</h1>
        {description && (
          <p className="reading-copy mt-3 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

const tones = {
  info: {
    style: "border-info-foreground/25 bg-info text-info-foreground",
    Icon: Info,
  },
  success: {
    style: "border-success-foreground/25 bg-success text-success-foreground",
    Icon: CircleCheck,
  },
  warning: {
    style: "border-warning-foreground/25 bg-warning text-warning-foreground",
    Icon: TriangleAlert,
  },
  error: {
    style: "border-destructive/30 bg-card text-destructive",
    Icon: TriangleAlert,
  },
};
export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: keyof typeof tones;
  title: string;
  children?: ReactNode;
}) {
  const { style, Icon } = tones[tone];
  return (
    <Alert
      className={cn("p-4", style)}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      {children && (
        <AlertDescription className="text-current">{children}</AlertDescription>
      )}
    </Alert>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="border-dashed bg-muted/30 shadow-none">
      <CardHeader className="py-8">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="reading-copy">
          {description}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

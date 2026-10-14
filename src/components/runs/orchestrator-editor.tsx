"use client";
import { useTranslations } from "next-intl";

import { project, namespace } from "@/lib/project";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OrchestratorTemplateSummary } from "@/lib/contracts/orchestrator-templates";
import type { WorkflowVersionSelection } from "@/lib/contracts/workflow-versions";
import { WorkflowVersionPicker } from "./workflow-version-picker";

const appSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum([
    "unregistered",
    "registering",
    "ready",
    "failed",
    "disabled",
    "unavailable",
  ]),
  registered: z.boolean(),
  available: z.boolean(),
  orchestratorId: z.string().optional(),
  workflowId: z.string().uuid().optional(),
  stage: z.string().optional(),
  message: z.string().optional(),
});
const catalogSchema = z.object({
  apps: z.array(appSchema),
  warning: z.string().optional(),
});
const statusSchema = z.object({
  status: appSchema.shape.status,
  stage: z.string().optional(),
  message: z.string().optional(),
});
type Catalog = z.infer<typeof catalogSchema>;

// The previous forms and advanced tools are paused. Admins supply no configuration.
export function OrchestratorEditor({
  initial,
  initialError,
  templates,
}: {
  initial: Catalog;
  initialError?: string;
  templates: OrchestratorTemplateSummary[];
}) {
  const translate = useTranslations("ui");

  const router = useRouter();
  const [apps, setApps] = useState(initial.apps);
  const [message, setMessage] = useState(initialError ?? "");
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  async function change(
    action: "disable" | "unregister",
    orchestratorId: string,
  ) {
    setChanging(orchestratorId);
    setMessage("");
    try {
      await api(
        "/api/admin/orchestrators/manage",
        z.object({ status: z.enum(["disabled", "unregistered"]) }),
        { method: "POST", body: { action, orchestratorId } },
      );
      await refresh();
      router.refresh();
      setMessage(
        action === "disable"
          ? translate("m5ce0eb98b66b")
          : translate("mcc5093b51d29"),
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : translate("m2dc39274d477"),
      );
    } finally {
      setChanging(null);
    }
  }
  async function create(template: OrchestratorTemplateSummary) {
    const legacyKey =
      template.id === "document-summary"
        ? "unibase-starter-creation"
        : `unibase-orchestrator-creation:${template.id}`;
    const storageKey =
      project.slug === "unibase"
        ? legacyKey
        : namespace("orchestrator-creation:" + template.id);
    setCreating(true);
    setMessage(`Creating ${template.title}...`);
    try {
      const key = localStorage.getItem(storageKey) ?? crypto.randomUUID();
      localStorage.setItem(storageKey, key);
      const result = await api(
        "/api/admin/orchestrators/manage",
        z.object({
          status: z.literal("ready"),
          name: z.string(),
          appId: z.string(),
          orchestratorId: z.string(),
        }),
        {
          method: "POST",
          body: { action: "create", key, templateId: template.id },
          timeoutMs: 180000,
        },
      );
      localStorage.removeItem(storageKey);
      // Show the confirmed app immediately, even if discovery is temporarily stale.
      const confirmed: Catalog["apps"][number] = {
        id: result.appId,
        name: result.name,
        description: template.description,
        status: "ready",
        registered: true,
        available: true,
        orchestratorId: result.orchestratorId,
      };
      setApps((prior) => [
        ...prior.filter((app) => app.id !== result.appId),
        confirmed,
      ]);
      await refresh(confirmed);
      setMessage(
        `${result.name} is ready. Start a Run to try ${template.title}.`,
      );
      router.refresh();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "DIFY_CREATION_APP_DELETED"
      )
        localStorage.removeItem(storageKey);
      setMessage(
        error instanceof Error ? error.message : translate("ma54503c46774"),
      );
    } finally {
      setCreating(false);
    }
  }
  const [active, setActive] = useState<string | null>(
    initial.apps.find((app) => app.status === "registering")?.id ?? null,
  );
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const state = await api(
          "/api/admin/orchestrators/manage",
          statusSchema,
          {
            method: "POST",
            body: { action: "status", appId: active },
            signal: controller.signal,
          },
        );
        if (disposed) return;
        setApps((prior) =>
          prior.map((app) => (app.id === active ? { ...app, ...state } : app)),
        );
        if (state.status !== "registering") {
          setActive((current) => (current === active ? null : current));
          if (state.status === "ready") {
            try {
              const catalog = await api(
                "/api/admin/orchestrators/manage",
                catalogSchema,
                {
                  method: "POST",
                  body: { action: "discover" },
                  signal: controller.signal,
                },
              );
              if (disposed) return;
              setApps(catalog.apps);
            } catch {
              /* Refresh apps can reconcile a lost catalog response. */
            }
            router.refresh();
          }
          return;
        }
      } catch {
        if (disposed) return;
      }
      timer = setTimeout(() => void poll(), 2000);
    }
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, router]);
  async function refresh(confirmed?: Catalog["apps"][number]) {
    setRefreshing(true);
    setMessage("");
    try {
      const catalog = await api(
        "/api/admin/orchestrators/manage",
        catalogSchema,
        { method: "POST", body: { action: "discover" }, timeoutMs: 120000 },
      );
      setApps(
        confirmed && !catalog.apps.some((app) => app.id === confirmed.id)
          ? [...catalog.apps, confirmed]
          : catalog.apps,
      );
      setMessage(catalog.warning ?? "");
      setActive(
        (prior) =>
          prior ??
          catalog.apps.find((app) => app.status === "registering")?.id ??
          null,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : translate("m01b850c3158c"),
      );
    } finally {
      setRefreshing(false);
    }
  }
  async function register(appId: string, selection?: WorkflowVersionSelection) {
    setActive(appId);
    setMessage("");
    setApps((prior) =>
      prior.map((app) =>
        app.id === appId
          ? {
              ...app,
              status: "registering",
              stage: translate("m7117750980a2"),
              message: undefined,
            }
          : app,
      ),
    );
    try {
      const result = await api(
        "/api/admin/orchestrators/manage",
        z.object({
          status: z.literal("ready"),
          name: z.string(),
          orchestratorId: z.string(),
          workflowId: z.string().uuid(),
        }),
        {
          method: "POST",
          body: { action: "register", appId, selection },
          timeoutMs: 120000,
        },
      );
      setApps((prior) =>
        prior.map((app) =>
          app.id === appId
            ? {
                ...app,
                status: "ready",
                registered: true,
                orchestratorId: result.orchestratorId,
                workflowId: result.workflowId,
                stage: translate("m5fa7aac5375c"),
                message: translate("mf22c4dc94df3"),
              }
            : app,
        ),
      );
      setMessage(`${result.name} is ready for users.`);
      setActive((current) => (current === appId ? null : current));
      router.refresh();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : translate("m7c5bb3f95e38");
      try {
        const state = await api(
          "/api/admin/orchestrators/manage",
          statusSchema,
          { method: "POST", body: { action: "status", appId } },
        );
        setApps((prior) =>
          prior.map((app) => (app.id === appId ? { ...app, ...state } : app)),
        );
        if (state.status === "registering") {
          setMessage(translate("md74509f83832"));
          return;
        }
        if (state.status === "ready") {
          await refresh();
          setMessage(translate("mad8d6095dc84"));
          setActive((current) => (current === appId ? null : current));
          router.refresh();
          return;
        }
      } catch {
        /* Keep the explicit failure visible; refreshing can recover saved state. */
      }
      setMessage(errorMessage);
      setApps((prior) =>
        prior.map((app) =>
          app.id === appId
            ? { ...app, status: "failed", message: errorMessage }
            : app,
        ),
      );
      setActive((current) => (current === appId ? null : current));
    }
  }
  return (
    <section className="space-y-4" aria-labelledby="dify-apps-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="dify-apps-heading" className="text-xl font-semibold">
          {translate("md940356f831e")}{" "}
        </h2>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={creating || !!active || !!changing}>
                {creating
                  ? translate("mdef70944c9bb")
                  : translate("mf4bb36ce0b8b")}
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-80 max-w-[calc(100vw-2rem)]"
            >
              {templates.map((template) => (
                <DropdownMenuItem
                  key={template.id}
                  onSelect={() => void create(template)}
                  className="items-start whitespace-normal"
                >
                  <span>
                    <span className="block font-medium">{template.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {template.description}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            disabled={refreshing || !!changing || creating}
            onClick={() => void refresh()}
          >
            {refreshing
              ? translate("m47d2a515ef2f")
              : translate("m9650d7541bbf")}
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {translate("m74b3f6c29768")}{" "}
      </p>
      {message && (
        <p role="status" className="break-words text-sm">
          {message}
        </p>
      )}
      {!apps.length && (
        <Card>
          <CardContent className="pt-4">
            {initialError
              ? translate("m9139166c5259")
              : translate("mcee513ff2d0e")}
          </CardContent>
        </Card>
      )}
      {apps.map((app) => (
        <Card key={app.id}>
          <CardContent className="flex flex-col gap-4 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <h3 className="break-words font-semibold">{app.name}</h3>
              {app.description && (
                <p className="break-words text-sm text-muted-foreground">
                  {app.description}
                </p>
              )}
              <Badge
                variant={
                  app.status === "failed" || app.status === "unavailable"
                    ? "destructive"
                    : "secondary"
                }
              >
                {app.status === "ready"
                  ? translate("m5fa7aac5375c")
                  : app.status === "registering"
                    ? translate("m962b94daba0c")
                    : app.status === "failed"
                      ? translate("md40e3b08ef50")
                      : app.status === "disabled"
                        ? translate("m75081b593d15")
                        : app.status === "unavailable"
                          ? translate("m25be08e2e249")
                          : translate("mca374c23ed92")}
              </Badge>
              {app.status === "registering" && (
                <p role="status" className="text-sm">
                  {app.stage ?? translate("m88aeae0a1af7")}...
                </p>
              )}
              {["failed", "disabled", "unavailable"].includes(app.status) && (
                <p className="break-words text-sm">{app.message}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <WorkflowVersionPicker
                appId={app.id}
                currentWorkflowId={app.workflowId}
                disabled={
                  creating ||
                  !!changing ||
                  !app.available ||
                  !!active ||
                  app.status === "registering"
                }
                onRegister={(selection) => void register(app.id, selection)}
                label={
                  app.status === "registering"
                    ? translate("m9ef767a32782")
                    : app.registered && app.status !== "disabled"
                      ? translate("m9959a4e4ca3f")
                      : app.status === "failed"
                        ? translate("m04048ff7f268")
                        : app.status === "disabled"
                          ? translate("m5342e09f2729")
                          : translate("mbb7234ec1245")
                }
              />
              {app.registered && app.orchestratorId && (
                <>
                  {app.status !== "disabled" &&
                    app.status !== "unavailable" && (
                      <Button
                        variant="outline"
                        disabled={creating || !!changing || !!active}
                        onClick={() =>
                          void change("disable", app.orchestratorId!)
                        }
                      >
                        {translate("mb7e3e4aa4257")}{" "}
                      </Button>
                    )}
                  <Button
                    variant="destructive"
                    disabled={creating || !!changing || !!active}
                    onClick={() =>
                      void change("unregister", app.orchestratorId!)
                    }
                  >
                    {changing === app.orchestratorId
                      ? translate("m0a4e0b71b7f3")
                      : app.status === "unavailable" && !app.available
                        ? translate("m986831784abc")
                        : translate("mbe01aa28a44c")}
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

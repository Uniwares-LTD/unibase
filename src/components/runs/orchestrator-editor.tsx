"use client";

import { Notice } from "@/components/page-patterns";

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
  environment: z.string().optional(),
  owned: z.boolean().optional(),
  connection: z.string().optional(),
  source: z.object({ appId: z.uuid(), workflowId: z.uuid() }).optional(),
});
const catalogSchema = z.object({
  apps: z.array(appSchema),
  warning: z.string().optional(),
  currentEnvironment: z.enum(["local", "staging", "production"]).optional(),
});
const statusSchema = z.object({
  status: appSchema.shape.status,
  stage: z.string().optional(),
  message: z.string().optional(),
});
type Catalog = z.infer<typeof catalogSchema>;

// Destination-specific template setup happens in Dify before registration.
export function OrchestratorEditor({
  initial,
  initialError,
  templates,
}: {
  initial: Catalog;
  initialError?: string;
  templates: OrchestratorTemplateSummary[];
}) {
  const router = useRouter();
  const [apps, setApps] = useState(initial.apps);
  const [message, setMessage] = useState(initialError ?? "");
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  async function copyApp(appId: string, selection?: WorkflowVersionSelection) {
    if (!selection) return;
    setCreating(true);
    setMessage("");
    const storageKey = namespace(
      `orchestrator-copy:${initial.currentEnvironment}:${appId}:${selection.workflowId}`,
    );
    const key = localStorage.getItem(storageKey) ?? crypto.randomUUID();
    localStorage.setItem(storageKey, key);
    try {
      const result = await api(
        "/api/admin/orchestrators/manage",
        z.object({
          status: z.enum(["ready", "setup-required"]),
          appId: z.uuid(),
          name: z.string(),
        }),
        {
          method: "POST",
          body: { action: "copy", key, appId, selection },
          timeoutMs: 180000,
        },
      );
      localStorage.removeItem(storageKey);
      await refresh();
      setMessage(
        result.status === "ready"
          ? "The environment copy is registered and ready."
          : "The environment copy was created. Configure its destination resources in Dify, then register it.",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Registration could not be confirmed.",
      );
    } finally {
      setCreating(false);
    }
  }
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
          ? "Disabled for new Runs. Existing Runs are preserved."
          : "Unregistered from Unibase. Dify and Run history are preserved.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not change this orchestrator.",
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
        z.discriminatedUnion("status", [
          z.object({
            status: z.literal("ready"),
            name: z.string(),
            appId: z.string(),
            orchestratorId: z.string(),
          }),
          z.object({
            status: z.literal("setup-required"),
            name: z.string(),
            appId: z.string(),
          }),
        ]),
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
        status: result.status === "ready" ? "ready" : "unregistered",
        registered: result.status === "ready",
        available: true,
        ...(result.status === "ready"
          ? { orchestratorId: result.orchestratorId }
          : {}),
      };
      setApps((prior) => [
        ...prior.filter((app) => app.id !== result.appId),
        confirmed,
      ]);
      await refresh(confirmed);
      setMessage(
        result.status === "setup-required"
          ? result.name +
              " was created as a draft. In Dify, configure the country, law knowledgebase and document/image/audio models, then return here and Register it."
          : `${result.name} is ready. Start a Run to try ${template.title}.`,
      );
      router.refresh();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "DIFY_CREATION_APP_DELETED"
      )
        localStorage.removeItem(storageKey);
      setMessage(
        error instanceof Error
          ? error.message
          : "Creation could not be confirmed. Retry to resume setup.",
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
        error instanceof Error ? error.message : "Could not load Dify apps.",
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
              stage: "Checking workflow",
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
                stage: "Ready",
                message: "Ready for users.",
              }
            : app,
        ),
      );
      setMessage(`${result.name} is ready for users.`);
      setActive((current) => (current === appId ? null : current));
      router.refresh();
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Registration could not be confirmed.";
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
          setMessage("Setup is still running. Its progress will update here.");
          return;
        }
        if (state.status === "ready") {
          await refresh();
          setMessage("Registration completed. The orchestrator is ready.");
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
          Dify workflows
        </h2>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={creating || !!active || !!changing}>
                {creating ? "Creating..." : "Create orchestrator"}
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
            {refreshing ? "Loading..." : "Refresh apps"}
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Each Dify app belongs to one environment. Copy a published version to
        use it here; the source stays unchanged.
      </p>
      {message && <Notice title={message} />}
      {!apps.length && (
        <Card>
          <CardContent className="pt-4">
            {initialError
              ? "Connect Dify, then refresh the app list."
              : "No Workflow apps were found in this Dify workspace."}
          </CardContent>
        </Card>
      )}
      {apps.map((app) => (
        <Card key={app.id}>
          <CardContent className="flex flex-col gap-4 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <h3 className="break-words font-semibold">{app.name}</h3>
              <div className="flex flex-wrap gap-2">
                <Badge variant={app.owned ? "secondary" : "outline"}>
                  {app.environment === "local"
                    ? "Local"
                    : app.environment === "staging"
                      ? "Staging"
                      : app.environment === "production"
                        ? "Production"
                        : "Unmanaged"}
                </Badge>
                {app.connection && (
                  <Badge variant="outline">
                    <bdi>{app.connection}</bdi> ·{" "}
                    {app.status === "ready"
                      ? "MCP verified"
                      : "MCP verification required"}
                  </Badge>
                )}
              </div>
              {app.source && (
                <p className="break-words text-xs text-muted-foreground">
                  Copied from published version:{" "}
                  <bdi>{app.source.workflowId}</bdi>
                </p>
              )}
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
                  ? "Ready"
                  : app.status === "registering"
                    ? "Registering"
                    : app.status === "failed"
                      ? "Registration failed"
                      : app.status === "disabled"
                        ? "Disabled"
                        : app.status === "unavailable"
                          ? "Unavailable in Dify"
                          : "Not registered"}
              </Badge>
              {app.status === "registering" && (
                <p role="status" className="text-sm">
                  {app.stage ?? "Preparing workflow"}...
                </p>
              )}
              {["failed", "disabled", "unavailable"].includes(app.status) && (
                <p className="break-words text-sm">{app.message}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <WorkflowVersionPicker
                copy={!app.owned}
                appId={app.id}
                currentWorkflowId={app.workflowId}
                disabled={
                  creating ||
                  !!changing ||
                  !app.available ||
                  !!active ||
                  app.status === "registering"
                }
                onRegister={(selection) =>
                  void (app.owned
                    ? register(app.id, selection)
                    : copyApp(app.id, selection))
                }
                label={
                  !app.owned
                    ? "Create a copy for this environment"
                    : app.status === "registering"
                      ? "Registering..."
                      : app.registered && app.status !== "disabled"
                        ? "Re-register"
                        : app.status === "failed"
                          ? "Retry registration"
                          : app.status === "disabled"
                            ? "Enable"
                            : "Register"
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
                        Disable
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
                      ? "Updating..."
                      : app.status === "unavailable" && !app.available
                        ? "Delete registration"
                        : "Unregister"}
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

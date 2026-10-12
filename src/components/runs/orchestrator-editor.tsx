"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

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
}: {
  initial: Catalog;
  initialError?: string;
}) {
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
  async function create() {
    setCreating(true);
    setMessage("Creating the MCP and Human Input starter...");
    try {
      const key =
        localStorage.getItem("unibase-starter-creation") ?? crypto.randomUUID();
      localStorage.setItem("unibase-starter-creation", key);
      const result = await api(
        "/api/admin/orchestrators/manage",
        z.object({ status: z.literal("ready"), name: z.string() }),
        { method: "POST", body: { action: "create", key }, timeoutMs: 180000 },
      );
      localStorage.removeItem("unibase-starter-creation");
      await refresh();
      setMessage(
        `${result.name} is ready. Start a Run and choose Brief or Detailed.`,
      );
      router.refresh();
    } catch (error) {
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
  async function refresh() {
    setRefreshing(true);
    setMessage("");
    try {
      const catalog = await api(
        "/api/admin/orchestrators/manage",
        catalogSchema,
        { method: "POST", body: { action: "discover" }, timeoutMs: 120000 },
      );
      setApps(catalog.apps);
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
  async function register(appId: string) {
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
        }),
        {
          method: "POST",
          body: { action: "register", appId },
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
          <Button
            disabled={creating || !!active || !!changing}
            onClick={() => void create()}
          >
            {creating ? "Creating..." : "Create orchestrator"}
          </Button>
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
        Create a ready-to-run starter with MCP and a human choice, or register
        an existing published workflow.
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
              ? "Connect Dify, then refresh the app list."
              : "No Workflow apps were found in this Dify workspace."}
          </CardContent>
        </Card>
      )}
      {apps.map((app) => (
        <Card key={app.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-4">
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
              <Button
                disabled={
                  creating ||
                  !!changing ||
                  !app.available ||
                  !!active ||
                  app.status === "ready" ||
                  app.status === "registering"
                }
                onClick={() => void register(app.id)}
              >
                {app.status === "ready"
                  ? "Registered"
                  : app.status === "registering"
                    ? "Registering..."
                    : app.status === "failed"
                      ? "Retry registration"
                      : app.status === "disabled"
                        ? "Enable"
                        : "Register"}
              </Button>
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

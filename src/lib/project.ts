import { z } from "zod";
import manifest from "../../project.config.json";

export const moduleIds = [
  "credits",
  "payments",
  "runs",
  "mcp",
  "files",
  "notifications",
  "artifacts",
] as const;
export type ModuleId = (typeof moduleIds)[number];
export const projectSchema = z
  .strictObject({
    version: z.literal(1),
    slug: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/),
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[^\r\n\0]+$/),
    defaultStyle: z.enum(["classic", "glass", "soft-blue"]),
    modules: z
      .array(z.enum(moduleIds))
      .refine((v) => new Set(v).size === v.length),
    locales: z
      .array(z.enum(["en", "ar"]))
      .min(1)
      .refine((v) => new Set(v).size === v.length),
    defaultLocale: z.enum(["en", "ar"]),
    examples: z.boolean(),
    android: z
      .strictObject({
        packageName: z
          .string()
          .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.locales.includes(value.defaultLocale))
      ctx.addIssue({
        code: "custom",
        path: ["defaultLocale"],
        message: "Default locale must be supported.",
      });
    for (const [id, dependencies] of Object.entries(moduleDescriptors))
      if (value.modules.includes(id as ModuleId))
        for (const dependency of dependencies.requires)
          if (!value.modules.includes(dependency))
            ctx.addIssue({
              code: "custom",
              path: ["modules"],
              message: "Missing module dependency.",
            });
  });
export type ModuleConfiguration =
  "credits" | "payments" | "runs" | "mcp" | "assets";
export const moduleDescriptors: Record<
  ModuleId,
  {
    requires: ModuleId[];
    configuration: ModuleConfiguration[];
    routes: string[];
    workers: string[];
    collections: string[];
  }
> = {
  credits: {
    configuration: ["credits"],
    requires: [],
    routes: ["/credits", "/api/credits"],
    workers: ["payment"],
    collections: [
      "creditWallets",
      "creditLots",
      "creditReservations",
      "creditOperations",
      "creditLedger",
    ],
  },
  payments: {
    configuration: ["payments"],
    requires: ["credits"],
    routes: ["/api/payments"],
    workers: ["payment"],
    collections: ["purchaseOrders", "paymentInbox"],
  },
  runs: {
    configuration: ["runs"],
    requires: ["credits"],
    routes: ["/runs", "/api/runs", "/api/run-uploads", "/api/run-assets"],
    workers: ["ai"],
    collections: ["aiJobs", "runEvents", "runDecisions"],
  },
  mcp: {
    configuration: ["mcp"],
    requires: [],
    routes: ["/api/mcp"],
    workers: [],
    collections: [],
  },
  files: {
    configuration: ["assets"],
    requires: [],
    routes: ["/files", "/api/files"],
    workers: ["payment"],
    collections: ["privateFiles"],
  },
  notifications: {
    configuration: [],
    requires: [],
    routes: ["/notifications", "/api/notifications"],
    workers: ["payment"],
    collections: ["notifications", "notificationOutbox"],
  },
  artifacts: {
    configuration: [],
    requires: ["runs"],
    routes: ["/artifacts", "/api/artifacts"],
    workers: ["ai"],
    collections: ["artifacts", "artifactRevisions"],
  },
};
export const project = projectSchema.parse(manifest);
export const namespace = (name: string) => `${project.slug}-${name}`;
export const databasePrefix = project.slug.replaceAll("-", "_");
export const moduleEnabled = (id: ModuleId) =>
  project.modules.includes(id) && (id !== "artifacts" || project.examples);
export function moduleForPath(path: string): ModuleId | undefined {
  return moduleIds.find((id) =>
    moduleDescriptors[id].routes.some(
      (route) => path === route || path.startsWith(route + "/"),
    ),
  );
}

export const requiredWorkers = [
  ...new Set(project.modules.flatMap((id) => moduleDescriptors[id].workers)),
];
export function collectionEnabled(name: string) {
  const owner = moduleIds.find((id) =>
    moduleDescriptors[id].collections.includes(name),
  );
  return !owner || moduleEnabled(owner);
}

export const requiredModuleConfigurations = new Set(
  project.modules
    .filter(moduleEnabled)
    .flatMap((id) => moduleDescriptors[id].configuration),
);

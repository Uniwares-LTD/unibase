import { z } from "zod";
import {
  createRegistry,
  registeredValueSchema,
  type RegisteredValue,
} from "./registry";

const titleSchema = z.string().trim().min(1).max(500);
export const documentContentSchema = z.strictObject({
  title: titleSchema,
  body: z.string().trim().min(1).max(30000),
});
export const imageContentSchema = z.strictObject({
  title: titleSchema,
  assetId: z.string().uuid(),
  caption: z.string().max(4000),
});
export const checklistContentSchema = z
  .strictObject({
    title: titleSchema,
    items: z
      .array(
        z.strictObject({
          id: z.string().uuid(),
          text: z.string().trim().min(1).max(1000),
          done: z.boolean(),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine(
    (content) =>
      new Set(content.items.map((item) => item.id)).size ===
      content.items.length,
    "Checklist IDs must be unique.",
  );
export type ArtifactDefinition = {
  type: string;
  version: number;
  label: string;
  parse: (input: unknown) => RegisteredValue["data"];
  project: (input: unknown) => {
    title: string;
    text: string;
    assetIds: string[];
  };
};
export function defineArtifact<T extends RegisteredValue["data"]>(definition: {
  type: string;
  version: number;
  label: string;
  schema: z.ZodType<T>;
  project: (content: T) => { title: string; text: string; assetIds: string[] };
}): ArtifactDefinition {
  return {
    type: definition.type,
    version: definition.version,
    label: definition.label,
    parse: (input) => definition.schema.parse(input),
    project: (input) => definition.project(definition.schema.parse(input)),
  };
}
export const artifactRegistry = createRegistry<ArtifactDefinition>([
  defineArtifact({
    type: "document",
    version: 1,
    label: "Document",
    schema: documentContentSchema,
    project: (data) => ({ title: data.title, text: data.body, assetIds: [] }),
  }),
  defineArtifact({
    type: "image",
    version: 1,
    label: "Image",
    schema: imageContentSchema,
    project: (data) => ({
      title: data.title,
      text: data.caption,
      assetIds: [data.assetId],
    }),
  }),
  defineArtifact({
    type: "checklist",
    version: 1,
    label: "Checklist",
    schema: checklistContentSchema,
    project: (data) => ({
      title: data.title,
      text: data.items
        .map((item) => `${item.done ? "[x]" : "[ ]"} ${item.text}`)
        .join("\n"),
      assetIds: [],
    }),
  }),
]);
export function parseArtifact(value: unknown): RegisteredValue {
  const envelope = registeredValueSchema.parse(value);
  return {
    ...envelope,
    data: artifactRegistry
      .get(envelope.type, envelope.version)
      .parse(envelope.data),
  };
}
export const artifactContentSchema = registeredValueSchema.transform(
  (value, ctx) => {
    try {
      return parseArtifact(value);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Invalid registered artifact content.",
      });
      return z.NEVER;
    }
  },
);
export function legacyArtifactContent(version: {
  title: string;
  body: string;
  assetId: string | null;
  content?: RegisteredValue;
}): RegisteredValue {
  return (
    version.content ??
    (version.assetId
      ? {
          type: "image",
          version: 1,
          data: {
            title: version.title,
            assetId: version.assetId,
            caption: version.body,
          },
        }
      : {
          type: "document",
          version: 1,
          data: { title: version.title, body: version.body },
        })
  );
}

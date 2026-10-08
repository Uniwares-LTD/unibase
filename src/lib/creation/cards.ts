import { z } from "zod";
import {
  createRegistry,
  registeredValueSchema,
  type RegisteredValue,
} from "./registry";

const text = z.string().trim().min(1).max(500);
const choice = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  label: text,
});
export const questionSchema = z
  .strictObject({
    kind: z.enum(["text", "single", "multiple"]),
    title: text,
    explanation: z.string().max(2000),
    options: z.array(choice).max(12),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.options.map((o) => o.id)).size !== value.options.length ||
      (value.kind === "text"
        ? value.options.length !== 0
        : value.options.length < 2)
    )
      ctx.addIssue({
        code: "custom",
        message: "Question options must match its kind and have unique IDs.",
      });
  });
export type Question = z.infer<typeof questionSchema>;
export function validAnswer(question: Question, value: unknown) {
  if (question.kind === "text")
    return (
      typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= 4000
    );
  const values = Array.isArray(value) ? value : [value];
  return (
    (question.kind === "multiple"
      ? Array.isArray(value)
      : typeof value === "string") &&
    values.length > 0 &&
    values.length <= 12 &&
    new Set(values).size === values.length &&
    values.every(
      (v) => typeof v === "string" && question.options.some((o) => o.id === v),
    )
  );
}
const fieldBase = {
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .refine((id) => !["constructor", "prototype", "__proto__"].includes(id)),
  label: text,
  required: z.boolean(),
};
export const formFieldSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...fieldBase,
    kind: z.literal("text"),
    multiline: z.boolean(),
    maxLength: z.number().int().min(1).max(4000),
  }),
  z.strictObject({
    ...fieldBase,
    kind: z.literal("number"),
    min: z.number().finite(),
    max: z.number().finite(),
  }),
  z.strictObject({ ...fieldBase, kind: z.literal("toggle") }),
  z.strictObject({
    ...fieldBase,
    kind: z.literal("choice"),
    multiple: z.boolean(),
    options: z.array(choice).min(2).max(12),
  }),
]);
export const formCardSchema = z
  .strictObject({
    title: text,
    explanation: z.string().max(2000),
    fields: z.array(formFieldSchema).min(1).max(20),
  })
  .superRefine((form, ctx) => {
    if (new Set(form.fields.map((f) => f.id)).size !== form.fields.length)
      ctx.addIssue({ code: "custom", message: "Field IDs must be unique." });
    for (const field of form.fields) {
      if (field.kind === "number" && field.min > field.max)
        ctx.addIssue({ code: "custom", message: "Invalid number bounds." });
      if (
        field.kind === "choice" &&
        new Set(field.options.map((o) => o.id)).size !== field.options.length
      )
        ctx.addIssue({ code: "custom", message: "Choice IDs must be unique." });
    }
  });
export const summaryCardSchema = z.strictObject({
  title: text,
  body: z.string().max(10000),
});
export const galleryCardSchema = z
  .strictObject({
    title: text,
    items: z
      .array(z.strictObject({ assetId: z.string().uuid(), label: text }))
      .min(1)
      .max(12),
  })
  .refine(
    (value) =>
      new Set(value.items.map((i) => i.assetId)).size === value.items.length,
    "Gallery asset IDs must be unique.",
  );
export const progressCardSchema = z
  .strictObject({
    title: text,
    completed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    label: z.string().max(500),
  })
  .refine((value) => value.completed <= value.total);
export const issueCardSchema = z.strictObject({
  title: text,
  severity: z.enum(["info", "warning", "blocking"]),
  details: z.array(text).min(1).max(20),
});
export const reviewCardSchema = z.strictObject({
  title: text,
  artifactId: z.string().uuid(),
  version: z.number().int().positive(),
  summary: z.string().max(4000),
});

function parseFormAnswer(form: z.infer<typeof formCardSchema>, input: unknown) {
  const values = z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number().finite(),
        z.boolean(),
        z.array(z.string()),
      ]),
    )
    .parse(input);
  if (Object.keys(values).some((id) => !form.fields.some((f) => f.id === id)))
    throw new Error("Unknown form field.");
  const result: Record<string, string | number | boolean | string[]> = {};
  for (const field of form.fields) {
    const value = values[field.id];
    const empty =
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && !value.length);
    if (empty) {
      if (field.required) throw new Error(`Complete ${field.label}.`);
      continue;
    }
    if (field.kind === "text")
      result[field.id] = z
        .string()
        .trim()
        .min(field.required ? 1 : 0)
        .max(field.maxLength)
        .parse(value);
    if (field.kind === "number")
      result[field.id] = z.number().min(field.min).max(field.max).parse(value);
    if (field.kind === "toggle") result[field.id] = z.boolean().parse(value);
    if (field.kind === "choice") {
      if (
        !validAnswer(
          {
            kind: field.multiple ? "multiple" : "single",
            title: field.label,
            explanation: "",
            options: field.options,
          },
          value,
        )
      )
        throw new Error(`Choose an offered value for ${field.label}.`);
      result[field.id] = value!;
    }
  }
  return result;
}
export type CardAction =
  "submit" | "choose" | "acknowledge" | "approve" | "request-revision";
export type CardDefinition = {
  type: string;
  version: number;
  label: string;
  modelAllowed: boolean;
  parse: (value: unknown) => RegisteredValue["data"];
  actions: readonly CardAction[];
  response: (
    data: unknown,
    action: CardAction,
    value: unknown,
  ) => RegisteredValue["data"];
  assets: (data: unknown) => string[];
};
export function defineCard<T extends RegisteredValue["data"]>(definition: {
  type: string;
  version: number;
  label: string;
  modelAllowed: boolean;
  schema: z.ZodType<T>;
  actions: readonly CardAction[];
  response: (
    data: T,
    action: CardAction,
    value: unknown,
  ) => RegisteredValue["data"];
  assets?: (data: T) => string[];
}): CardDefinition {
  return {
    ...definition,
    parse: (data) => definition.schema.parse(data),
    response(data, action, value) {
      if (!definition.actions.includes(action))
        throw new Error("This action is not offered by this card.");
      return definition.response(definition.schema.parse(data), action, value);
    },
    assets: (data) => definition.assets?.(definition.schema.parse(data)) ?? [],
  };
}
const noValue = (_data: unknown, _action: CardAction, value: unknown) =>
  z.null().parse(value);
export const cardRegistry = createRegistry<CardDefinition>([
  defineCard({
    type: "question",
    version: 1,
    label: "Question",
    modelAllowed: true,
    schema: questionSchema,
    actions: ["submit"],
    response: (data, _action, value) => {
      if (!validAnswer(data, value))
        throw new Error("Choose an offered answer.");
      return z.union([z.string().trim(), z.array(z.string())]).parse(value);
    },
  }),
  defineCard({
    type: "form",
    version: 1,
    label: "Form",
    modelAllowed: true,
    schema: formCardSchema,
    actions: ["submit"],
    response: (data, _action, value) => parseFormAnswer(data, value),
  }),
  defineCard({
    type: "summary",
    version: 1,
    label: "Summary",
    modelAllowed: true,
    schema: summaryCardSchema,
    actions: ["acknowledge"],
    response: noValue,
  }),
  defineCard({
    type: "gallery",
    version: 1,
    label: "Gallery",
    modelAllowed: true,
    schema: galleryCardSchema,
    actions: ["choose"],
    response: (data, _action, value) => {
      const id = z.string().uuid().parse(value);
      if (!data.items.some((item) => item.assetId === id))
        throw new Error("Choose an offered image.");
      return id;
    },
    assets: (data) => data.items.map((i) => i.assetId),
  }),
  defineCard({
    type: "progress",
    version: 1,
    label: "Progress",
    modelAllowed: false,
    schema: progressCardSchema,
    actions: [],
    response: noValue,
  }),
  defineCard({
    type: "issue",
    version: 1,
    label: "Issue",
    modelAllowed: true,
    schema: issueCardSchema,
    actions: ["acknowledge"],
    response: noValue,
  }),
  // Approval targets are minted by the server, never nominated by model output.
  defineCard({
    type: "review",
    version: 1,
    label: "Artifact review",
    modelAllowed: false,
    schema: reviewCardSchema,
    actions: ["approve", "request-revision"],
    response: (_data, action, value) =>
      action === "approve"
        ? z.string().trim().max(2000).parse(value)
        : z.string().trim().min(1).max(4000).parse(value),
  }),
]);
export function parseCard(value: unknown, fromModel = false): RegisteredValue {
  const envelope = registeredValueSchema.parse(value);
  const definition = cardRegistry.get(envelope.type, envelope.version);
  if (fromModel && !definition.modelAllowed)
    throw new Error("This card type can only be issued by the application.");
  return { ...envelope, data: definition.parse(envelope.data) };
}
export const generatedCardSchema = registeredValueSchema.transform(
  (value, ctx) => {
    try {
      return parseCard(value, true);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Invalid generated card type, version or payload.",
      });
      return z.NEVER;
    }
  },
);
export const savedCardSchema = z.object({
  id: z.string().uuid(),
  replacesCardId: z.string().uuid().optional(),
  content: registeredValueSchema,
  status: z.enum(["active", "answered", "superseded"]),
  response: z.json().nullable(),
  responseAction: z
    .enum(["submit", "choose", "acknowledge", "approve", "request-revision"])
    .nullable(),
  createdAt: z.string(),
  answeredAt: z.string().nullable(),
  sourceJobId: z.string().nullable(),
});
export type SavedCard = z.infer<typeof savedCardSchema>;

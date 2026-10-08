import { z } from "zod";

export const registeredTypeSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const registeredValueSchema = z.strictObject({
  type: registeredTypeSchema,
  version: z.number().int().min(1).max(10000),
  data: z.json(),
});
export type RegisteredValue = z.infer<typeof registeredValueSchema>;
export type VersionedDefinition = { type: string; version: number };

// Registries are assembled at build time, never populated from model output or
// a request. A persisted version keeps its definition when a new version is added.
export function createRegistry<T extends VersionedDefinition>(
  definitions: readonly T[],
) {
  const entries = new Map<string, T>();
  for (const definition of definitions) {
    registeredTypeSchema.parse(definition.type);
    z.number().int().positive().parse(definition.version);
    const key = `${definition.type}:${definition.version}`;
    if (entries.has(key))
      throw new Error(`Duplicate registered definition: ${key}`);
    entries.set(key, definition);
  }
  return Object.freeze({
    list: () => [...entries.values()],
    get(type: string, version: number) {
      const definition = entries.get(`${type}:${version}`);
      if (!definition)
        throw new Error("This content type or version is not registered.");
      return definition;
    },
  });
}

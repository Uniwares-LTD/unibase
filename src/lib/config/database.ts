import { z } from "zod";

const schema = z.object({
  mongoUri: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  database: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
});

export function parseDatabaseConfig(
  input: Record<string, string | undefined>,
  environment: string,
) {
  const local = environment === "local";
  const result = schema.safeParse({
    mongoUri:
      input.MONGODB_URI ?? (local ? "mongodb://127.0.0.1:27017" : undefined),
    database: input.MONGODB_DATABASE ?? (local ? "unitale_local" : undefined),
  });
  if (!result.success) {
    const names: Record<string, string> = {
      mongoUri: "MONGODB_URI",
      database: "MONGODB_DATABASE",
    };
    throw new Error(
      `Invalid database configuration: ${[...new Set(result.error.issues.map((issue) => names[String(issue.path[0])]))].join(", ")}.`,
    );
  }
  return result.data;
}

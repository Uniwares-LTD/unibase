import { z } from "zod";
import { AppError } from "./auth-policy";

/** Only for caller input. Persisted and provider contracts retain their errors. */
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(
      "INVALID_INPUT",
      "Check the submitted fields and try again.",
      400,
    );
  return result.data;
}

import { z } from "zod";
export const androidConfigSchema = z
  .object({
    host: z
      .string()
      .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
    packageId: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/),
    versionCode: z.number().int().min(1).max(2100000000),
    versionName: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/),
  })
  .strict();
export function parseAndroidConfig(
  input: unknown,
  env: Record<string, string | undefined>,
  release = false,
) {
  const version = z
    .object({ versionCode: z.number(), versionName: z.string() })
    .strict()
    .safeParse(input);
  if (!version.success)
    throw new Error(
      "Invalid android/config.json. Supply versionCode and versionName only.",
    );
  const parsed = androidConfigSchema.safeParse({
    ...version.data,
    host: env.ANDROID_HOST,
    packageId: env.ANDROID_PACKAGE_NAME,
  });
  if (!parsed.success)
    throw new Error(
      "Invalid Android configuration. Set ANDROID_HOST (hostname only) and ANDROID_PACKAGE_NAME in .env.local or the process environment; check version fields in android/config.json.",
    );
  if (
    release &&
    (parsed.data.host.endsWith(".invalid") ||
      parsed.data.host.endsWith(".example") ||
      parsed.data.packageId.startsWith("invalid."))
  )
    throw new Error(
      "Configure the production Android hostname and package ID before release.",
    );
  return parsed.data;
}

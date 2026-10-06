export function assetLinks(
  packageName: string | undefined,
  fingerprints: string | undefined,
) {
  if (!packageName && !fingerprints) return [];
  if (
    !packageName ||
    !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(packageName)
  )
    throw new Error("Invalid ANDROID_PACKAGE_NAME.");
  if (!fingerprints) return [];
  const values = fingerprints
    ?.split(",")
    .map((value) => value.trim().toUpperCase());
  if (
    !values?.length ||
    values.some((value) => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value))
  )
    throw new Error("Invalid ANDROID_SHA256_FINGERPRINTS.");
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: [...new Set(values)],
      },
    },
  ];
}

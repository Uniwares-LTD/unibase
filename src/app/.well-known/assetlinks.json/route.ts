import { assetLinks } from "@/lib/config/android";
import { endpoint, json } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET() {
  return endpoint(async () =>
    json(
      assetLinks(
        process.env.ANDROID_PACKAGE_NAME,
        process.env.ANDROID_SHA256_FINGERPRINTS,
      ),
    ),
  );
}

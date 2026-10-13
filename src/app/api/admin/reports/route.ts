import { administratorReports } from "@/lib/server/reports";
import { endpoint, json } from "@/lib/server/http";
import { reportParameters } from "@/lib/contracts/reports";
export async function GET(request: Request) {
  return endpoint(request, async () =>
    json(
      await administratorReports(
        reportParameters(new URL(request.url).searchParams),
      ),
    ),
  );
}

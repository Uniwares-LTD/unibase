import { endpoint, json } from "@/lib/server/http";
import { database } from "@/lib/server/mongo";
import { FILE_PART_BYTES, putUploadPart } from "@/lib/server/private-files";
import { readBytes } from "@/lib/upload-body";
import { AppError } from "@/lib/auth-policy";
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; part: string }> },
) {
  return endpoint(request, async (actor) => {
    const { id, part } = await context.params;
    if (!/^\d{1,6}$/.test(part))
      throw new AppError("INVALID_INPUT", "Invalid upload part.");
    if (request.headers.get("content-type") !== "application/octet-stream")
      throw new AppError("INVALID_INPUT", "Send the part as raw bytes.", 415);
    // The session is verified before the body is read.
    const bytes = await readBytes(request, FILE_PART_BYTES, 30_000);
    return json(
      await putUploadPart(database(), actor.uid, id, Number(part), bytes),
    );
  });
}

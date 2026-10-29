import { AppError } from "./auth-policy";

/** Bound multipart input independently of Content-Length and client progress. */
export async function readMultipart(
  request: Request,
  fileLimit: number,
  deadlineMs = 30_000,
) {
  const contentType = request.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data"))
    throw new AppError("INVALID_INPUT", "Send a file upload.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_INPUT", "Choose a file.");
  const limit = fileLimit + 1024 * 1024;
  let failure: AppError | undefined;
  let rejectStop: (error: AppError) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  function stop(error: AppError) {
    if (failure) return;
    failure = error;
    rejectStop(error);
    void reader!.cancel().catch(() => undefined);
  }
  const abort = () =>
    stop(new AppError("INVALID_INPUT", "Upload interrupted.", 400));
  const timer = setTimeout(
    () => stop(new AppError("UPLOAD_TIMEOUT", "Upload timed out.", 408)),
    deadlineMs,
  );
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    if (request.signal.aborted) abort();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const consume = async () => {
      for (;;) {
        const { done, value } = await reader.read().catch(() => {
          throw (
            failure ?? new AppError("INVALID_INPUT", "Upload interrupted.", 400)
          );
        });
        if (failure) throw failure;
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          stop(
            new AppError(
              "FILE_TOO_LARGE",
              "File exceeds the upload limit.",
              413,
            ),
          );
          throw failure;
        }
        chunks.push(value);
      }
      try {
        const form = await new Response(new Uint8Array(Buffer.concat(chunks)), {
          headers: { "content-type": contentType },
        }).formData();
        const file = form.get("file");
        if (file instanceof File && file.size > fileLimit)
          throw new AppError(
            "FILE_TOO_LARGE",
            "File exceeds the upload limit.",
            413,
          );
        return form;
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError("INVALID_INPUT", "Invalid multipart upload.");
      }
    };
    return await Promise.race([stopped, consume()]);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    // Cancellation must not wait for an uncooperative underlying stream.
    void reader.cancel().catch(() => undefined);
  }
}

export async function readText(request: Request, limit = 20000) {
  // Bound even chunked requests rather than trusting Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_INPUT", "Request body is required.");
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new AppError("INVALID_INPUT", "Request is too large.", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

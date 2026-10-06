import "server-only";

// Handles split UTF-8, CRLF (including split CR/LF), comments and multiline data.
// The reader is cancelled even if persistence fails or the consumer stops early.
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  limits = { totalBytes: 16 * 1024 * 1024, frameBytes: 2 * 1024 * 1024 },
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let total = 0;
  let frameSize = 0;
  let data: string[] = [];
  function line(value: string): unknown[] {
    frameSize += Buffer.byteLength(value, "utf8") + 1;
    if (frameSize > limits.frameBytes)
      throw new Error("AI stream frame limit.");
    if (value === "") {
      const result = data.length
        ? [JSON.parse(data.join("\n")) as unknown]
        : [];
      data = [];
      frameSize = 0;
      return result;
    }
    if (value.startsWith("data:")) data.push(value.slice(5).replace(/^ /, ""));
    return [];
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) {
        total += value.byteLength;
        if (total > limits.totalBytes) throw new Error("AI stream size limit.");
      }
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      for (;;) {
        const index = buffer.search(/[\r\n]/);
        if (
          index < 0 ||
          (!done && buffer[index] === "\r" && index === buffer.length - 1)
        )
          break;
        const width =
          buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
        const current = buffer.slice(0, index);
        buffer = buffer.slice(index + width);
        for (const event of line(current)) yield event;
      }
      if (Buffer.byteLength(buffer, "utf8") + frameSize > limits.frameBytes)
        throw new Error("AI stream frame limit.");
      if (done) break; // Incomplete final frame is not authoritative evidence.
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

import "server-only";
import { createClient } from "redis";

// Shared Redis connection for request protection and diagnostic rate limits.
// Commands fail fast instead of queueing while disconnected.
const newClient = (url: string) =>
  createClient({
    url,
    socket: { connectTimeout: 1500, reconnectStrategy: false },
    disableOfflineQueue: true,
  });
export type RedisClient = ReturnType<typeof newClient>;
let connection:
  | {
      url: string;
      client: RedisClient;
      ready: Promise<unknown>;
    }
  | undefined;
export async function redis(url: string) {
  if (!connection || connection.url !== url) {
    if (connection?.client.isOpen) connection.client.destroy();
    const client = newClient(url);
    client.on("error", () => {});
    const ready = client.connect();
    connection = { url, client, ready };
    ready.catch(() => {
      if (connection?.client === client) connection = undefined;
    });
  }
  const current = connection!;
  await current.ready;
  return current.client;
}
/** Drop a broken connection so the next command reconnects. */
export function resetBrokenRedis() {
  if (connection && !connection.client.isReady) {
    if (connection.client.isOpen) connection.client.destroy();
    connection = undefined;
  }
}

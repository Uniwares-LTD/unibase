import "server-only";
import { z } from "zod";
import type { Db, Filter } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import { aiJobs, type AiJob } from "./jobs";

export async function aiHistory(
  db: Db,
  filter: Filter<AiJob>,
  cursor?: string,
  oldestFirst = false,
) {
  const direction = oldestFirst ? 1 : -1;
  let boundary: Filter<AiJob> = {};
  if (cursor) {
    try {
      if (cursor.length > 512) throw new Error();
      const [date, id] = z
        .tuple([z.iso.datetime(), z.string().regex(/^[a-f0-9]{64}$/)])
        .parse(JSON.parse(Buffer.from(cursor, "base64url").toString()));
      const operator = oldestFirst ? "$gt" : "$lt";
      boundary = {
        $or: [
          { createdAt: { [operator]: new Date(date) } },
          { createdAt: new Date(date), _id: { [operator]: id } },
        ],
      };
    } catch {
      throw new AppError("INVALID_CURSOR", "Invalid history cursor.");
    }
  }
  const rows = await aiJobs(db)
    .find({ $and: [filter, boundary] })
    .sort({ createdAt: direction, _id: direction })
    .limit(26)
    .toArray();
  const last = rows[24];
  return {
    rows: rows.slice(0, 25),
    next:
      rows.length > 25
        ? Buffer.from(
            JSON.stringify([last.createdAt.toISOString(), last._id]),
          ).toString("base64url")
        : null,
  };
}

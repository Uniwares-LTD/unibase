import "server-only";
import { MongoServerError, type Db, type ClientSession } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import { accessPermitsSession, type AccountAccess } from "../store/access";
export type WorkspaceActor = { uid: string; authTime: number };
type Actor = WorkspaceActor;
export async function workspaceTransaction<T>(
  db: Db,
  actor: Actor,
  run: (session: ClientSession) => Promise<T>,
) {
  const access = db.collection<AccountAccess>("accountAccess");
  try {
    await access.updateOne(
      { _id: actor.uid },
      {
        $setOnInsert: {
          role: "member",
          status: "active",
          notBefore: 0,
          revision: 0,
          updatedAt: new Date(0),
        },
      },
      { upsert: true },
    );
  } catch (e) {
    if (!(e instanceof MongoServerError) || e.code !== 11000) throw e;
  }
  const session = db.client.startSession();
  try {
    return await session.withTransaction(
      async () => {
        const record = await access.findOneAndUpdate(
          { _id: actor.uid },
          { $inc: { revision: 1 } },
          { session, returnDocument: "after" },
        );
        if (!record || !accessPermitsSession(record, actor.authTime))
          throw new AppError(
            "FORBIDDEN",
            "This account is not accessible.",
            403,
          );
        return run(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
  } finally {
    await session.endSession();
  }
}

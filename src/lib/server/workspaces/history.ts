import "server-only";
import { z } from "zod";
import type { Db, ClientSession, Filter } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import type { TimelineEntry } from "@/lib/contracts/workspace-history";
import type { WorkspaceCommand } from "@/lib/contracts/workspace";
import type { Workspace } from "./store";
export type WorkspaceEvent = Omit<TimelineEntry, "id" | "at"> & {
  _id: string;
  uid: string;
  workspaceId: string;
  createdAt: Date;
};
export const workspaceEvents = (db: Db) =>
  db.collection<WorkspaceEvent>("workspaceEvents");
export async function workspaceHistory(
  db: Db,
  uid: string,
  workspaceId: string,
  cursor?: string,
) {
  let boundary: Filter<WorkspaceEvent> = {};
  if (cursor) {
    try {
      if (cursor.length > 512) throw new Error();
      const [date, id] = z
        .tuple([z.iso.datetime(), z.string().regex(/^[a-f0-9]{64}$/)])
        .parse(JSON.parse(Buffer.from(cursor, "base64url").toString()));
      boundary = {
        $or: [
          { createdAt: { $lt: new Date(date) } },
          { createdAt: new Date(date), _id: { $lt: id } },
        ],
      };
    } catch {
      throw new AppError("INVALID_CURSOR", "Invalid conversation cursor.");
    }
  }
  const rows = await workspaceEvents(db)
    .find({ $and: [{ uid, workspaceId }, boundary] })
    .sort({ createdAt: -1, _id: -1 })
    .limit(26)
    .toArray();
  const last = rows[24];
  return {
    entries: rows.slice(0, 25).map(({ _id, createdAt, role, kind, parts }) => ({
      id: _id,
      at: createdAt.toISOString(),
      role,
      kind,
      parts,
    })),
    next:
      rows.length > 25
        ? Buffer.from(
            JSON.stringify([last.createdAt.toISOString(), last._id]),
          ).toString("base64url")
        : null,
  };
}
export async function appendCommandEvent(
  db: Db,
  workspace: Workspace,
  command: WorkspaceCommand,
  operationId: string,
  session: ClientSession,
) {
  const parts: TimelineEntry["parts"] = [];
  let role: TimelineEntry["role"] = "user";
  if (command.action === "message")
    parts.push({ type: "text", text: command.text });
  else if (command.action === "retry-candidate")
    parts.push(
      {
        type: "text",
        text: `Started a new attempt for candidate ${command.index + 1}.`,
      },
      { type: "batch", batchId: command.key },
    );
  else if (command.action === "batch")
    parts.push(
      { type: "text", text: command.prompt },
      { type: "batch", batchId: command.key },
    );
  else if (command.action === "select") {
    role = "assistant";
    parts.push(
      {
        type: "text",
        text: `Candidate ${command.index + 1} selected and saved.`,
      },
      { type: "batch", batchId: command.batchId },
    );
    const batch = workspace.batches.find((b) => b.id === command.batchId)!;
    const jobId = batch.items[command.index].jobId;
    for (const artifact of workspace.artifacts) {
      const version = artifact.versions.find((v) => v.sourceJobId === jobId);
      if (version)
        parts.push({
          type: "artifact",
          artifactId: artifact.id,
          version: version.number,
        });
    }
    for (const card of workspace.uiCards.filter((c) => c.sourceJobId === jobId))
      parts.push({ type: "card", cardId: card.id });
  } else if (command.action === "respond-card") {
    parts.push(
      { type: "text", text: `Saved ${command.cardAction} response.` },
      { type: "card", cardId: command.cardId },
    );
  } else if (command.action === "save" || command.action === "save-content") {
    parts.push({ type: "text", text: "Saved a new artifact version." });
    const artifact = command.artifactId
      ? workspace.artifacts.find((a) => a.id === command.artifactId)!
      : workspace.artifacts.at(-1)!;
    parts.push({
      type: "artifact",
      artifactId: artifact.id,
      version: artifact.versions.at(-1)!.number,
    });
  } else
    parts.push({
      type: "text",
      text:
        command.action === "pause"
          ? command.paused
            ? "Paused new work."
            : "Resumed new work."
          : `Saved workspace action: ${command.action}.`,
    });
  await workspaceEvents(db).insertOne(
    {
      _id: operationId,
      uid: workspace.uid,
      workspaceId: workspace.id,
      createdAt: new Date(),
      role,
      kind: command.action,
      parts,
    },
    { session },
  );
}
export async function recentConversationContext(
  db: Db,
  uid: string,
  workspaceId: string,
  session: ClientSession,
) {
  const messages = await workspaceEvents(db)
    .find({ uid, workspaceId, kind: "message" }, { session })
    .sort({ createdAt: -1, _id: -1 })
    .limit(12)
    .toArray();
  return messages
    .reverse()
    .flatMap((m) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])))
    .join("\n")
    .slice(-8000);
}

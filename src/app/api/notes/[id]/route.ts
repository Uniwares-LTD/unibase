// Sample: notes. Owned update and deletion; other accounts' notes are 404.
import { AppError } from "@/lib/auth-policy";
import { endpoint, json, readJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { database } from "@/lib/server/mongo";
import { noteIdSchema, noteInputSchema } from "@/samples/notes/contract";
import { deleteNote, updateNote } from "@/samples/notes/store";

async function noteId(params: Promise<{ id: string }>) {
  const parsed = noteIdSchema.safeParse((await params).id);
  if (!parsed.success)
    throw new AppError("NOTE_NOT_FOUND", "This note is unavailable.", 404);
  return parsed.data;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return endpoint(request, async () => {
    const actor = await requireSession();
    const id = await noteId(params);
    const input = await readJson(request, noteInputSchema);
    return json(await updateNote(database(), actor.uid, id, input));
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return endpoint(request, async () => {
    const actor = await requireSession();
    await deleteNote(database(), actor.uid, await noteId(params));
    return json({ ok: true });
  });
}

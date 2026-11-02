// Sample: notes. endpoint() applies module gating, CSRF, session and limits;
// protected user data requires a verified email, like files and Runs.
import { endpoint, json, readJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { database } from "@/lib/server/mongo";
import { noteInputSchema } from "@/samples/notes/contract";
import { createNote, listNotes } from "@/samples/notes/store";

export async function GET(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireSession();
    return json(await listNotes(database(), actor.uid));
  });
}

export async function POST(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireSession();
    const input = await readJson(request, noteInputSchema);
    return json(await createNote(database(), actor.uid, input), 201);
  });
}

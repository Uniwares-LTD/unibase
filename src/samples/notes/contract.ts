// Sample: notes. Reference feature for project extensions; remove it with
// `npm run samples:remove -- notes`. See src/samples/README.md.
import { z } from "zod";

export const noteInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  body: z.string().max(5000),
});
export const noteSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const noteListSchema = z.strictObject({ rows: z.array(noteSchema) });
export const noteIdSchema = z.string().uuid();
export type NoteInput = z.infer<typeof noteInputSchema>;
export type Note = z.infer<typeof noteSchema>;
export const noteLimit = 100;

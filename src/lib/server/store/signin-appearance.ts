import "server-only";
import type { Db } from "mongodb";
import { sessionAppearanceSchema } from "../../contracts/profile";

// The caller supplies a verified identity. Preferences never determine access.
export async function signinAppearance(db: Db, uid: string) {
  try {
    const saved = await db.collection("profiles").findOne(
      { uid },
      {
        projection: { _id: 0, theme: 1, style: 1 },
        timeoutMS: 1000,
      },
    );
    const result = sessionAppearanceSchema.safeParse(saved);
    return result.success ? result.data : undefined;
  } catch {
    // Missing, invalid or unavailable preferences must not prevent sign-in.
    return undefined;
  }
}

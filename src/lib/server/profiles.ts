import "server-only";
import { MongoServerError } from "mongodb";
import {
  profileSchema,
  profileUpdateSchema,
  type Profile,
} from "../contracts/profile";
import { AppError } from "../auth-policy";
import { database } from "./mongo";
import { requireSession } from "./session";

async function currentProfile() {
  const session = await requireSession();
  const collection = database().collection<Profile>("profiles");
  const now = new Date().toISOString();
  try {
    await collection.updateOne(
      { uid: session.uid },
      {
        $setOnInsert: {
          uid: session.uid,
          email: session.email!,
          displayName:
            String(session.name ?? session.email!.split("@")[0])
              .trim()
              .slice(0, 80) || "Member",
          theme: "system",
          style: "default",
          updatedAt: now,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // Concurrent first requests can race on the unique UID index.
    if (!(error instanceof MongoServerError) || error.code !== 11000)
      throw error;
  }
  const document = await collection.findOne(
    { uid: session.uid },
    { projection: { _id: 0 } },
  );
  return { session, collection, profile: profileSchema.parse(document) };
}
export async function getMyProfile() {
  return (await currentProfile()).profile;
}
export async function updateMyProfile(input: unknown) {
  const parsed = profileUpdateSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      "INVALID_INPUT",
      "Enter a name and a valid appearance preference.",
    );
  const { session, collection } = await currentProfile();
  const document = await collection.findOneAndUpdate(
    { uid: session.uid },
    {
      $set: {
        ...parsed.data,
        email: session.email!,
        updatedAt: new Date().toISOString(),
      },
    },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return profileSchema.parse(document);
}

import "server-only";
import type { Db } from "mongodb";
// Additive, repeatable metadata only. Accepted version 1 artifact handlers stay available.
export async function migrateDomainReferences(db: Db) {
  const jobs = await db.collection("aiJobs").updateMany(
    {
      "run.artifactId": { $type: "string" },
      "run.target": { $exists: false },
    },
    [
      {
        $set: {
          "run.target": {
            adapter: "artifact",
            version: "1",
            kind: "artifact",
            id: "$run.artifactId",
          },
        },
      },
    ],
  );
  const applications = await db
    .collection("resultApplications")
    .updateMany(
      { artifactId: { $type: "string" }, target: { $exists: false } },
      [
        {
          $set: {
            target: {
              adapter: "artifact",
              version: "1",
              kind: "artifact",
              id: "$artifactId",
            },
          },
        },
      ],
    );
  return { jobs: jobs.modifiedCount, applications: applications.modifiedCount };
}

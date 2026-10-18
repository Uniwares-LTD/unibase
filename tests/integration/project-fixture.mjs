import manifest from "../../project.config.json" with { type: "json" };

// Identity comes from the reviewed project, never a private runtime override.
if (!/^[a-z][a-z0-9-]{2,39}$/.test(manifest.slug))
  throw new Error("Invalid fixture project identity.");
export const fixtureProjectId = `demo-${manifest.slug}`;
export const fixtureDatabasePrefix = `${manifest.slug.replaceAll("-", "_")}_test_`;
export const fixtureDatabasePattern = new RegExp(
  `^${fixtureDatabasePrefix}[a-f0-9]+$`,
);
export const fixtureCookie = (name) => `${manifest.slug}-${name}`;
export const fixtureRedisPrefix = `${manifest.slug}:local:limits:`;

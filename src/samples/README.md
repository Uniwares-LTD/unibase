# Samples

Samples are working features that show how a project uses the template. They are
not core services: a derived project keeps, adapts or removes each one.

[samples.json](../../samples.json) is the authority. Each sample declares the paths
it owns, the modules it adds to `project.config.json`, its `ui` message keys, its
MCP permissions and the samples it requires. Registry lines in `src/project/` end
with `// sample:<name>`. Sample source starts with a `Sample: <name>` comment.

- `npm run samples` lists samples.
- `npm run check:samples` verifies that every sample is removable: declared paths
  and messages exist, and nothing outside the sample imports it except marked
  registry lines.
- `npm run samples:remove -- <name>` deletes the sample and its registrations, then
  regenerates translation inventories and environment docs. Add `--dry-run` to
  preview. Run typecheck, build and tests afterwards and review the diff.

Stored data is not deleted: a removed sample's collections stay in the database.

## Notes

`src/samples/notes` is the reference feature for project extensions. It shows, end to
end:

- a zod contract (`contract.ts`) and owned persistence (`store.ts`);
- thin Route Handlers under `src/app/api/notes` using `endpoint()`, which applies
  module gating, CSRF, session and rate limits;
- a page under `src/app/notes` with a client panel and translated copy;
- an English administration page under `src/app/admin/notes`;
- a navigation link and admin section (`extension.ts`);
- an MCP tool, index setup and a migration (`server.ts`).

MCP service credentials never identify an account, so the notes tool only
validates drafts.

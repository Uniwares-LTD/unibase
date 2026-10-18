# Orchestrator templates

Each JSON file contains public metadata, required MCP tool names and a complete
Dify DSL. `index.ts` loads them on the server and binds the selected authorized MCP
provider when importing. Never put credentials, deployment URLs or real user data
in templates.

Dify requires End output names to be unique across the entire graph, including
mutually exclusive branches. Approved branches export `result`; unapproved draft
branches export only `draft_result`. Both carry the same validated version-1
envelope, preserving the draft's `partial` outcome. Keep these names unique when
editing a destination workflow; changing repository JSON does not repair existing
Dify drafts or publications.

- `document-summary.json`: reference document → Brief/Detailed → summary.

Document summary demonstrates empty Start inputs, MCP structured JSON, native Human
Input with Generative UI, and a prompted LLM/End output. Configure its model in Dify.
Responses may be raw text or UI JSON keyed by card ID.

To add a template, add its JSON file and server import in `index.ts`, allowlist its
ID in `src/lib/contracts/orchestrator-templates.ts`, and add its MCP requirements.
Use supported node/output contracts and verify the embedded Code with actual tool
outputs and the Unibase answer format. Refresh Dify tool metadata before creation.

- `saved-artifact.json`: private Run context → owned draft read/save → revision-bound approval/decline → synthetic retained image. Start this from an owned artifact.
- `story-panel.json` (Unitale): model-free J01-J13 comic simulation with narrative choices, reference-plan review, human-only saved-package approval, and nine retained schematic PNG placeholders. Start from an owned artifact with **User**. Dify Code sandbox and private MCP are required; models and image plugins are not.

Private tools bind the server-filled `context` directly; never send that
value to a prompt. The artifact sample's approval metadata is rendered dynamically
and validated against the saved revision. Persona completions receive no private
capabilities and cannot call product tools.
Persona completions are configured in Persona administration and use a direct
OpenAI-compatible model API; they are not Orchestrator templates. Only public
question/context data is sent to them. Raw workflows need a paragraph `response`
input and a `continue` action for automatic answers. Private-MCP graphs still
snapshot the actual hidden input name; existing `unibase_context` graphs retain
their binding.
Unibase still checks rendering definitions, payload bounds, ownership and approval
permissions; MCP tools retain typed arguments.

Unitale groups the POC's J01-J13 responsibilities into deterministic Python nodes.
Its fixed kite-rescue example retains the initial idea as data rather than
interpreting it. The first form uses card `review`, optional `title` (80 characters)
and required `ending` (`share` or `celebrate`). Save response, then Apply choices.
The parser accepts UI JSON keyed by `review`, optionally wrapped in `answers`;
unsupported natural-language answers fail explicitly.

The reference review accepts Approve/Decline. Its Continue path accepts only the
exact `approve` token or a JSON object with `action: "approve"`; other answers stop.
This review confirms the plan, not an artifact approval. After pagination, the full
compact simulation package is saved within the existing 8,000-character artifact
contract. Final approval binds its saved revision/hash and requires a human.
Final Continue and Decline return `partial` without images. Reference decline
stops before saving the new package. No intermediate package is falsely approved.

The successful End returns nine inline PNG fixtures and two galleries through
the existing version-1 envelope. The server normalizes/promotes these into owned
private assets: two style placeholders, two character sheets, one location sheet,
cover and three pages. Images are schematic fixed fixtures; they do not depict
all planned sheet views or render chosen title/lettering. Exact intended text and
source routing remain in J11/J12. No native provider files, model execution, PDF,
new domain collections, runtime agents or POC-specific accounting are introduced.
Configured Run pricing still applies; simulated provider work does not imply a
zero-credit Run. Use User mode: final human-only approval cannot be delegated.

`project.config.json.examples` controls sample visibility and creation. Application
mode exposes no example templates; example mode explicitly
exposes four samples. Catalog picker and Quote approval were removed as
overlapping examples. Unitale retains the `story-panel` ID for creation-journal
compatibility; newly imported Dify apps are named Unitale. Accepted work retains its handler/binding snapshots. The JSON
catalog is the current source; `dify/` YAML files are historical compatibility
fixtures. Adding an ID also requires translation of its administrative presentation
and verification of its tool permissions, owned target and provider prerequisites.

## Case preparation

`case-preparation.json` is a country-neutral general case-preparation sample.
It uses the same private Run capability and owned artifact adapter as Unitale.
Create imports a private draft and returns `setup-required`; it does not publish,
register, enable or generate an API key. Retrying the same creation key returns
that draft without overwriting edits. Existing templates retain automatic setup.

In the destination Dify workspace:

1. Set the workflow environment variable `jurisdiction` to the country/jurisdiction
   and scope you intend. No country or real legal source ships in this template.
2. Create and index a Dify Knowledge base containing the reviewed law for that
   jurisdiction. Bind it to **Search configured country law knowledgebase**.
   Use a dedicated country corpus or configure metadata filters yourself; setting
   the environment variable alone does not filter a mixed-country dataset.
3. Preserve source titles and document/segment IDs; provide article/section,
   effective date, version and source URL as document metadata where available.
   This sample retains up to three passages. Configure chunking/retrieval for the
   12,000-character per-passage and 45,000-character serialized context limits.
4. Configure the text and image LLM nodes. **Transcribe voice recording** deliberately
   has no selected model: choose a model/provider with native audio input supported
   by your Dify installation. Its attachment selector is the `audio` Start input.
   A text-only model or the app's speech-to-text toggle is insufficient.
5. Ensure the Dify Code sandbox is available and Unibase MCP has explicit
   Run-context/artifact read/save/approval permissions. Configure document OCR if
   needed. Review and test the draft in Dify; publish it, then Register it in Unibase.

Each Run accepts required case notes plus one optional text/PDF document, one image
and one MP3/WAV recording. Upload bounds/ownership remain the shared file service's
contracts. This sample does not add batch uploads or browser microphone capture.
Text extraction rejects empty output (including scans without OCR); upload a scan
as an image or configure OCR in Dify. Extracted document text is limited to 30,000
characters. Image reading and audio transcription depend on configured model
capabilities; neither is proven by the template's local fixture tests.

The workflow extracts evidence, asks for factual corrections, creates research
questions, retrieves law, and drafts analysis using those passages as its only legal
authority. Corrections remain distinguished from documentary evidence. No law
retrieved means the analysis LLM is bypassed and the result is explicitly partial.
JSON analysis is checked for known, nonempty source-ID references; invented or
missing IDs fail before saving. These structural checks cannot establish semantic
support, correctness, current law or corpus completeness. A lawyer must verify them.

The saved brief preserves the reviewed facts, analysis, source metadata and exact
source excerpts (up to the first 600 characters per passage, explicitly labelled).
Full passages remain in the Run retrieval trace subject to its normal retention.
Factual summaries and rendered analysis each have a 2,000-character bound; the
final brief must fit the existing 8,000-character artifact contract, otherwise the
workflow fails explicitly without silently truncating the brief. It saves a draft
before final review. Approve binds the saved revision/hash and requires a human;
Decline and persona Continue keep it unapproved. Approval with no retrieved law
still yields a partial factual brief. No court filing, deadline calculation,
external research, law ingestion UI or separate matter domain is included.

Node contracts were checked against Dify 1.17.1 and its graphon 0.7.0 engine:
[builder node contracts](https://github.com/langgenius/dify/blob/1.17.1/api/core/workflow/generator/prompts/builder_prompts.py),
[knowledge retrieval](https://github.com/langgenius/dify/blob/1.17.1/api/core/workflow/nodes/knowledge_retrieval/entities.py)
and [workflow engine](https://github.com/langgenius/graphon).

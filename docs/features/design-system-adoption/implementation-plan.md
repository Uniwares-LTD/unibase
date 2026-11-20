# Design-system adoption implementation plan

Issue: [unibase#53](https://github.com/Uniwares-LTD/unibase/issues/53). This plan covers the
**whole** Unibase adoption of the design handoff package, not only the visible foundation.
Every delta row is assigned to a checkpoint in the [delta ledger](delta-ledger.md) (143 rows,
none unassigned), and every open question the package leaves "to confirm at adoption" is
assigned to a checkpoint below. When this plan is done, Unibase is ready for the next issue,
the Unitale UI implementation, which receives these changes through a template release.

Plan state: **proposed**. Accepting the plan authorizes nothing by itself. Each checkpoint
names its own approval.

## Contract and decisions

- **Source of truth.** The design package in `Uniwares-LTD/unitale-design`, pinned here at
  `493e13b83635280f74ce97784c25a64d6259ea36` (call it P):
  - [adoption baseline](https://github.com/Uniwares-LTD/unitale-design/blob/493e13b83635280f74ce97784c25a64d6259ea36/docs/design-system/unibase/adoption/baseline.md): delta rows, D-01 to D-13, checkpoints U0 to U5, the acceptance record;
  - [implementation specifications](https://github.com/Uniwares-LTD/unitale-design/blob/493e13b83635280f74ce97784c25a64d6259ea36/docs/design-system/unibase/adoption/implementation-specs.md): the foundation migration and §1 to §11;
  - [known gaps](https://github.com/Uniwares-LTD/unitale-design/blob/493e13b83635280f74ce97784c25a64d6259ea36/docs/design-system/unibase/adoption/known-gaps.md): UG-001 to UG-019;
  - [open decisions](https://github.com/Uniwares-LTD/unitale-design/blob/493e13b83635280f74ce97784c25a64d6259ea36/docs/design-system/unibase/decisions.md#open);
  - [Extending Unibase](https://github.com/Uniwares-LTD/unitale-design/blob/493e13b83635280f74ce97784c25a64d6259ea36/docs/design-system/unibase/extending.md): the derived-project theme convention;
  - proposals: [design-system documentation](https://github.com/Uniwares-LTD/unitale-design/blob/493e13b83635280f74ce97784c25a64d6259ea36/docs/design-system/unibase/adoption/proposals/unibase-design-system.md) (DOC-01), [agent guidance](https://github.com/Uniwares-LTD/unitale-design/blob/493e13b83635280f74ce97784c25a64d6259ea36/docs/design-system/unibase/adoption/proposals/unibase-agent-guidance.md) (AGT-01), [`build-ui` skill](https://github.com/Uniwares-LTD/unitale-design/blob/493e13b83635280f74ce97784c25a64d6259ea36/docs/design-system/unibase/adoption/proposals/unibase-ui-skill/SKILL.md) (SKL-01);
  - [verification record](https://github.com/Uniwares-LTD/unitale-design/blob/493e13b83635280f74ce97784c25a64d6259ea36/docs/design-system/unibase/adoption/checklist.md#foundation-verification-record).
- **Accepted revision.** Implementation uses the revision a human records in the package's
  acceptance record. If it differs from P, regenerate the ledger and review the difference before U1.
- **Unibase base.** `main` at `37aac48` (the handoff targets `a7eda79`; `37aac48` adds only the
  merge-commit guidance). Handbook baseline `c1b6166`. Template `0.4.0`; Unitale tracks `0.4.0`.
- **Package decisions carried in.**
  - D-01: vivid preset colours, the status-colour revision, 12 type roles and field density.
  - D-02 and D-08: Sonner as the toast, with a hash-based CSP change.
  - D-03: contrast adjustments of at most two ramp steps.
  - D-04: documentation and guidance are ready-to-apply drafts, applied by this plan.
  - D-05: type roles as additive theme keys.
  - D-06: one additive `lg` field size; the default is unchanged.
  - D-09: Button keeps its `cva` API.
  - D-10: leave-guard scope.
  - D-11: Field from the shadcn registry `field` item.
  - D-12: Lucide stays separate and optional.
  - D-13: DTCG tokens are the source.
- **D-07, partly superseded.** D-07 keeps Unitale brand adoption out of Unibase, and that still holds: the Unitale theme is DEF-01, in the Unitale repository. This plan adds U6, which gives derived projects a **seam** for their own theme and fonts. Without it, the Unitale UI issue can't start. The seam is generic and names no project.
- **Decided in this plan.**
  1. Copy the two generated stylesheets into `src/styles/design-system/`, unedited, with the revision recorded in each.
  2. Delete `classic.css` and `soft-blue.css` at U4.
  3. Every checkpoint is its own PR, merged with a merge commit, and can be reverted on its own.
  4. **Deviation:** AGT-01 and SKL-01 move from U1 to U5. Their text describes `Field`, `SubmitButton`, the toast and the leave guard, which only exist after U2, U2-S and U4. Recorded in the U5 deviation table.
  5. **Type roles must be overridable by a derived project.** As generated today, `tailwind-theme.css` writes literal values into an `@theme inline` block, so a project theme can't change them. The Unitale theme changes several of them, under the names `--text-<role>-size`, `-leading`, `-weight` and `-tracking`, and calls Unibase's `field` role `input`. Recommended default, a package change before U4 (gate G12):
     - The package generator emits each role key as a variable with the current value as fallback, for example `--text-hero: var(--text-hero-size, 2.5rem)` and `--text-hero--font-weight: var(--text-hero-weight, 600)`.
     - The Unitale generator maps its `input` role to Unibase's `field` key.
     - Unibase renders identically without a project theme; a project overrides the `-size`, `-leading`, `-weight` and `-tracking` variables in its theme.
     - U4 vendors that revision.
  6. `lg` field size (FLD-02) and the leave guard (LVG-01) are applied to existing screens only where allowed: `lg` needs explicit `visible` approval per screen, and LVG-01 applies only where a feature has real saving or offers Discard alone (spec §6).
- **Out of Unibase entirely**, with the owner named:
  - DEF-01 (Unitale theme): the Unitale UI issue.
  - DEF-05 (service-dependent recovery) and DEF-06 (owned history), UG-004 (per-feature submission and limits) and UG-008 (revisions, locks, stale approvals): the consuming feature in the Unitale UI issue.
  - UG-009 (commercial policy), UG-010 (prototype scope) and UG-013 (original brief provenance): Unitale product owners.
  - UG-001's remaining application font-consumer mapping: the U6 font path, then the Unitale UI issue.

**Known-gap mapping.** Every package gap, UG-001 to UG-019, has a place:

| Gap | Where it's handled |
| --- | --- |
| UG-001 font hooks | TOK-01 at U4; the font path at U6; consumer mapping in the Unitale UI issue |
| UG-002 retained values and geometry | KEEP-02, checked at U4 and U5 |
| UG-003 Lucide candidate | DEF-04, optional at U6 |
| UG-004 per-feature submission and limits | consuming feature (Unitale UI issue) |
| UG-005 simulated recovery | DEF-05, consuming feature |
| UG-006 confirmation duration | TOK-02 at U4; TST-01/02 at U2-S |
| UG-007 leave guard | LVG-01 at U2 and U3 |
| UG-008 revisions and approvals | consuming feature (Unitale UI issue) |
| UG-009 commercial policy | Unitale product owners |
| UG-010 prototype scope | Unitale product owners |
| UG-011 creator UI and history | DEF-06, consuming feature |
| UG-012 evidence limits | U5 evidence classification and human checks |
| UG-013 brief provenance | Unitale product owners |
| UG-014 RTL fixes | RTL-01 to RTL-04 at U2 |
| UG-015 touch sizes | TCH-02 at U1; TCH-01 and TCH-03 at U2 |
| UG-016 toast CSP | G5 and U2-S |
| UG-017 missing media | MED-01 at U2 and U3 |
| UG-018 project style seam | U6 theme seam (G9) |
| UG-019 regression tooling | U0 decision: scripted captures, no new dependency |

## Execution prerequisites

**Human gates.** None are met yet.

| Gate | Blocks | Who |
| --- | --- | --- |
| G1. Package acceptance record filled: accepted revision, accepting reviewer, maintenance owner, date | everything from U0 | team (named reviewer) |
| G2. Engineering handoff review held and recorded (unitale-mockup#7) | U1 onward | team |
| G3. Approval of this plan and its checkpoint order | U0 | issue owner |
| G4. Explicit approval of AGT-01 and SKL-01 (`configuration`) | U5 guidance | Unibase maintainers |
| G5. Security review of TST-01 and TST-02: approve the CSP hashes, or choose another toast approach (UG-016) | U2-S | Unibase security reviewer |
| G6. Dark warning surface `#431407` decided | U4 | Unibase reviewers |
| G7. Explicit approval of the U4 foundation (99 `visible` colour rows plus type roles) | U4 | Unibase reviewers |
| G8. Native review of the Arabic strings in spec §9 | merge of U2 | native speaker |
| G9. The U6 decisions: theme seam shape and `data-project`, type-role overrides, fonts, unconsumed project tokens, letter-spacing unit | U6 | Unibase maintainers with the Unitale owner |
| G10. Template release and tag authorization | U6 release | repository owner |
| G11. Per-screen approval for applying `lg` to existing forms, if wanted | that part of U3 | Unibase reviewers |
| G12. The package change that makes type roles overridable (decision 5) is merged in `unitale-design` and becomes the accepted revision | U4 | package owner, then G1 reviewer |

**Environment.**
- Node 24 with `npm.cmd ci`.
- A local run that works without cloud credentials.
- Headless browser sessions through the Playwright skill, with captures under `output/playwright/`, which is not committed.
- `/design-system` works in development only. Stop the dev server before `npm.cmd run build`, because they share `.next`.

**Standing rules** (from Unibase's agent guidance):
- typed catalogs, page-scoped dictionaries and logical RTL;
- admin stays English/LTR;
- CSP nonces are preserved;
- shadcn primitives are added through the CLI;
- semantic theme variables only;
- a `CHANGELOG.md` `## Unreleased` entry for every reusable change, with upgrade notes when derived projects must act;
- behaviour tests, not source-mirroring tests;
- a separate read-only review at each checkpoint.

## Budget and risk control

| Checkpoint | Risk | PRs | Approx. files | Can stop after it? |
| --- | --- | --- | --- | --- |
| U0 Gate and baseline | none | 0 (evidence only) | 0 | yes |
| U1 Seams, no visual change | none | 1 | ~3 | yes |
| U2 Shared helpers in the showcase | low | 1 | ~22 | yes |
| U2-S Toast and CSP | security | 1 | ~10 | yes; skipped if G5 rejects |
| U3 Rollout by area | low (`visible` where `lg` is applied) | 4, one per slice | ~6 to 12 each | yes, after any slice |
| U4 Visible foundation | visible | 1 | ~11 | yes |
| U5 Verification, guidance and close | none / configuration | 1 or 2 | ~12 | yes |
| U6 Derived-project readiness and template release | none to configuration | 1 or 2, plus a tag | ~25 | end state |

**Stop rules.**
- Stop and report when any of these happens:
  - a gate is unmet;
  - a check fails twice for the same reason;
  - a checkpoint needs a file outside its listed boundary;
  - the accepted package revision changes mid-way.
- Each checkpoint ends with its PR merged and its evidence posted on #53, so work can pause between checkpoints at no cost.

## Checkpoints

Apply them in order. U2-S may run in parallel with U2 or U3 once G5 is met. U4 may move ahead
of U3 if reviewers prefer the visible change first; the two touch different files.

### U0. Gate and baseline capture

- **Requirements.** G1 to G3 met. The accepted revision is recorded under "Verified progress".
- **Work.**
  - Capture the baseline:
    - pages: `/design-system`, Account, Preferences, Credits, Admin, Users, Reports;
    - presets: Classic, Glass, Soft Blue;
    - themes: light and dark;
    - widths: 390px and 1440px.
  - Also capture:
    - one public page in Arabic;
    - Glass with reduced transparency;
    - the error page (no preset attribute).
  - Use named headless Playwright sessions, and record the commands so U4 and U5 repeat them exactly.
- **Decision recorded here (UG-019).** Use scripted Playwright-CLI captures, which add no dependency. Regression tooling inside the repository needs its own dependency decision and stays out of scope.
- **Acceptance.** A capture set exists for every combination, with its commands written down. The capture list and location are posted on #53.
- **Continuation.** Automatic once G1 to G3 are met.

### U1. Seams, no visual change

- **Rows.**
  - TCH-02: `--control-touch-sm` 2.75rem, `--control-touch-md` 3.25rem and `--control-touch-lg` 3.75rem in `src/styles/tokens.css`. Nothing uses them until TCH-03.
  - DOC-01 §1: the "Where to change things" rows for files that exist at this point.
- **Decision (spec §7, TCH-02).** Whether to also add Tailwind theme keys for the touch sizes. The default is no, because the CSS variables are enough for TCH-03.
- **Boundaries.** No component, preset or visible change.
- **Acceptance.**
  - Every colour and every computed body and heading style is identical to U0.
  - `npm.cmd run typecheck`, `lint`, `test`, `build`, `check:docs` and `check:i18n` pass.
- **Continuation.** Automatic.

### U2. Shared helpers in the showcase

Each item is built once, shown in every state in `/design-system`, and used by no feature
until U3. Spec numbers refer to the package's implementation specifications.

| Rows | Spec | Files | Acceptance and decisions |
| --- | --- | --- | --- |
| FLD-01 | §2 Field composition | new `src/components/ui/field.tsx` via `npx shadcn add field` (style `radix-nova`) | **Decline** the CLI's offer to overwrite `label.tsx` and `separator.tsx`. Add the ID wiring and the two RTL corrections. Wire the form's capture-phase `invalid` handler next to `LocalizedValidation`. Give fields holding mixed-direction values (emails, URLs, codes) `dir="ltr"`, as spec §2 requires. **Acceptance:** submitting a required field empty focuses it and shows the translated message; `aria-describedby` lists the help and error IDs; typing clears the error; values survive a server error; in Arabic the help and error text start at the right. |
| FLD-02 | §3 Field size | `input.tsx`, `textarea.tsx`, `select.tsx`: opt-in `size="lg"` | Default fields render pixel-identical to U0. `lg` computes a 48px minimum height and 16px text at 390px and 1440px. Nothing uses `lg` in this checkpoint. |
| PND-01 | §5 Pending submit | `page-patterns.tsx` (`SubmitButton`) | A double-click sends one request. The label stays unchanged. The spinner is static with reduced motion. A failure re-enables the fields with their values. |
| LVG-01 | §6 Leave guard | new `src/components/leave-guard.tsx`; provider in `src/app/layout.tsx`; guarded links in `app-shell.tsx` and `account-menu-controls.tsx` | Each table row's outcome matches for a fixture whose save succeeds, fails or is unknown. A clean form never prompts. Closing the tab while dirty shows the native prompt. Back is documented as unguarded. Initial focus is on Keep editing. Closing the dialog returns focus to the link or menu trigger that started the navigation. |
| MED-01 | §8 Missing media and downloads | new `src/components/media-fallback.tsx` | A missing source shows the fallback with text. A blocked URL shows the failed variant. A forced download error shows the Notice and leaves the result untouched. |
| RTL-01 to RTL-04 | §7 | `ui/dialog.tsx` (and remove the patches in `diagnostic-access.tsx` and `runs/workflow-version-picker.tsx`), `ui/alert-dialog.tsx`, `ui/sheet.tsx`, `app/page.tsx`, `app/not-found.tsx` | In Arabic, dialogs and alert dialogs are centred at 390px and 1440px, the sheet's close button is at the inline end, and the arrows mirror. In English nothing moves. `components.json` keeps `rtl: false`, recorded as not assessed (spec §7); this checkpoint doesn't change it. |
| TCH-01, TCH-03 | §7 | `src/app/globals.css` coarse-pointer rules | **Decision:** the exact TCH-03 selectors. The row is still marked "not yet reviewed", so review it here. **Acceptance on touch:** the label beside a checkbox or radio in a `Field` is at least 44px and toggles the control; every icon button is at least 44px wide; every choice is at least 44px tall. A fine pointer keeps the compact sizes. |
| BDG-01 | §10 | `ui/badge.tsx` or a composition beside it | **Decisions:** variant or composition; the prop names; the contrast of the error and neutral tones (measure them). **Acceptance:** each tone reads correctly with icons hidden and in greyscale; long labels wrap; the badge isn't focusable; light and dark in every preset. |
| NTC-01 | §11 | `Notice` in `page-patterns.tsx` | **Decisions:** the prop shape; whether the label changes while pending; focus handling when the action is disabled. **Acceptance:** each state shows its label and receipt; pending and success can't be activated; failed can be retried by the user only; keyboard and screen-reader announcement in every preset. |
| (copy) | §9 Copy | `ui` catalog keys (`m` plus a 12-hex SHA-256 prefix) in English and Arabic; regenerate `messages/client-sections.json` | Run `node scripts/i18n-client-sections.mjs`, then `npm.cmd run check:i18n`. The Arabic text is a draft until G8. The toast's `Dismiss` key ships with U2-S, not here, so it is never unused. |

- **Docs.**
  - DOC-01 §1 rows for the new files, and DOC-01 §3 "Interaction rules".
  - DOC-01 has no text for BDG-01, NTC-01, TCH-02 and TCH-03. Write local `docs/design-system.md` sections for them: purpose, props, states and touch sizes, with a link to the showcase.
- **Tests.**
  - Behaviour tests for:
    - Field ID wiring and the `invalid` handler;
    - pending single-submit;
    - leave-guard outcomes;
    - media fallback states;
    - the Notice action state machine.
  - `check:i18n`.
- **Browser checks.** Every state in the showcase at 390px and 1440px, English and Arabic, light and dark, keyboard only. No hydration or CSP errors.
- **Continuation.** Automatic. G8 before merge.

### U2-S. Toast and CSP (security route)

- **Requirements.** G5.
- **Rows.**
  - TST-01: `sonner` through the shadcn CLI, as `src/components/ui/sonner.tsx`, then **pinned exactly** as `"sonner": "2.0.8"` in `package.json`, because the CLI installs an unpinned range. Add a `src/components/toast.tsx` wrapper with `confirm`, `info`, `error` and `action` helpers, mounted in `src/app/layout.tsx`.
  - TST-02: two `sha256` sources in production `style-src` in `src/proxy.ts`, with the hash constant exported.
- **Toaster props (spec §4).**
  - `theme` from `resolvedTheme`;
  - position `bottom-right` in LTR and `bottom-left` in RTL;
  - `offset` and `mobileOffset` of 16px;
  - a translated `containerAriaLabel`;
  - inline `fontFamily: var(--type-body)`;
  - mounted inside `ThemeProvider`, next to `LocalizedValidation`.
- **Order dependency on U4.** If U2-S lands before U4, neither `--type-body` nor `--toast-confirmation-duration` exists yet. Fall back with `var(--type-body, var(--font-sans))` and a literal 6000 ms, which U4 replaces with the token. `tests/toast.test.ts` covers both cases.
- **Showcase.** Add a toast demo in `src/components/design-showcase.tsx`, needed by DOC-01 §4 step 10.
- **Docs.** DOC-01 §4 local test loop, the toast steps.
- **Copy.** The `Dismiss` key from spec §9, in English and Arabic.
- **Acceptance (§4).**
  - In a production build (`npm.cmd run build`, then `npm start`), a toast causes no CSP violation and is styled.
  - A confirmation stays while hovered or focused, and goes 6000 ms after both end.
  - An error toast stays until dismissed and is mirrored in a `Notice`.
  - In Arabic, toasts appear bottom-left.
  - Alt+T focuses the toast region.
- **Tests.** `tests/sonner-csp.test.ts`:
  - recomputes both hashes from the installed Sonner and compares them with the exported constant;
  - asserts `package.json` pins `"sonner": "2.0.8"` without a range;
  - asserts the sources appear in production `style-src` only.

  And `tests/toast.test.ts`, a behaviour test of the wrapper:
  - a confirmation pauses while hovered or focused, and restarts the full duration after both end;
  - a new confirmation replaces the previous one through the shared `confirmation` id;
  - an error toast persists until dismissed;
  - closing returns focus to the opener;
  - the 6000 ms and font fallbacks apply when the tokens are absent.
- **Continuation.** Stop if G5 rejects. Record the alternative (UG-016), remove the toast references from DOC-01, AGT-01 and SKL-01, and continue without a toast.

### U3. Rollout by area

- **Requirements.** U2 merged.
- **Slices,** one PR each, in this order:
  1. Account, Preferences, Profile and Files.
  2. Credits and commerce.
  3. Admin, which stays English/LTR.
  4. Runs.
- **What each slice applies.**
  - FLD-01 and PND-01 to the slice's forms.
  - LVG-01 **only** where the feature has real saving or offers Discard alone (spec §6).
  - MED-01 at the slice's call sites:
    - Files: `src/components/files.tsx`;
    - Admin: `src/components/admin-operations.tsx`, `src/components/diagnostics-panel.tsx`;
    - Runs: `src/app/artifacts/[id]/page.tsx`, `src/components/runs/registered-card.tsx`, `src/components/runs/run-ui.tsx`.
  - FLD-02 `lg` only with G11 approval for that screen.
- **Acceptance per slice.**
  - Invalid submit, retained values, pending state and failure behave as in U2.
  - Screens without an approved change are unchanged against U0.
  - `npm.cmd run test:integration` passes.
- **Boundaries.** No new helpers. A missing helper state is a U2 fix, not a local workaround.
- **Continuation.** Automatic slice by slice.

### U4. Visible foundation

- **Requirements.** G6 and G7. U0 captures exist.
- **Rows.** All 99 colour rows, TOK-01, TOK-02 and TYPE-01 to TYPE-12, following the package's
  [foundation migration](https://github.com/Uniwares-LTD/unitale-design/blob/493e13b83635280f74ce97784c25a64d6259ea36/docs/design-system/unibase/adoption/implementation-specs.md#foundation-migration).
  Re-read each Unibase file before editing it.
- **Work.**
  1. Copy `unibase.css` and `tailwind-theme.css` (with variable-backed type roles, G12) from the accepted revision into `src/styles/design-system/`, with a header comment naming the source repository, path and revision.
  2. `src/app/globals.css`: set the import order to tailwindcss, tw-animate-css, shadcn/tailwind.css, `../styles/design-system/unibase.css`, `../styles/tokens.css`, `../styles/presets/glass.css`, then `../styles/design-system/tailwind-theme.css`.
     - Remove `--font-heading` and the literal `--font-sans` from `@theme inline`.
     - Keep the semantic colour and radius mappings, `@custom-variant dark`, `.page-title`, `.reading-copy`, `.page-stack`, and the focus and touch rules.
  3. `src/styles/tokens.css`: remove the root heading, blur, edge, solid card and sidebar declarations and page gap, and the dark rule once it's empty. Keep the surface shadow, `--canvas-art`, `--reading-width` and the TCH-02 touch tokens.
  4. `src/styles/presets/glass.css`: remove each root property the generated Glass selectors also declare. Use the package fixture `scripts/design-system/lib/adoption-fixture.mjs` as the exact list. Keep every descendant rule, the `@supports` fallback and the reduced-transparency rule.
  5. Delete `src/styles/presets/classic.css` and `soft-blue.css`.
  6. In `src/components/page-patterns.tsx`, change the EmptyState `CardTitle` to `text-card-title! leading-(--text-card-title--line-height)! font-(number:--text-card-title--font-weight)!`. That's 20px/26px, weight 600.
  7. If U2-S landed first, replace its literal 6000 ms and font fallback with the tokens.
- **Docs made wrong by this change, fixed in the same PR.**
  - `docs/design-system.md:10-13` describe the old preset palettes; update them to the adopted ones.
  - `docs/design-system.md:39` says "Keep brand values in preset files". Brand values now come from the vendored foundation.
  - `docs/design-system.md:88-90`, "To add a future preset… import it after Classic": rewrite it for the vendored foundation, and point to the U6 seam for derived projects.
  - `docs/architecture.md:31-32` names the three preset files and says `tokens.css` owns typography.
  - DOC-01 §1 table rows for the vendored files, and DOC-01 §2 "Typography roles".
  - Document that the shadcn CLI writes into `globals.css`, and that foundation values belong to the vendored files.
- **Unchanged.**
  - KEEP-01 to KEEP-05.
  - `src/lib/appearance.ts`, `style-provider.tsx` and `theme-provider.tsx`.
  - The cookies and the `src/proxy.ts` CSP. The bundled CSS is served from `'self'` and no fonts are fetched.
  - `components.json`.
- **Tests.** A new `tests/design-foundation.test.ts` checks:
  - the import order;
  - the revision headers on the vendored files;
  - every non-Classic ID in `designStyleSchema` has an `html[data-style="…"]` block, and `:root` is the Classic fallback;
  - `--toast-confirmation-duration` is `6000ms`;
  - each type-role key in the vendored `tailwind-theme.css` is variable-backed with its package value as fallback.
- **Optional cross-check before merge.** Run the package's `scripts/design-system/verify-unibase-browser.mjs` with `UNIBASE_ADOPTION_SOURCE` pointing at this branch. That adds the 9 compiled-Tailwind fixture checks; see the verification record.
- **Browser checks.**
  - The U0 matrix again. Differences must be exactly the approved colour rows.
  - Preset and light/dark/system persistence across navigation and reload.
  - Glass fallback and reduced transparency.
  - Keyboard focus.
  - Arabic public pages, with admin staying English/LTR and the preference restored on leaving admin.
  - No hydration, runtime or CSP errors.
  - The error page keeps the Classic fallback.
  - A temporary `text-body` probe computes 14px / 22.4px / 400. Remove it afterwards.
- **Contrast.** Recompute it for any adopted value that differs from the package.
- **Rollback.** Revert the single U4 commit.
- **Continuation.** G6 and G7.

### U5. Verification, agent guidance and close of the package adoption

- **Requirements.** U1 to U4 merged, and U2-S merged or explicitly declined.
- **AGT-01** (after G4), from the agent-guidance proposal:
  - one bullet under "Decision-point rules" in `AGENTS.md`;
  - two additions to "UI and browser verification" in `.agents/repository-adapter.md`;
  - one change to the "UI, locale or navigation" row in `docs/source-map.md`.
  - If U2-S was declined, drop the toast references.
- **SKL-01** (after G4):
  - Add `.agents/skills/build-ui/SKILL.md` from the package, and `.claude/skills/build-ui/SKILL.md` as the thin wrapper template in proposal §4.
  - Add `"build-ui"` to the `names` array in `scripts/check-skills.mjs` (proposal §4 step 3); without it, the check fails.
  - Run `node scripts/check-skills.mjs --write`, keeping `build-ui` out of `sharedSkills`.
  - Run `npm.cmd run handbook:sync` and `handbook:entrypoints`.
  - Refresh `skills-lock.json` and the integrity hashes after review, recording `build-ui` as a local skill, not under the shared Handbook source.
  - The skill's component table lists every helper adopted here: Field, field size, SubmitButton, leave guard, media fallback, status badge, actionable Notice, toast (if adopted), touch tokens and the U6 theme seam.
  - If SKL-01 is rejected and AGT-01 approved, keep the same text as a document (proposal §4 fallback).
- **Work.**
  - The complete local test loop from `docs/design-system.md`, including the steps DOC-01 §4 adds.
  - A separate read-only review of the integrated diff since the issue base.
  - DOC-01 §5 "Adopted package version": the accepted revision and a Deviation | Reason | Date table, starting with the AGT-01/SKL-01 move.
  - Post the evidence on #53 and unitale-mockup#7.
- **Acceptance.**
  - `npm.cmd run typecheck`, `lint`, `test`, `build`, `check:docs`, `check:i18n`, `check:skills`, `check:template`, `test:handbook` and `test:integration` pass. `test:handbook` runs `check-skills` through `tests/handbook-integration.test.mjs`.
  - KEEP-01 to KEEP-05 are confirmed unchanged.
  - Every ledger row is marked adopted, declined with a reason, or deferred to its named owner.
- **Evidence classification (UG-012).** Record failed inherited behaviour, unavailable evidence and unexercised checks separately. None of them counts as a pass.
- **Human acceptance on physical devices.** These stay human tasks and are recorded as such:
  - a real mobile keyboard;
  - microphone permissions;
  - screen-reader live updates;
  - a 200% zoom review;
  - visual parity sign-off.

### U6. Derived-project readiness and template release

This checkpoint makes Unibase "ready and done" for the Unitale UI issue. Decisions (G9) come first.

- **Theme seam (DEF-03, UG-018).** Today a derived project can only pick one of the three presets (`defaultStyle` in `src/lib/project.ts`, `designStyleSchema` in `src/lib/appearance.ts`). Package themes target `html[data-project="<id>"]`, and the package reference removes `data-style` while a project theme is shown (Extending Unibase; foundation migration). Decide:
  1. **Who sets `data-project` on `<html>`.** Recommended default: the server, in `src/app/layout.tsx`, from a new optional `theme: true` flag in `project.config.json` (validated in `src/lib/project.ts`). With the flag off, which is Unibase's default, the attribute is absent and nothing changes.
  2. **Whether the presets stay selectable under a project theme.** Recommended default: the project theme **replaces** the preset choice, matching the package reference, which removes `data-style` while a project theme is shown.
     - The style selector is hidden when `theme: true`.
     - The light/dark/system preference stays.
     - The style cookie and saved profile style are kept but ignored, so turning the flag off restores them.
  3. **Whether it's a new style ID.** Recommended default: no. A project theme is a project scope, not a `designStyleSchema` value, so the `build-ui` rule on new style IDs doesn't apply. Record this in `docs/design-system.md`.
  4. **The file.** Recommended default: `src/project/theme.css`, empty in Unibase and imported after the foundation and Glass CSS in `globals.css`. The project's selectors are `html[data-project="<slug>"]` and its `.dark` form, as in Extending Unibase.

  Then build it:
  - Add the `theme` flag to `projectSchema` in `src/lib/project.ts` and to `project.config.json` (`false`).
  - Set `data-project` in `src/app/layout.tsx` when the flag is on. Import `src/project/theme.css` in `src/app/globals.css` after the foundation.
  - Set `data-project` on the `<html>` in `src/app/global-error.tsx` as well, so the error page uses the project theme.
  - Hide the style selector in `src/components/style-preference.tsx`, the preferences page and `appearance-form.tsx` when a project theme is active.
  - Add `src/project/theme.css` to `projectOwned` in `scripts/template-update.mjs`, and to the project initializer (`scripts/project-initializer.ts`), so template updates keep the project's version.
  - Tests:
    - `tests/template-update.test.ts` and `tests/initializer.test.ts` for project ownership;
    - `tests/config.test.ts` for the flag;
    - `tests/integration/auth.test.mjs` for `data-project` rendered by the server and the selector hidden.
  - Document it in `docs/architecture.md#project-extensions`, `docs/template.md`, and the "Switching and persistence" and "Extension point" sections of `docs/design-system.md`.
  - **`theme.css` isn't the package's generated theme copied unchanged.** The Unitale UI issue adapts it:
    - type-role values go through the `-size`, `-leading`, `-weight` and `-tracking` variables (decision 5);
    - its element rules (`body`, `.card`, `.notice`, `.chip`, `dialog`) are ported to Unibase's slots, such as `[data-slot=card]`;
    - `--unitale-*` variables stay project-scoped.
- **Type-role overrides.** Verify the G12 package change end to end: with a fixture project theme setting `--text-hero-size` and `--text-card-title-weight`, the computed styles change; without it, U4's values hold.
- **Fonts (DEF-02).** Unibase keeps system fonts. The supported path for a derived project: self-host fonts with `next/font/local` under `'self'`, so the CSP doesn't change, and set `--type-heading` and `--type-body` in the project theme.
  - The Unitale package manifest points at Google Fonts, which `font-src 'self'` blocks. State that in the upgrade notes.
  - Add a test or fixture showing a project theme overriding both hooks.
- **Unconsumed project tokens.** The Unitale theme sets these, and nothing in Unibase reads them:
  - radius: `--radius-card`, `--radius-dialog`, `--radius-media`, `--radius-pill`;
  - borders and focus: `--border-selected`, `--focus-width`, `--focus-offset`;
  - shadows: `--shadow-raised`, `--shadow-floating`;
  - motion: `--duration-feedback`, `--duration-reveal`, `--ease-standard`;
  - selection: `--selected`, `--selected-foreground`;
  - `--destructive-foreground` (kept undefined by the package decisions);
  - six `--unitale-control-*` and `--unitale-icon-*` variables.

  Recommended default: Unibase exposes **generic consumers that default to today's values**, so Unibase looks identical and a project theme can tune them:
  - `ui/card.tsx`: `--radius-card` and `--shadow-raised`;
  - `ui/dialog.tsx`, `ui/alert-dialog.tsx` and `ui/sheet.tsx`: `--radius-dialog` and `--shadow-floating`;
  - `media-fallback.tsx` and images: `--radius-media`; badges and chips: `--radius-pill`;
  - the global focus rule in `globals.css`: `--focus-width` and `--focus-offset`;
  - selected choices and radio items: `--border-selected`, `--selected` and `--selected-foreground`;
  - component transitions: `--duration-feedback`, `--duration-reveal` and `--ease-standard`.

  `--destructive-foreground` stays undefined in Unibase, as the package decides, and `--unitale-*` variables stay project-owned.

  Acceptance: U0 screenshots unchanged with no project theme, and a test fixture theme visibly changes each consumer. If this is declined, the Unitale UI issue owns these tokens; record that in the upgrade notes.
- **Letter-spacing unit** (open package decision). Recommended default: `em`, which matches the CSS renderer and scales with each role's size. Every value is 0, so nothing renders differently. Record the decision in the "Adopted package version" deviations if the package's DTCG source keeps `rem`.
- **DEF-04, Lucide 1.75.0 (optional).** A separate commit if reviewers want it, with icon rendering checked in the showcase.
- **Hard-coded colours.** Align these with the adopted Classic values, and document them as per-project values (see `docs/template.md`, "First steps"):
  - `themeColor` in `src/app/layout.tsx`;
  - `src/app/manifest.ts`;
  - `public/offline.html`;
  - `scripts/android-generate.ts` (TWA theme, navigation and background);
  - `scripts/generate-icons.mjs` (icon background);
  - `src/app/icon.svg` (fill and background);
  - the generated `public/icons/*.png`, regenerated with `npm.cmd run icons:generate`.
- **Template release (G10).** `## Unreleased` already contains unrelated reusable changes, which ship in the same release. List them in the release notes too.
  - Make a minor bump (allowed before 1.0), and set `template.json`.
  - Upgrade notes for derived projects:
    - the deleted preset files;
    - the vendored foundation, which must not be edited;
    - the theme seam and `data-project`;
    - variable-backed type roles, and how a project overrides them;
    - self-hosted fonts and the CSP;
    - the toast CSP, if adopted;
    - the new `AGENTS.md` bullet, `build-ui` skill, `skills-lock.json` and `check-skills` changes merging into project guidance;
    - `manifest.ts` and `offline.html` being project-edited files.
  - Run `npm.cmd run check:template` and `test:initialized-projects`.
  - Merge, then tag `template-v<version>`.
- **Upgrade rehearsal.** `test:initialized-projects` builds new projects from the current source and never runs an upgrade, so rehearse the real one. In a disposable directory, create a project from `template-v0.4.0`, then run `npm run template:update -- <version>`. Do the same on a disposable clone of Unitale. Record the conflicts and confirm the upgrade notes resolve them.
- **Acceptance.**
  - The rehearsals succeed, or their conflicts are documented with instructions.
  - The seam, font and project-ownership tests pass.
  - #53 links the tag.
- **Hand-off.** The Unitale UI issue starts from this tag: Unitale runs `template:update`, then adds its theme through the seam.

## Documentation and guidance

| Document | Change | Checkpoint |
| --- | --- | --- |
| `docs/design-system.md` | DOC-01 §1, the "Where to change things" table, row by row as files change | U1, U2, U4 |
| `docs/design-system.md` | DOC-01 §2, typography roles | U4 |
| `docs/design-system.md` | DOC-01 §3, interaction rules | U2 |
| `docs/design-system.md` | DOC-01 §4, local test loop steps 9 onward | U2, U2-S |
| `docs/design-system.md` | DOC-01 §5, adopted package version and deviations | U5 |
| `docs/design-system.md:10-13`, `:39` and `:88-90` | the palette descriptions, brand-values and add-a-preset rules | U4, U6 |
| `docs/design-system.md` local sections | status badge, actionable Notice, touch tokens and rule (not in DOC-01) | U2 |
| `docs/design-system.md` "Switching and persistence", "Extension point" | the project theme seam | U6 |
| `docs/architecture.md:31-32` and `#project-extensions` | the preset files, typography owner and theme seam | U4, U6 |
| `docs/template.md` | the theme seam, fonts and per-project colours | U6 |
| `AGENTS.md`, `.agents/repository-adapter.md`, `docs/source-map.md` | AGT-01 | U5 |
| `.agents/skills/build-ui/`, `.claude/skills/build-ui/`, `skills-lock.json` | SKL-01 | U5 |
| `CHANGELOG.md` | an `## Unreleased` entry per checkpoint, then the release | every checkpoint, U6 |
| this plan | "Verified progress and resume" | every checkpoint |

## Test plan summary

| Kind | Where | Checkpoint |
| --- | --- | --- |
| Unit and behaviour | Field wiring; pending; leave guard; media fallback; Notice actions | U2 |
| Unit and behaviour | `tests/sonner-csp.test.ts`, `tests/toast.test.ts` | U2-S |
| Unit and behaviour | `tests/design-foundation.test.ts` | U4 |
| Unit and behaviour | `tests/template-update.test.ts`, `tests/initializer.test.ts`, `tests/config.test.ts` (theme seam); type-role and token override fixtures | U6 |
| Repository checks | `typecheck`, `lint`, `test`, `build`, `check:docs`, `check:i18n` | every checkpoint |
| Repository checks | `check:skills`, `test:handbook`, `check:template` | U5, U6 |
| Integration | `test:integration`: server `data-style` per cookie, `/design-system` 404 in production, `data-project` with the selector hidden | U3, U4, U5, U6 |
| Template | `test:initialized-projects`, plus the upgrade rehearsals from `template-v0.4.0` and on a Unitale clone | U6 |
| Browser (headless, scripted) | the U0 matrix; per-spec acceptance; RTL; keyboard; CSP; hydration | U0, U2, U2-S, U3, U4, U5 |
| Browser (optional) | the package's adoption fixture against this branch | U4 |
| Contrast | recompute changed values; BDG-01 error and neutral tones | U2, U4 |
| Human | Arabic native review (G8); physical devices, microphone, screen reader, 200% zoom, visual parity | U2, U5 |

## Verified progress and resume

- 2026-11-21: plan proposed on branch `task/53-adopt-design-system` from `main` `37aac48`. A separate read-only completeness audit against package `493e13b` found missing decisions, files, tests and readiness items; all of them are addressed above. A second audit of commit `43b6422` found six further gaps (type-role overrides, the full unconsumed-token list, the SKL-01 `names` edit, `icon.svg`, docs for the new helpers, and a toast behaviour test) plus smaller items; all are addressed in the next commit. No checkpoint started. Gates G1 to G11 open.

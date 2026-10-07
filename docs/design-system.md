# Base design system

## Purpose and audience

Base serves end users of AI-enabled web applications and operators managing
accounts, credits and execution. Its reusable UI covers forms, workspaces, results,
tables and reports. A downstream product defines its own audience and content
experience; each application defines its own audience and content requirements.

Classic uses warm ivory, terracotta actions and book-like serif headings. Glass
uses pearlescent gradients, green accents, frosted panels and sans headings.
Soft Blue uses cobalt actions, pale lavender surfaces and rounded opaque panels,
inspired by the supplied learning-app reference. Long-form content retains reading typography. No downloaded fonts are required.
Classic, Glass and Soft Blue are independent of light, dark and system mode. All presets
share semantic tokens and the same application behavior.

## Where to change things

| File                                  | Change here                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/styles/tokens.css`               | Shared typography/effect defaults, page gap and reading width                          |
| `src/styles/presets/classic.css`      | Complete Classic fallback palette in light/dark                                        |
| `src/styles/presets/soft-blue.css`    | Cobalt/lavender light and dark palettes                                                |
| `src/lib/page-cover.ts`               | Metadata observation, image URL validation and loading cleanup                         |
| `src/styles/presets/glass.css`        | Glass palette, gradients, translucent panels, blur and opaque fallbacks                |
| `src/lib/appearance.ts`               | Supported style/preference values and cookie resolution                                |
| `src/components/style-provider.tsx`   | Browser selection and public appearance cookie                                         |
| `src/components/style-preference.tsx` | Shared shadcn radio selector                                                           |
| `src/app/globals.css`                 | Tailwind token mappings, fonts, page typography, focus, reduced motion and touch rules |
| `src/components/page-patterns.tsx`    | Page headers, notices and empty states composed from shadcn                            |
| `src/components/ui`                   | Installed shadcn primitives; use the shadcn CLI for additional primitives              |
| `src/components/app-shell.tsx`        | Desktop/mobile navigation, account menu and skip link                                  |
| `src/components/design-showcase.tsx`  | Synthetic interactive examples and static feature preview                              |
| `src/app/design-system/page.tsx`      | Development-only route guard                                                           |
| `src/proxy.ts`                        | Showcase-only production 404 before page streaming starts                              |

Change a semantic pair together, for example `--warning` and
`--warning-foreground`, in both themes. Prefer `bg-warning`/`text-warning-foreground`
over a literal palette in a feature component. Keep brand values in preset files.
Spacing inside components uses Tailwind's existing scale; page separation and
reading width use the shared tokens. Avoid a second spacing or control library.

Use `PageHeader` for one page title and concise guidance, `Notice` for information,
success, warning or error, and `EmptyState` to explain what is missing and what to
do next. These are application compositions, not replacements for shadcn controls.
Use existing Button, Input, Label, Card, Badge, Table, Sheet and AlertDialog
primitives. Keep page reads on the server and interactive state in small client
components. Do not move a page into a client component merely to style it.

## Switching and persistence

Open Preferences and choose Classic, Glass or Soft Blue under Design style. Appearance changes
immediately. Light/dark/system mode is a separate choice; it does not replace the
selected style. The showcase exposes the same selector for visual testing.

Visitors remember a selection in a host-only, one-year style cookie (its key is defined in `src/lib/appearance.ts`).
The server validates it and writes `data-style` onto the initial HTML, so the
saved style is present before hydration. Invalid/missing values use Application
default. No authentication or authorization comes from this public cookie.
If cookie storage is unavailable, changes still work for the current page session.

Signed-in users can click Save profile to save their style to the account. Account
and Preferences load that saved style; after sign-in on another browser, the
Account page restores it and updates that browser's appearance cookie. An unsaved
preview may be replaced by the saved account style when revisiting these pages.
Older profiles inherit Application default. Older API updates omitting `style`
preserve an existing saved style; no database rewrite is needed.

Account color-mode selection also previews immediately; Save profile persists the
choice to the account. Restore the saved theme only on profile mount or a changed
saved value. Do not depend on the identity of `next-themes`' `setTheme` callback:
it changes with the browser theme and would overwrite previews and cross-tab changes.

Set `APP_STYLE=classic`, `APP_STYLE=glass` or `APP_STYLE=soft-blue` in `.env.local` to change the
application default, then restart the server. Choose Application default in the
selector to follow it; explicit style choices take precedence. Only this
validated public setting crosses the server boundary.

Glass uses clear tinted cards and shell chrome with page artwork or gradients,
24px panel blur, enhanced saturation, diagonal highlights and bright inset edges.
Light cards are 46% opaque; dark cards are 64%. Nested appearance choices stay
clear instead of stacking another opaque panel. Forms and table surfaces are
denser (84% light / 90% dark); fields remain solid. Portalled menus/dialog surfaces stay solid for readability. Unsupported
backdrop filtering and requested reduced transparency use opaque panel colors in
both modes. Reduced motion remains independent. Use Classic whenever an opaque,
quiet canvas is preferred.

To add a future preset: add its approved ID to the schemas in
`src/lib/appearance.ts`, create a CSS file overriding the same variables under
`html[data-style="your-id"]` and its `.dark` selector, import it after Classic
in globals.css, and add its option to StylePreference. Test it through the same
showcase; do not fork page implementations or shadcn controls. Illustrated presets and artwork-led reading layouts are still future work.

## Glass page-cover convention

Declare a page's main image with the standard Open Graph tag:

```html
<meta property="og:image" content="https://your-host.example/covers/main.jpg" />
```

In Next.js, export page metadata (or use generateMetadata for a dynamic cover):

```tsx
export const metadata = {
  openGraph: { images: ["https://your-host.example/covers/main.jpg"] },
};
```

Next generates the tag; do not add duplicate manual tags. Use the actual cover as
**the first og:image**, rather than a promotional sharing banner. Covers are
page metadata, independent of the saved appearance preference. Avoid a cover in
root layout metadata unless it should apply to all pages, since Next inherits
metadata. Use absolute URLs, or configure metadataBase for relative metadata URLs.
See [Next metadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata).

Glass observes tags including streamed metadata and client-side navigation. It
loads artwork only while Glass is selected and keeps gradients until the image
succeeds. Missing, invalid, blocked or broken URLs and loads exceeding ten seconds
use the original gradients. HTTP(S) image URLs are supported; credentials,
executable/data URLs and HTTP on HTTPS pages are rejected. Removing or changing
the tag clears old artwork and cancels the previous load. Switching to another
style removes the effect. No background choice is stored on the user account.
Use approved public image hosts and avoid putting private credentials in metadata.

The background is decorative, centered and cropped to cover the viewport. It
has a 42% mode-specific wash, allowing much more of the cover color to show
through. Protect text locally: PageHeader carries the page-header class;
reading-surface marks prose/hero blocks; glass-inset adds optional Glass-only
padding. Standalone page-stack paragraphs and the footer receive local scrims.
These classes have no effect in Classic or Soft Blue. Forms inside cards use one
stronger surface; standalone forms and table containers get their own.
Tune --cover-wash, --card, --reading-surface, --form-surface, --surface-sheen
and --surface-shadow in glass.css. Recheck text and control contrast over both
black and white cover extremes before reducing opacity. The original image should still appear normally in the page content, with
appropriate alt text; the background is not a substitute for that image.

Test at /design-system: select Glass and use **Sample cover**, **No cover** and
**Broken cover**. Those links change real page metadata through client navigation.
Check light/dark, reload, back/forward, navigation to Preferences (no cover), then
return. Confirm gradients for missing/broken artwork and no previous-page image
leaking into the next page. Change to Soft Blue and verify its selection persists
through reload/account save. The local sample artwork lives in
public/design-system/cover.svg; the showcase remains development-only.

## Interaction rules

- Give inputs visible labels and connect help/errors with `aria-describedby`.
  Preserve typed values when an operation fails. Show pending and disabled states
  without removing the action's name.
- Pair status colors with text and, for notices, an icon. Errors use an alert;
  ordinary feedback uses a status region. Do not rely on color alone.
- Keep credit balances, reservations and debt distinct. Label local simulation
  explicitly. Keep existing confirmation, authorization and idempotency behavior.
- Future paid generation must state its credit cost before confirmation. An
  uncertain result must not encourage an automatic duplicate paid request.
- Future approvals must identify the exact version. Review suggestions remain
  advisory. Stage labels describe real states; do not invent percentage progress.
- Use one main next action per task. Administration can be denser, with readable
  tables that scroll inside their container rather than widening the page.
- Keep visible keyboard focus and the shell's skip link. Respect reduced motion.
  Coarse-pointer buttons, inputs and selects have a minimum height of 44px.

These are presentation conventions. The feature preview does not add models,
schemas, persistence, approval operations, generation or Dify integration.

## Local test loop

Follow [README setup](../README.md) and [account emulator testing](local-testing.md)
for the existing application. Start `npm run dev`, then open
<http://localhost:3000/design-system>. No sign-in is needed for the showcase.
Account, Credits and Admin still use their normal access controls and local
emulator fixtures; follow [admin and credits testing](admin-credits-testing.md).

The showcase form, sample confirmation and sample wallet are synthetic. They
never call mutation endpoints. The appearance selectors change this browser's
real style and color-mode preferences. Reloading resets the form/confirmation examples. Feature
approval/revision buttons are intentionally disabled and labelled as a static
concept. They are not testable business features yet.

After changing a token or pattern:

1. Inspect Classic, Glass and Soft Blue in light and dark mode, then system mode with each OS
   preference. Reload and check the persisted appearance without hydration errors.
2. Switch styles with the mouse and radio arrow keys. Reload to check persistence.
   With a local account, select Glass, save the profile and reload. An older account
   must still load and an update omitting style must preserve its saved choice.
   Set APP_STYLE to glass, restart and choose Application default; restore your
   previous environment value after testing.
3. Submit an empty sample title; check the visible error and invalid field. Enter
   a title and save; check success. Open the sample confirmation, cancel with
   Escape, confirm, and verify focus returns to the trigger.
4. Use only the keyboard: skip to content, navigate links/controls, open/close the
   mobile menu and account menu, and check visible focus and dialog focus trapping.
5. Check at 1440px and 390px widths and 200% browser zoom. Long text should wrap;
   ledger/report tables should scroll locally. The page should not scroll sideways.
6. Check normal text/foreground pairs at a contrast ratio of at least 4.5:1,
   large text at 3:1, and meaningful control/focus boundaries at 3:1. Include muted
   text and all feedback pairs in both themes. Recheck after changing colors.
7. With local test accounts, inspect Account, Preferences, Credits, Admin, Users
   and Reports. Exercise empty/search/filter errors and the existing confirmation
   dialogs. For mutations, use disposable local fixtures, never live services.
   Keep signed-in Preferences open beside a design-system tab. Selecting Dark in
   either tab must update both without reverting to the saved account mode. Verify
   immediate profile preview, Save profile/reload, and System following the device.
8. Enable reduced motion and check menus/dialogs remain usable. Request reduced
   transparency and check Glass cards/sidebar become opaque in both color modes. Check the browser
   console for runtime/hydration errors. Automated checks supplement this manual
   accessibility pass; they do not establish complete accessibility conformance.

Run affected checks separately:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:integration
```

Stop the development server before the production build; both share `.next`.
The integration runner needs the local Auth Emulator and owns its disposable
MongoDB/application process; it does not use the persistent development database.
It includes a production HTTP assertion that `/design-system` returns 404 and
does not expose the showcase. The route is available only with `next dev`, not
`next start`, regardless of `APP_ENV`. Restart `npm run dev` after those checks.
Quality checks remain advisory; compilation/bundling errors still fail the build.

## Extension point

Use this showcase to review new UI states before connecting a downstream feature. Add a real feature's examples
only when its behavior is agreed. Keep previews labelled and static until the
corresponding milestone is implemented and verified.

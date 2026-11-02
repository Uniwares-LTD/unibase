# Local account and emulator testing

This is the detailed account guide. Start with [the full feature test plan](test-plan.md)
for admin, credits, AI, pricing, themes and production-like acceptance.

This guide covers manual account testing and the automated security checks. Local Firebase accounts, Google identities, and email actions are simulated. MongoDB runs locally; no real Firebase project, email inbox, or Atlas credentials are needed.

## Start the app and services

Use the Node/npm versions in [the README](../README.md). Run commands from the repository root. The examples use Windows PowerShell's `npm.cmd`; on macOS/Linux use `npm`.

Install dependencies once, and again after dependency changes:

```powershell
npm.cmd ci
npm.cmd run check:env
```

Local account defaults work without an environment file; AI is disabled until explicitly enabled. If `.env.local` already exists, make sure it selects local/demo resources as shown in [.env.example](../.env.example). In particular, use `APP_ENV=local`, `AUTH_MODE=emulator`, the demo `FIREBASE_PROJECT_ID` from `.env.example`, and `APP_ORIGIN=http://localhost:3000`.

Start these commands in three separate terminals and leave them running:

| Terminal | Command                       | Wait for            |
| -------- | ----------------------------- | ------------------- |
| 1        | `npm.cmd run emulators:auth`  | All emulators ready |
| 2        | `npm.cmd run emulators:mongo` | Local MongoDB ready |
| 3        | `npm.cmd run dev`             | Next.js Ready       |

The first MongoDB start downloads its binary and can take several minutes. Docker is not required. The local MongoDB runner also creates the unique profile UID index. To rerun index setup against your configured database, use `npm.cmd run db:indexes`.

If these services are already running, reuse them rather than launching duplicates. Stop a service with Ctrl+C in its terminal when finished.

The Auth Emulator runner loads the same local environment as the web process and
uses its configured `FIREBASE_PROJECT_ID` (a `demo-` project). The emulator's default
project must match the app: its client API assigns demo API keys to that project.
A mismatch can allow registration/verification while server session creation fails.
Restart the emulator after changing this setting; emulator accounts are ephemeral.

| Address                                                         | Purpose                                    |
| --------------------------------------------------------------- | ------------------------------------------ |
| [localhost:3000/account](http://localhost:3000/account)         | Start the account tests here               |
| [localhost:3000/preferences](http://localhost:3000/preferences) | Appearance and saved preferences           |
| [127.0.0.1:4000/auth](http://127.0.0.1:4000/auth)               | Inspect local Firebase accounts            |
| Emulator email actions (see instructions below)                 | Find verification and password-reset links |

Use `localhost:3000` consistently for the application. Its configured origin is checked on mutations. The browser's auth helper uses the same hostname, while server-side emulator access may use `127.0.0.1:9099`.

## Manual checklist

Use a fresh address such as `qa-alice-01@example.test` and a disposable password of at least 12 characters. You do not need to own this inbox: emails stay in the emulator. Use another address for a second account.

| Test                    | Steps                                                                                                                                                 | Expected result                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Registration            | On Account, choose **Create an account**, enter email/password, and submit.                                                                           | The verification screen appears. Protected profile access is unavailable.                                         |
| Verification and resend | Click **Resend email**. Open the latest verification link as described below. Return to the app and click **I’ve verified my email**.                 | The verified account's profile opens.                                                                             |
| Profile persistence     | Save the display name with **Save profile** on Account; save appearance with **Save preferences** on Preferences. Reload both pages.                                                  | Saved name and appearance remain associated with this account.                                                    |
| Invalid login           | Sign out. Try a wrong password and a nonexistent email address. Inspect the emulator account list.                                                    | Login fails; no new account is created by a failed sign-in.                                                       |
| Email login             | Sign in with the registered email and correct password.                                                                                               | The same saved profile returns.                                                                                   |
| Password reset          | Sign out, choose **Forgot password?**, enter the email, and submit. Complete the emulator reset action below. Try the old password, then the new one. | A generic reset confirmation is shown. The old password fails and the new password restores the existing profile. |
| New Google account      | From Account, click **Continue with Google**. In the emulator chooser, select **Add new account**, supply a synthetic email/name, and sign in.        | You return to a separate, verified profile. No real Google account is contacted.                                  |
| Existing Google account | Sign out, click **Continue with Google** again, and select the existing account, such as **M2 Google Member** if present. Repeat once.                | Each sign-in returns to that account's profile. Test both creation and reuse; they are separate cases.            |
| Account isolation       | Give the email and Google accounts different names/themes, then switch between them using **Sign out / switch account**.                              | Each account retains its own data. No previous user's profile appears.                                            |
| Multiple tabs and Back  | Open the signed-in Account page in two tabs. Sign out in one. Try browser Back and reload.                                                            | Both tabs return to sign-in; an old editable profile must not remain usable.                                      |
| Anonymous API access    | After signing out, open [the profile endpoint](http://localhost:3000/api/profile).                                                                    | HTTP 401 with a safe error code/message and request ID, without profile data.                                     |
| Mobile and keyboard     | Use a narrow browser viewport, open navigation, and exercise forms using Tab, Enter and arrow keys.                                                   | No horizontal overflow; controls have visible focus and are usable. The skip link moves focus into the content.   |

## Open verification and reset links

Open `http://127.0.0.1:9099/emulator/v1/projects/PROJECT_ID/oobCodes`, replacing `PROJECT_ID` with the demo Firebase project configured in `.env.example` and the emulator command. This page returns JSON. In `oobCodes`, find your email and the latest matching `requestType`. The auth-emulator terminal also prints action instructions.

For email verification:

1. Find `requestType: "VERIFY_EMAIL"`.
2. Copy and open that entry's entire `oobLink` in another tab.
3. Return to Base and click **I’ve verified my email**.

For password reset:

1. Find `requestType: "PASSWORD_RESET"`.
2. Copy its entire `oobLink` and append `&newPassword=YourNewTestPassword123`.
3. Open the resulting URL. The emulator confirms the reset.
4. Return to Account and sign in with the new password.

Opening a reset link without `newPassword` returns HTTP 400 with instructions and a URL template. This is the emulator's interface, not Base's reset failure. Use a disposable alphanumeric test password here so no URL encoding is needed. Real Firebase email actions use the hosted password-reset form instead.

## If Google returns to sign-in

- Start a new attempt from [Account](http://localhost:3000/account), using **Continue with Google** in the same tab. A copied/bookmarked emulator chooser URL does not contain the initiating tab's Firebase state.
- After a code update, hard-refresh Account with Ctrl+Shift+R before trying again. Do not reuse an old chooser tab.
- The current local redirect should use `localhost:9099` when the app is on `localhost:3000`. Restart the app after changing environment configuration.
- If it still fails, record the browser/version, the final app URL, and the visible error message. In browser developer tools, inspect the status and safe error response for `/api/auth/session`. Do not share ID tokens, cookies, passwords, or raw request bodies.

The redirect fixes have passed automated browser checks, including third-party cookie restrictions. The exact cause of the originally reported user-browser failure has not been confirmed; do not treat the passing checks as proof that every browser configuration works.

## Automated checks

With the Auth Emulator running, execute these from another terminal:

```powershell
npm.cmd run validate
npm.cmd run build
npm.cmd run test:integration
```

For an entirely owned account fixture, use
`npm.cmd run test:integration -- --owned-auth`. It starts an ephemeral loopback
Auth Emulator with this project's manifest identity and closes it afterward.
This also works for a renamed derived application: the emulator's client API
uses its default project for every API key, so another project's developer
emulator is not an interchangeable test target. Use the normal CLI emulator for
interactive sign-in and its verification/reset links.

`validate` also runs account tests, deployment tooling, dependency audit and workflow/shell checks alongside configuration, skills, TypeScript, lint, formatting and unit tests. Docker/network/tool prerequisites may produce advisory warnings; see the full test plan. Its aggregate exit code is advisory; inspect every result and `output/validation/results.json`. Individual checks retain their real exit codes. Build failures remain failures.

`test:integration` needs a completed production build. It starts its own disposable MongoDB instance and application server at `127.0.0.1:3101`, with hardcoded demo/test settings. Keep that port free. It uses unique test accounts in the running configured demo Auth Emulator and removes those accounts afterward. Its disposable database is separate from the development database; it never targets production Atlas.

The integration suite checks anonymous/invalid/revoked sessions, unverified-email denial, origin/CSRF rejection, oversized requests, ownership-field rejection, separate users' profiles, persistence, logout, cookie attributes, and safe request IDs. The unit suite also checks API cancellation, response validation, absence of mutation retries, and Google redirect recovery boundaries.

For stale-response behavior, browser verification has also held a profile-save response until after logout and checked that it could not restore the old profile. This is not part of the committed automated integration suite.

## Local recovery and troubleshooting

| Symptom                                            | Check and recovery                                                                                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PowerShell blocks `npm.ps1`                        | Use `npm.cmd` / `npx.cmd`; no execution-policy change is needed.                                                                                                        |
| Port already in use                                | Reuse a healthy existing service, or stop only the process you started for that port. Do not start a second emulator/server blindly.                                    |
| Account stays on loading or session creation fails | Check the app and Auth Emulator terminals, confirm both services are reachable, and use `localhost` consistently for browser URLs. Restart the app after env changes.   |
| Profile read/save fails                            | Check the local MongoDB terminal and `/api/health/ready`. The MongoDB runner creates the local UID index; an explicitly configured database needs `npm run db:indexes`. |
| Standalone server lacks assets                     | Build first and start through `npm start`, which copies the required static/public files. Running the generated server directly bypasses that setup.                    |
| Offline fallback appears during development        | Restore network access and retry. For a clean browser test, unregister the worker through DevTools; this does not require deleting account/database data.               |
| Android dependencies fail to download              | Check Java/SDK prerequisites and official repository access using [Android delivery](android.md). Generation alone is not compilation/signing evidence.                 |

Development database data survives a runner restart, while Auth Emulator accounts
do not survive an emulator restart. Avoid deleting the local database as a first
recovery step. Logs and reports may contain development identifiers; share only
safe error codes/request IDs, not tokens, cookies or credentials. Live release
failures and rollback belong to [the deployment guide](deployment.md), which
keeps database recovery separate from application rollback.

## Test data and external checks

Auth Emulator accounts disappear when it stops. Development MongoDB data persists under `.cache/mongodb/<slug>`, so recreating the same email after an emulator restart creates a new Firebase UID and a separate profile. Use fresh test accounts; do not expect an email address alone to restore an old UID's profile.

Local success does not verify real Google OAuth, real email delivery, the live Firebase helper proxy, or Atlas connectivity. Those checks require the environment configuration described in [the README](../README.md#m2-account-configuration). Current completion evidence and dependency warnings are recorded in [the implementation plan](implementation-plan.md).

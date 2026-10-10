# Testing M3 locally

Start the app and emulators using [the local testing guide](local-testing.md). Use the same `localhost` hostname throughout. For release-like browser checks, stop the dev server, run `npm run build`, then `npm start`. Service workers work on localhost; a deployed app requires HTTPS.

## Diagnostics

1. Open `/account`. Diagnostics must initially be off and Export disabled.
2. Select **Enable diagnostics**. The buffer starts with one event and holds at most 100. It lives only in this page's memory; a full reload turns it off and clears it. Client-side navigation within the app preserves the choice.
3. In the browser console, run `window.dispatchEvent(new ErrorEvent('error', { message: 'fake-secret@example.test' }))`. The count increases, but the message is never collected. This synthetic event tests collection without crashing the application.
4. Export and inspect the JSON. Allowed fields are timestamp, fixed event name, HTTP status, elapsed milliseconds, and a generated request ID. There should be no URL, stack, email, cookie, token, request body, or error message.
5. Select **Disable and clear diagnostics**. Dispatch the event again: diagnostics must stay off. Re-enable: only the new enable event is present.
6. Use keyboard Tab/Enter for both controls; test a 390px mobile viewport and desktop. No horizontal overflow or hydration errors should appear.

API calls made by Base's fetch helper add timings, statuses and correlation IDs while enabled. Browser error/rejection and connectivity events add only their event type. Diagnostics neither suppress framework error handling nor upload data. Server logs are independent of this switch.

The application emits JSON lines for completed API/helper calls and profile actions, with severity, generated request ID and elapsed time. The framework error hook emits safe error events with a fresh ID; it omits duration because Next.js does not supply a request start time there. It deliberately drops the raw error and request context. Existing Next.js development output is separate from this application log stream. Sending `X-Debug: true` never enables extra response detail.

## PWA and offline fallback

1. Load an online page once. In browser DevTools → Application, verify the manifest, install icons, and `/sw.js` registration. On desktop Chromium, use the browser's install command; on iOS use Share → Add to Home Screen. Availability depends on the browser.
2. Inspect Cache Storage: the Base cache contains **only `/offline.html`**. Sign-in, profile and API responses must never appear there.
3. Enable DevTools' offline network mode, then perform a full document navigation/reload to `/account`. Expect the public “You’re offline” page with no account information.
4. Restore the network and choose the retry button. Normal navigation should recover.
5. Repeat while signed in. The fallback is identical. Offline mutations fail; there is no replay queue or offline profile access. Client-side RSC transitions use Next.js recovery rather than substituting offline HTML for a data response. Firebase helper/API requests are never replaced with the fallback.
6. Worker updates use the normal lifecycle. An open form must not be reloaded automatically. Close other app tabs and reload when testing an updated worker. During development, unregister the worker through DevTools if deliberately testing a completely clean install.

## Automated checks

Use [the full regression sequence](test-plan.md#7-automated-regression-and-production-like-pwa)
for accounts, credits and AI as well. Android generation requires configured
`ANDROID_HOST` and `ANDROID_PACKAGE_NAME`; skip it for a web-only local run and
record Android as Not run. It is not a credential-free default smoke command.

```sh
npm run validate
npm run build
npm run test:integration
npm run android:generate
```

The integration command needs the Auth Emulator, owns its test MongoDB, and does not use real services. Its test-server environment explicitly clears Android hostname/package/fingerprint settings, overriding shell variables and Next.js env files; the association endpoint is intentionally unconfigured in this suite. It checks PWA HTTP resources and debug-header safety as well as the M2 account boundaries. Unit tests check redaction, buffer lifecycle, cache isolation, Android configuration and certificate validation. Quality checks remain advisory; build failures remain failures.

For wrapper generation, signing and the device checklist, see [Android delivery](android.md). Local browser results do not prove Digital Asset Links, Play signing or installed-device behavior.

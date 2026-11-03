# Android delivery

Base uses a minimal [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) Trusted Web Activity (TWA). It opens the shared web UI in a trusted browser session. There are no separate native screens, notification delegation, billing SDKs or WebView authentication. Cross-origin login pages can show browser chrome; successful verification returns to the trusted application origin.

## Configure and regenerate

The Android hostname comes from `ANDROID_HOST`; package identity comes from `ANDROID_PACKAGE_NAME` or the optional project manifest; `android/config.json` holds only wrapper version information. The generator loads Next.js production-mode env files (`.env.production.local`, `.env.local`, `.env.production`, `.env`, in precedence order); existing process variables take priority. A project manifest may supply the Android package name; an explicit environment value takes precedence. The host and signing identity remain deployment-specific. Initializers exclude generated Android output. `android/project` is generated with pinned `@bubblewrap/core` 1.25.0 by `npm run android:generate` and is not tracked in Git. Always regenerate before building; generated Gradle/Java/manifest files necessarily embed the supplied build identity and are not configuration sources. Release generation rejects missing or placeholder identity values.

1. Fill in `ANDROID_HOST` (production **hostname only**, without scheme/path) and `ANDROID_PACKAGE_NAME` (permanent reverse-domain package ID) in the ignored `.env.local`. The keys are listed in `.env.example`. Set a positive integer `versionCode` and semantic `versionName` in `android/config.json`. Increase the version code for each Play upload.
2. Run `npm ci`, then `npm run android:generate`. Review and retain the generated project alongside the config. Do not hand-edit generated files. Icons are generated from the repository's existing SVG with `npm run icons:generate`; commit their PNG outputs.
3. The generator serves local PNGs on an ephemeral loopback port to Bubblewrap; it does not need a deployed website, signing key or cloud access. The retained manifest uses the configured HTTPS hostname. Local adaptations replace JCenter with Maven Central, select Android Gradle plugin 8.10.1 for SDK 36, and apply `android/release-signing.gradle`. Bubblewrap 1.25.0's original 8.9.1 plugin supports only SDK 35; the adaptation preserves Gradle 8.11.1 and Java 17, matching [Google's compatibility table](https://developer.android.com/build/releases/agp-8-10-0-release-notes).
4. Use Java 17, Android SDK platform 36 and build-tools 35.0.0. Configure `ANDROID_HOME` and `JAVA_HOME` locally. From `android/project`, run `./gradlew --no-daemon assembleDebug` (`.\gradlew.bat` on Windows). The first run downloads Gradle and Maven dependencies. Debug APKs are for local checking; they are not Play releases.

The wrapper/project inherits Bubblewrap's Apache-2.0 notices; its license is retained at `android/BUBBLEWRAP-LICENSE`. Wrapper regeneration can overwrite generated code and assets. Keep custom build changes in the generator or `release-signing.gradle`.

## Signing and manual workflow

Create/provide an Android upload keystore outside Git and keep a secure backup. Do not send keys or passwords in chat. The current workflow declares the `android-release` GitHub environment. Private
repository environment secrets require a paid plan; adapting this deferred Android
workflow to GitHub Free repository secrets is **implementation required** before
using it here. Do not treat the prepared workflow as a validated Free-plan release
path or enable a paid plan as part of staging handoff. On a supported plan, configure
that environment with these secrets. Set `android.host` and `android.packageName` in `deploy/environments/production.json` to match your local build settings:

| Secret                      | Purpose                                                                          |
| --------------------------- | -------------------------------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | Base64-encoded upload keystore.                                                  |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password.                                                               |
| `ANDROID_KEY_ALIAS`         | Alias in that keystore.                                                          |
| `ANDROID_KEY_PASSWORD`      | Private-key password.                                                            |
| `PLAY_SERVICE_ACCOUNT_JSON` | Required only for optional publishing; scoped Play Console service account JSON. |

Run **Android release** manually from GitHub Actions on a reviewed ref. It validates the target, regenerates with the pinned tool, builds/signs `app-release.aab`, verifies its signature, and uploads the bundle as a 14-day artifact. The temporary keystore is removed after building. It never runs on routine pushes or web deployments. It does not wait for advisory quality checks. Missing settings, generation, build, signing and publication errors still fail their operations.

Leave **publish** false for artifact-only delivery. Explicitly selecting it uploads to the chosen Play track; **internal** is the default. Create the Play application/listing, configure Play App Signing and grant the service account access first; initial console setup or first upload may be required. No Play application or signing identity is provisioned by this repository. Configure environment branch restrictions/protection appropriate to your release process.

For a local release build, export `ANDROID_KEYSTORE_PATH` (absolute), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`, then run `bundleRelease` from `android/project`. The separate release configuration rejects missing secrets. Generated bundles/keys/build directories are ignored by Git.

## Digital Asset Links and live acceptance

Set these **server runtime** settings on the production website:

- `ANDROID_PACKAGE_NAME`: exactly the environment value used to generate the wrapper.
- `ANDROID_SHA256_FINGERPRINTS`: Play Console's **app-signing certificate** SHA-256, formatted as 32 colon-separated hex bytes. Multiple fingerprints can be comma-separated for rotation. The upload certificate alone does not identify the Play-distributed app. For a deliberately sideloaded test build, include its signing certificate as well.

`/.well-known/assetlinks.json` serves the validated relation with JSON/no-store and no authentication or redirects. Until a fingerprint is supplied it returns an empty array, allowing the package to be configured before signing. A fingerprint without a valid package, or malformed supplied settings, fails configuration validation. These certificate fingerprints are public; private keys remain outside the web application. Google documents the [TWA verification process](https://developer.chrome.com/docs/android/trusted-web-activity/quick-start).

After M4 provides the real HTTPS origin:

1. Fetch Digital Asset Links publicly and compare hostname, package and Play certificate. Confirm no Access/operator login, redirect or HTML response intervenes.
2. Install the signed build from the intended test track. Confirm the verified site opens without the URL bar; an ordinary Custom Tab indicates verification still needs fixing.
3. Exercise Google sign-in out and back into the wrapper, email authentication, session persistence, logout/account switching, Android back navigation, profile editing and mobile preferences.
4. Disconnect/reconnect networking and verify the public fallback contains no account data.
5. Deploy a visible web-only change, reload the already installed wrapper and verify the new content appears **without reinstalling or issuing a Play update**. Do not force reload an open form.

## Verification status

Local generation and workflow syntax validation pass. The local Android build attempted on 2026-10-03 could not resolve `com.android.tools.build:gradle:8.9.1`; Google's Maven URL returned HTTP 404 from this machine. No successful APK/AAB compilation or signing is claimed. Run the documented build in an environment with working Google Maven/SDK access before accepting Android packaging. Production hostname/package, signing material, Play credentials, public Digital Asset Links and installed-device checks remain pending. There has been no deployment or Play publication.

Rechecked on 2026-10-04: both `dl.google.com/dl/android/maven2` and
`dl.google.com/android/maven2` plugin URLs returned 404. The corresponding
`maven.google.com` URL and official SDK repository metadata timed out. Installed
SDK platforms 29/30 do not satisfy the required platform 36. Public build-tool
downloads need no Google/Play account; successful access to the official repositories
is still required. Do not substitute an unverified mirror, disable TLS verification,
or change the Android release identity to work around download failures.

The generator's SDK 36/plugin compatibility correction passed isolated generation,
TypeScript checking, lint and 21 unit tests. The corrected 8.10.1 plugin URL also
returned 404 from this machine; compilation/signing acceptance remains pending.
The generator rejects an unexpected upstream plugin template so a future Bubblewrap
update requires reviewing this adaptation rather than silently keeping incompatible
build settings.

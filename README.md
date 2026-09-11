# canoe-harnesses

Reusable, agent-driven operating-system and browser sessions. The controller
keeps the guest lease while an agent inspects a screen, thinks, issues another
command or hands the session to a scripted runner. Product setup and assertions
belong to the consumer repository.

Requires Bun. Install exact dependencies with `bun install --frozen-lockfile`.
Install the browser fixture with `bunx playwright-core install chromium`.

```sh
bun src/cli.ts attach profiles/browser.json
# The result includes a persistent session ID. Attach does not launch a browser.
bun src/cli.ts interact SESSION_ID '{"kind":"launch"}'
bun src/cli.ts observe SESSION_ID
bun src/cli.ts interact SESSION_ID '{"kind":"click","selector":"button"}'
bun src/cli.ts capture SESSION_ID
bun src/cli.ts logs SESSION_ID
bun src/cli.ts close SESSION_ID
```

`provision PROFILE.json` explicitly runs provision, stage and setup hooks before
attaching. `reset SESSION_ID` explicitly invokes the consumer reset hook.
Neither is inferred by attach, observe, screenshot collection or reconnecting
the CLI to an existing session. Close disconnects owned controls and runs only
an explicitly configured close hook; it does not inherently shut down a guest.

## Consumer API and profiles

```ts
import { startSession, connectSession, type TargetProfile } from "canoe-harnesses"
const session = await startSession("/absolute/path/target.json", { mode: "attach" })
await session.observe()
await session.interact({ kind: "android-key", key: "KEYCODE_BACK" })
await session.capture()
await session.logs()
await session.close()
// Another process uses connectSession(sessionId) while the controller survives.
```

`TargetProfile` and all interaction types are defined in `src/types.ts`.
Profiles name a Linux/Windows SSH endpoint, loopback Android ADB guest, or local
browser controller. An optional existing CDP endpoint must identify exactly one
page, using `urlPattern` when needed. A browser URL profile launches only on the
explicit `launch` interaction. W3C WebDriver and CDP drivers are also exported
for consumers with their own session adapters.

Hooks are argv arrays with optional cwd/env/timeout. Relative cwd, key, module
and executable paths resolve against the profile file, not this checkout.
Hooks receive `CANOE_HARNESS_PROFILE`, `CANOE_HARNESS_EVIDENCE`,
`CANOE_HARNESS_TARGET`, `CANOE_HARNESS_MODULE_ZIP`, `CANOE_HARNESS_MODULE_ID`,
`CANOE_HARNESS_EXECUTABLE` and `CANOE_HARNESS_URL`. Keep app builds, artifacts,
staging, module installation and reset semantics in consumer hooks. Host script
paths can be resolved from the installed package; no sibling checkout layout is
required.

Profiles and local command interactions are trusted automation inputs. The
controller binds only loopback and authenticates requests with a per-session
token stored in a mode-0600 record. Do not publish profiles containing secrets,
session records or collected guest data.

## Ownership and evidence

The state root remains `$CANOE_E2E_STATE`, defaulting to
`~/.local/share/canoe-e2e`. Its existing `linux/operation.lock`,
`windows/operation.lock` and `android/operation.lock` paths are preserved.
The daemon writes its PID in b4-compatible form; old and new harness commands
therefore reject each other's active leases. A dead PID is reclaimed, while an
invalid lock is reported without guessing. Android KSU and Next share the same
lease because they use the same virtual guest.

Evidence lives under `sessions/<uuid>/evidence`: observations, command results,
screenshots and collected logs have their own run identity. `controller.log`
and startup failure records remain available when attach fails. No background
timeout silently releases a live session. Explicit close or controller process
termination releases ownership; SIGKILL leaves a reclaimable dead-PID lock.

## OS infrastructure

- **Linux:** libvirt Ubuntu guest, SSH, polkit denial agent, dummy_hcd USB
  gadgets and pinned descriptor-capable QEMU build recipes.
- **Windows:** pinned Docker/QEMU guest, SSH/PowerShell, interactive desktop
  launch, real secure-desktop UAC controls, native framebuffer/OCR, USB identity
  fixture and opt-in USB/controller passthrough definitions. The generic consent
  action requires the profile's expected executable/publisher identity.
- **Android:** pinned Cuttlefish guest, standard KSU or KSU Next root provider,
  independently pinned official WebUI X Portable host,
  explicit loopback ADB, native key/tap/text/hierarchy/screenshots and optional
  already-enabled WebView CDP attachment. Attach checks identity; it never calls
  `set-manager`, modifies preferences, installs a module or resets the guest.

### Android WebUI X

`profiles/ksu.json` and `profiles/ksu-next.json` provision the root provider and
kernel. `profiles/webuix-ksu.json` and `profiles/webuix-ksu-next.json` instead
install the pinned official WebUI X Portable v438 APK into an **already booted,
rooted** guest. These WebUI profiles never run the kernel provision recipe.
Both kinds share the same Android lease. Use `attach` once setup is complete.

`control.rootManagerPackage` identifies the root provider (the older
`control.managerPackage` spelling remains accepted). `application.webuiPackage`
and `webuiVersionCode` independently identify and check the WebUI host.
The host pin, source commit and SHA-256 are in
[`hosts/android/provision/webuix.ts`](hosts/android/provision/webuix.ts); provision
records that provenance in the session evidence. Only the official APK is used.

In the host's first-run UI, select the existing root provider and authorize its
root request. For disposable-guest CDP qualification, enable **Settings →
Developer → Developer Mode**. Attach does not enable debugging or grant root.
Leave the other developer and process-lifecycle settings at their defaults.
Stage the consumer's module explicitly, then launch the WebUI X activity with
an owned module ID (the legacy KSU activity is a different host):

```sh
bun src/cli.ts interact SESSION_ID \
  '{"kind":"command","root":true,"command":"am start -n com.dergoogler.mmrl.wx/.ui.activity.webui.WebUIActivity --es id OWNED_MODULE_ID"}'
bun src/cli.ts interact SESSION_ID \
  '{"kind":"android-webview","package":"com.dergoogler.mmrl.wx","process":"com.dergoogler.mmrl.process.webui","urlPattern":"^https://mui[.]kernelsu[.]org/"}'
```

Portable uses a separate WebUI process. The `process` selector checks that its
UID belongs to the named package before forwarding its debugging socket; absent
or ambiguous PIDs are rejected. Close removes only the owned ADB forward and
CDP connection. Consumers own picker fixtures, module cleanup and acceptance.

The [v438 guest record](docs/webuix-qualification-2026-09-11.md) qualifies these
controls and records an upstream native-picker crash. Host installation and CDP
attachment alone do not qualify a consumer's file-import flow.

The scripts preserve the existing VM/container names and disks. Fresh provisioning
is explicit and may take substantial time. Invoke mutable recipes through a
leased profile hook or interaction, never concurrently as standalone scripts.
The low-level exported SSH/ADB/QEMU APIs similarly require caller-owned leases.
`guest.sh sync` retains its legacy rsync `--delete` behavior: use an isolated
consumer staging destination. The Windows guest `ps` helper stages a script;
use SSH for read-only observation.

Manual passthrough remains opt-in. No default profile selects a physical phone.
Windows fixture credentials and debug Android roots are for disposable guests.
Fresh Windows provisioning retains its test policies and Defender setup; do not
use that recipe as workstation configuration.

## Validation

`bun run check` and `bun test` exercise persistent CLI sessions, legacy locks,
explicit hook order, browser interaction and screenshots. Tests allocate fresh
temporary state roots. Chromium must be installed before browser checks.

See `VALIDATION.md` for the extraction's actual evidence and remaining boundaries.
See `PROVENANCE.md` for source checkpoints and license provenance.

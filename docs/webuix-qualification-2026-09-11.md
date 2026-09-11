# Official WebUI X Portable guest qualification

This record separates harness control from consumer acceptance. No physical
phone, partition writes, installer flow or kernel replacement was involved.

## Pinned environment

- Official Portable release v438, source commit
  `1cd1e76d9438225cc76abf2b2b42f2cc35eb7490`.
- APK: [WebUI-X-v438-release-official.apk](https://github.com/MMRLApp/WebUI-X-Portable/releases/download/v438/WebUI-X-v438-release-official.apk),
  25,886,195 bytes, SHA-256
  `7d44dcad3ae8039c63920c547116d262c282d5f43dbcf09fcf0babfce29bd1ca`.
- Installed package `com.dergoogler.mmrl.wx`, version code 438,
  version name `v438-release`.
- Existing disposable guest `127.0.0.1:6520`, `vsoc_x86_64_only`, Android 17,
  build `CP2A.260605.016/16102939`, enforcing SELinux.
- Existing root provider KSU Next v3.3.0 (`33214-2`); kernel retained.
- Selected KSU Next in Portable's first-run UI, enabled Developer Mode in its
  settings, and granted only Portable's Superuser switch through KSU Next.
  Other developer/process-lifecycle settings remained at defaults.

## Passed controls

`bun run check` and all five existing `bun test` cases passed. The explicit
`webuix-ksu-next` provision hook verified the APK digest and installed it without
calling the kernel recipe. Attach verified root-provider package/kernel and
WebUI-host package/version independently.

A tiny owned module, `canoe_harness_webuix`, launched with:

```sh
am start -n com.dergoogler.mmrl.wx/.ui.activity.webui.WebUIActivity --es id canoe_harness_webuix
```

The actual CDP target was process `com.dergoogler.mmrl.process.webui`, owned by
Portable's UID. Its page was `https://mui.kernelsu.org/index.html`; the URL does
not contain the module ID. The observed UA was
`WebUI X/438 (Linux; Android 17; Cuttlefish x86_64 phone 64-bit only; KsuNext/33214)`.
Selecting that process under the root-manager package was correctly rejected.
A nonmatching page filter failed and removed its temporary forward; a subsequent
correct attachment succeeded. Closing removed its owned forward.

Pressing Home and bringing the same activity back emitted raw `window` message
JSON strings with types `WX_ON_PAUSE` and `WX_ON_RESUME`. In both callbacks,
`document.visibilityState` was still `visible`. No visibility-change event was
observed. Consumers must use the native lifecycle signals for this host.

## Picker blocker

The official host crashed before opening its chooser, twice: once through a
direct CDP invocation and once from a fresh activity with a real pointer click
on this button handler:

```js
const i = $intent.create("android.intent.action.OPEN_DOCUMENT")
i.setType("*/*")
i.addCategory("android.intent.category.OPENABLE")
webui.openFile(i)
```

The crash screen reported a null `ActivityThread.getApplicationThread()` call.
Relevant stack frames:

```text
android.app.Activity.startActivityForResult(Activity.java:6071)
androidx.activity.ComponentActivity.startActivityForResult(ComponentActivity.kt:675)
android.app.Activity.startActivityForResult(Activity.java:6027)
androidx.activity.ComponentActivity.startActivityForResult(ComponentActivity.kt:660)
ApplicationInterface$openFile$1... (ApplicationInterface.kt:144)
WXInterface.withActivity(WXinterface.kt:142)
ApplicationInterface$openFile$1.invokeSuspend(ApplicationInterface.kt:143)
kotlinx.coroutines.internal.LimitedDispatcher$Worker.run(LimitedDispatcher.kt:113)
kotlinx.coroutines.scheduling.CoroutineScheduler$Worker.run(CoroutineScheduler.kt:707)
```

Pinned source [WebUIView.createDefaultWxOptions](https://github.com/MMRLApp/WebUI-X-Portable/blob/1cd1e76d9438225cc76abf2b2b42f2cc35eb7490/webui/src/main/kotlin/com/dergoogler/mmrl/webui/view/WebUIView.kt#L80)
constructs a new unattached `ComponentActivity`. `WXInterface` passes that activity
to its base interface and `withActivity` invokes the block directly.
`ApplicationInterface.openFile` also launches from `Dispatchers.IO`. The unattached
activity is consistent with the null ActivityThread failure; changing only the
dispatcher would not attach it. No Android 16 or physical-phone behavior is claimed. No host
APK patch or workaround was installed. Native picker selection, cancellation
and CBM's 100 MiB import remain unqualified by this probe.

## Evidence and cleanup

Local session IDs: initial setup `0c57171c-20d2-4b60-aff9-93b0d90d97bb`, pinned
provision/lifecycle `9b454240-1c83-4d7f-b40f-82f0a1259bd2`, fresh button repro
`c74b465a-a7ba-41d3-be5e-8dfea811c425`, control checks and native crash screenshot
`e47b3b4d-7b37-4a94-8720-941aecc89323`. Logs, UI hierarchy and PNG remain under
the private harness session evidence directories.

The owned probe module and `/sdcard/Download/canoe-webuix-100MiB.img` were removed.
The latter was a 104,857,600-byte zero-filled local source; no import timing was
recorded because the chooser never opened. All probe leases and ADB forwards
were closed. Portable remains installed/configured for subsequent consumer
qualification, with the existing Next root provider unchanged.

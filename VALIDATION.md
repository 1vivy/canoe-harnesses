# b5 extraction validation

Validated on 2026-09-09 with Bun 1.4.0, TypeScript 5.9.3 and Playwright 1.56.1.

- TypeScript strict check passed.
- Persistent session check passed: CLI process exited, controller retained the
  old operation.lock identity, subsequent observation succeeded, second attach
  failed, explicit reset ran and close released the lease.
- A live b4-shaped lock blocked the new controller. A dead lock was reclaimed.
- Provision/stage/setup order passed; missing reset was rejected without
  inventing an application action.
- Actual Chromium page launch, native Playwright click, DOM observation and PNG
  screenshot passed against a local generic page. Attach alone left it unopened.
- A separate clone outside the project layout installed with its frozen lockfile
  and passed the same strict check and all four lifecycle/browser checks.
- The existing Linux guest was attached through SSH, observed and disconnected.
  It reported kernel `6.8.0-139-generic`. No provisioning, reset, guest staging,
  USB mutation or application launch was performed.

The extraction does not inherit b4 application acceptance. Windows USB/UAC and
Android KSU/Next recipes are preserved, but were not rerun on live guests in this
phase. They require consumer profiles and separately recorded b5 acceptance.
The current Windows passthrough guest and physical phones were left untouched.

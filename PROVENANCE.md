# Provenance and ownership

Reusable code and fixture recipes were extracted from `1vivy/canoe-boot-manager`
checkpoint `7.0.0-b4-final` (`37d20f52c94acdced06d367ebd344e8af2f701bc`). The source checkpoint remains
available; history was intentionally not replayed into this new repository.

Extracted paths: `e2e/driver`, `e2e/hosts/common/ssh.ts`,
`e2e/hosts/android/adb.ts`, and selected platform provisioning recipes.
The old app-specific Host implementations, Tauri helper probes, native builds,
product fixture preparation, workflow simulator and UI scenarios were excluded.
The W3C client now accepts consumer capabilities. Android provisioning no
longer builds or installs an application module.

The source checkpoint did not include a root license file. Extraction preserves
existing notices and upstream licenses; this record does not invent a new
license grant or relicense upstream code. Dependency licenses remain theirs.
The QEMU patch and KernelSU Next patch preserve their source attribution.

New b5 session controller and profiles are maintained with this repository.
Generated evidence is not claimed as inherited b4 acceptance evidence.

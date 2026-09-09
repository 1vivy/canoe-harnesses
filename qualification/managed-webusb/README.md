# Managed USB through a real guest OS and browser

This fixture exercises the production `canoe-usb-web` facade and filesystem
worker against QEMU's USB host controller and BOT/SCSI disk engine. It never
replaces `navigator.usb`, USB transfers, or filesystem operations with a JS mock.
Every backing image is synthetic. Run mutable commands only under the relevant
harness lease. The physical phone and the existing manual Windows guest are
outside this fixture.

## Device model

Both pinned QEMU build recipes apply `qemu-usb-identity.patch`, followed by
`qemu-managed-storage.patch`, on QEMU `84f07211cc5b4fc6a371559bf8a5de4fb068e648`.
The second patch adds `usb-storage,managed=on`: interface ff/06/50 and Microsoft
OS 1.0 WINUSB / DeviceInterfaceGUIDs descriptors. It reuses QEMU's SCSI engine.
Default `managed=off` retains ordinary class08. This is a USB protocol fixture;
it is not a firmware emulator and does not reproduce CANOE-BDS descriptor bytes
or its automatic disconnect after eject. The fixture must be detached explicitly
when testing a new export. `qmp-cycle.py` checks the isolated guest name and cycles
only its named synthetic disk.

## Linux

Use `hosts/linux/provision/webusb/up.sh` with explicit paths for
`CANOE_WEBUSB_STATE`, `CANOE_WEBUSB_QEMU`, `CANOE_WEBUSB_BASE` and
`CANOE_WEBUSB_FIRMWARE`. It starts a **separate** cloud-image overlay, SSH port
2244 by default, and file-backed managed/manual USB devices. It does not change
libvirt, the existing Linux guest, host USB drivers or passed-through devices.
The cloud-init recipe installs browser runtime dependencies and grants only the
managed fixture to the guest's `plugdev` group.

Stage a trusted Chromium build into the guest. The recorded run used Playwright
Chromium 141.0.7390.37; its `chrome_sandbox` helper was installed root-owned with
mode4755 and selected through `CHROME_DEVEL_SANDBOX`. Chromium ran as `canoe`
with its ordinary sandbox (renderer `NoNewPrivs:1`, `Seccomp:2`), Xvfb and an
isolated user-data directory. Do not carry fixture installation flags to a
user's normal browser.

Serve this directory's `page.html` and `browser-probe.js` alongside the actual
built WASM facade as `/core/canoe_usb_web.js` and its generated assets, plus the
packaged filesystem worker as `/engine/filesystem.js` and its assets. The page
also accepts explicit `facade` and `filesystem` URL parameters. Use a secure
localhost origin (an SSH reverse tunnel is sufficient), and send
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. Forward the guest's CDP port through
a separate loopback tunnel and name that endpoint in the leased profile.

Click the page's connection button, then use the **native browser chooser** to
select the uniquely named synthetic disk. Chromium141's CDP DeviceAccess domain
did not intercept this USB chooser; the recorded run selected its visible X11
controls. Confirm the session is open, then run:

```sh
bun qualification/managed-webusb/run.ts SESSION evidence.json fat
# On a separately prepared ext4 fixture with an unrelated /foreign.txt:
bun qualification/managed-webusb/run.ts SESSION evidence.json ext4
```

The probe validates the synthetic serial, fixed access mode, raw reads, six
read-only filesystem rejections, three close/reopen cycles, real create/write/
rename, fresh readback, remove, fresh absence, sync and eject/awaited close.
Independently run `fsck.fat -n` or `e2fsck -fn` on the detached resulting image.
`descriptors.py` validates managed descriptors using real control transfers;
run it inside the guest while no browser owns the interface.

## Windows

`hosts/windows/provision/webusb/compose.yaml` and `up.sh` create the separate
`canoe-e2e-webusb-windows` evaluation guest on ports8007/2223. Set an isolated
`CANOE_WEBUSB_STATE`, stage the patched **container-compatible** QEMU binary,
and provide a verified official evaluation ISO as `storage/custom.iso`.
The recipe has no host USB or PCI passthrough. Do not reuse the live manual
Windows disk or change the existing `canoe-e2e-windows` container.

Attach the synthetic USB disks **after Windows installation**. Attaching the
ordinary USB disk during setup changes Windows' disk numbering and interferes
with the unattended target selection. Keep the two backing files separate;
manual mode belongs to the OS mass-storage driver, managed mode to WinUSB.
Driver binding, browser claim/reconnect, and device identity must be observed
in Windows before recording a Windows pass. Linux control-descriptor success
alone is not Windows qualification.

## Recorded boundary

See `linux.json` for actual Linux results and exact engine hashes. Plain-JBD2
pending-journal recovery also ran over real guest USB: sequence42/start1 became
sequence44/start0, RECOVER cleared on finish, and independent e2fsck confirmed
the committed0600 inode and superblock label while discarding an uncommitted
trailing overwrite. The source fixture is generated independently in
`1vivy/rust-fs-ext4`'s `tests/journal_mount_recovery.rs` at
`8315da024dc352408fe9f005ee5618ac8c4ab29f`. A full copy was retained before RW
mount/replay. Checksummed journal recovery and physical-phone browser writes
remain outside this evidence.

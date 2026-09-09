#!/usr/bin/env bash
# Same narrow USB descriptor fixture as Windows, built for the native Linux host.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
state=${CANOE_E2E_STATE:-$HOME/.local/share/canoe-e2e}/linux
source=${CANOE_E2E_STATE:-$HOME/.local/share/canoe-e2e}/windows/qemu-src
revision=84f07211cc5b4fc6a371559bf8a5de4fb068e648
patch=$here/../../windows/provision/qemu-usb-identity.patch
mkdir -p "$state/qemu-build"
if [ ! -d "$source/.git" ]; then
  source=$state/qemu-src
  [ -d "$source/.git" ] || git clone --depth 1 --branch v11.1.0 https://gitlab.com/qemu-project/qemu.git "$source"
fi
[ "$(git -C "$source" rev-parse HEAD)" = "$revision" ]
if git -C "$source" apply --check "$patch" 2>/dev/null; then git -C "$source" apply "$patch"; else git -C "$source" apply --reverse --check "$patch"; fi
cd "$state/qemu-build"
"$source/configure" --target-list=x86_64-softmmu --disable-docs --disable-werror --prefix=/usr
ninja -j8 qemu-system-x86_64
cp qemu-system-x86_64 "$state/qemu-system-x86_64.next"
mv "$state/qemu-system-x86_64.next" "$state/qemu-system-x86_64"
mkdir -p "$state/qemu-firmware"
cp "$source"/pc-bios/*.bin "$source"/pc-bios/*.rom "$state/qemu-firmware/"
sha256sum "$state/qemu-system-x86_64" "$patch" > "$state/qemu-fixture.sha256"

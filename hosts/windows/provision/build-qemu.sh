#!/usr/bin/env bash
# Only the harness emulator gains configurable USB descriptors. The guest and
# production backend retain real Windows USB enumeration and identity checks.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
state=${CANOE_E2E_STATE:-$HOME/.local/share/canoe-e2e}/windows
revision=84f07211cc5b4fc6a371559bf8a5de4fb068e648
base=dockurr/windows@sha256:0cff9eb0e7aee9953e55bc682852ca4fdca233145a58ae1ec94f0b0c01a2ed30
mkdir -p "$state"
if [ ! -d "$state/qemu-src/.git" ]; then
  git clone --depth 1 --branch v11.1.0 https://gitlab.com/qemu-project/qemu.git "$state/qemu-src"
fi
[ "$(git -C "$state/qemu-src" rev-parse HEAD)" = "$revision" ]
if git -C "$state/qemu-src" apply --check "$here/qemu-usb-identity.patch"; then
  git -C "$state/qemu-src" apply "$here/qemu-usb-identity.patch"
else
  git -C "$state/qemu-src" apply --reverse --check "$here/qemu-usb-identity.patch"
fi
docker run --rm --name canoe-qemu-builder --entrypoint bash -v "$state/qemu-src:/src" "$base" -c '
set -e
echo "deb https://deb.debian.org/debian sid main" > /etc/apt/sources.list.d/canoe-build.list
apt-get update
apt-get install -y --no-install-recommends build-essential ninja-build python3-venv git libglib2.0-dev libpixman-1-dev zlib1g-dev libaio-dev libslirp-dev libzstd-dev libusb-1.0-0-dev
cd /src
git config --global --add safe.directory /src
./configure --target-list=x86_64-softmmu --disable-docs --disable-werror --enable-vnc --enable-linux-aio --enable-libusb --prefix=/usr
ninja -C build -j8 qemu-system-x86_64
'
cp "$state/qemu-src/build/qemu-system-x86_64" "$state/qemu-system-x86_64.next"
mv "$state/qemu-system-x86_64.next" "$state/qemu-system-x86_64"
sha256sum "$state/qemu-system-x86_64" "$here/qemu-usb-identity.patch" > "$state/qemu-fixture.sha256"

#!/usr/bin/env bash
# Invoke only under an isolated Windows harness lease. Never reuse the manual
# Windows guest's state directory; this script does not inspect or stop it.
set -euo pipefail
: "${CANOE_WEBUSB_STATE:?Choose an isolated directory for this Windows fixture}"
here=$(cd "$(dirname "$0")" && pwd)
state=$(realpath -m "$CANOE_WEBUSB_STATE")
[ "$state" != "${HOME}/.local/share/canoe-e2e/windows" ] || { echo 'Refusing the default manual Windows state' >&2; exit 1; }
[ -x "$state/qemu-system-x86_64" ] || { echo 'Build and stage the managed-descriptor QEMU binary first.' >&2; exit 1; }
mkdir -p "$state/storage" "$state/oem" "$state/share" "$state/fixtures"
[ -f "$state/storage/custom.iso" ] || { echo 'Stage the verified official Windows evaluation ISO as storage/custom.iso.' >&2; exit 1; }
[ -f "$state/id_ed25519" ] || ssh-keygen -q -t ed25519 -N '' -C canoe-webusb-windows -f "$state/id_ed25519"
cp "$here/../oem/install.bat" "$here/../oem/setup.ps1" "$state/oem/"
cp "$state/id_ed25519.pub" "$state/oem/authorized_keys"
[ -f "$state/fixtures/managed.img" ] || { truncate -s 64M "$state/fixtures/managed.img"; mkfs.fat -F32 -n MANAGED "$state/fixtures/managed.img" >/dev/null; }
[ -f "$state/fixtures/manual.img" ] || { truncate -s 32M "$state/fixtures/manual.img"; mkfs.fat -F16 -n MANUAL "$state/fixtures/manual.img" >/dev/null; }
export CANOE_WEBUSB_STATE=$state
docker compose -p canoe-webusb-isolated -f "$here/compose.yaml" up -d
echo 'Isolated Windows evaluation guest: console 127.0.0.1:8007; SSH 127.0.0.1:2223'

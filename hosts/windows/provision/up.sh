#!/usr/bin/env bash
# Bring up (or resume) the Windows guest. Idempotent: stages the OEM folder,
# ensures the harness SSH key, and starts the compose service.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
state=${CANOE_E2E_STATE:-$HOME/.local/share/canoe-e2e}
mkdir -p "$state/windows/storage" "$state/windows/oem" "$state/windows/share"
key=$state/windows/id_ed25519
[ -f "$key" ] || ssh-keygen -q -t ed25519 -N "" -C "canoe-e2e-windows" -f "$key"
cp "$here/oem/install.bat" "$here/oem/setup.ps1" "$state/windows/oem/"
cp "$key.pub" "$state/windows/oem/authorized_keys"
export CANOE_E2E_STATE=$state
if [ ! -x "$state/windows/qemu-system-x86_64" ] || ! sha256sum --status -c "$state/windows/qemu-fixture.sha256" 2>/dev/null; then
  "$here/build-qemu.sh"
fi
docker compose -f "$here/compose.yaml" up -d
echo "console: http://127.0.0.1:8006  ssh: ssh -i $key -p 2222 canoe@127.0.0.1"

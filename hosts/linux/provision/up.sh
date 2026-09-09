#!/usr/bin/env bash
# Bring up (or resume) the Ubuntu 24.04 guest under libvirt. Idempotent.
# Disks live under $CANOE_E2E_STATE/linux: an overlay over the pristine cloud
# image, a 256 MiB raw disk that the guest sees as /dev/vdb (the fake device),
# and the cloud-init seed ISO carrying the harness SSH key.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
state=${CANOE_E2E_STATE:-$HOME/.local/share/canoe-e2e}/linux
name=canoe-e2e-linux
conn=qemu:///system
mkdir -p "$state"
base=$state/noble-server-cloudimg-amd64.img
[ -f "$base" ] || curl -fsSL -o "$base.part" https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img && { [ -f "$base" ] || mv "$base.part" "$base"; }
key=$state/id_ed25519
[ -f "$key" ] || ssh-keygen -q -t ed25519 -N "" -C "canoe-e2e-linux" -f "$key"

# Host prerequisite: libvirt's default bridge (virbr0) must be allowed to serve
# DHCP/DNS and forward traffic. With ufw active that means the same three rules
# this host already carries for its other libvirt bridge:
#   sudo ufw allow in on virbr0 to any port 67 proto udp comment 'canoe-e2e guest DHCP'
#   sudo ufw allow in on virbr0 to any port 53 comment 'canoe-e2e guest DNS'
#   sudo ufw route allow in on virbr0 comment 'canoe-e2e guest forwarding'
if command -v ufw >/dev/null 2>&1 && sudo -n ufw status 2>/dev/null | grep -q "^Status: active" \
   && ! sudo -n ufw status 2>/dev/null | grep -q "canoe-e2e guest DHCP"; then
  echo "ufw is active without the canoe-e2e rules for virbr0; add them (see comments in $0)" >&2
  exit 1
fi

if virsh -c "$conn" dominfo "$name" >/dev/null 2>&1; then
  state_now=$(virsh -c "$conn" domstate "$name")
  [ "$state_now" = "running" ] || virsh -c "$conn" start "$name" >/dev/null
else
  [ -f "$state/disk.qcow2" ] || qemu-img create -q -f qcow2 -b "$base" -F qcow2 "$state/disk.qcow2" 40G
  [ -f "$state/vdb.img" ] || truncate -s 256M "$state/vdb.img"
  seed=$state/seed
  rm -rf "$seed" && mkdir -p "$seed"
  python3 - "$here/cloud-init.user-data" "$key.pub" "$seed/user-data" <<'PY'
import sys
src, pub, dst = sys.argv[1:4]
text = open(src).read().replace("ssh_authorized_keys: []", "ssh_authorized_keys:\n      - " + open(pub).read().strip())
open(dst, "w").write(text)
PY
  cp "$here/cloud-init.meta-data" "$seed/meta-data"
  xorrisofs -quiet -output "$state/seed.iso" -volid cidata -joliet -rational-rock "$seed/user-data" "$seed/meta-data"
  virsh -c "$conn" net-info default >/dev/null 2>&1 && virsh -c "$conn" net-start default >/dev/null 2>&1 || true
  virt-install --connect "$conn" --name "$name" --memory 6144 --vcpus 4 --cpu host-passthrough \
    --osinfo ubuntu24.04 --import --noautoconsole --graphics none \
    --disk "path=$state/disk.qcow2,format=qcow2,bus=virtio" \
    --disk "path=$state/vdb.img,format=raw,bus=virtio,serial=canoe-fake-device" \
    --disk "path=$state/seed.iso,device=cdrom" \
    --network network=default --console pty,target_type=serial >/dev/null
fi

for _ in $(seq 1 60); do
  ip=$(virsh -c "$conn" domifaddr "$name" 2>/dev/null | awk '/ipv4/ {split($4,a,"/"); print a[1]; exit}')
  [ -n "${ip:-}" ] && break
  sleep 2
done
[ -n "${ip:-}" ] || { echo "no IPv4 lease for $name" >&2; exit 1; }
echo "$ip" > "$state/ip"
echo "guest: $name  ip: $ip  ssh: ssh -i $key canoe@$ip"

#!/usr/bin/env bash
# Invoke only under a harness lease. A separate cloud-image overlay; no libvirt,
# existing guest disk, physical USB controller or phone is touched.
set -euo pipefail
: "${CANOE_WEBUSB_STATE:?Choose an isolated fixture directory}"
: "${CANOE_WEBUSB_QEMU:?Build the patched QEMU fixture first}"
: "${CANOE_WEBUSB_BASE:?Provide a pristine Ubuntu 24.04 cloud image}"
: "${CANOE_WEBUSB_FIRMWARE:?Provide the QEMU pc-bios directory}"
state=$(realpath -m "$CANOE_WEBUSB_STATE")
port=${CANOE_WEBUSB_SSH_PORT:-2244}
mkdir -p "$state/seed"
if [ -e "$state/qemu.pid" ] && kill -0 "$(cat "$state/qemu.pid")" 2>/dev/null; then
  echo "An existing fixture process is recorded in $state/qemu.pid; close it explicitly." >&2
  exit 1
fi
[ -f "$state/id_ed25519" ] || ssh-keygen -q -t ed25519 -N '' -C canoe-webusb-fixture -f "$state/id_ed25519"
[ -f "$state/disk.qcow2" ] || qemu-img create -q -f qcow2 -b "$(realpath "$CANOE_WEBUSB_BASE")" -F qcow2 "$state/disk.qcow2" 16G
[ -f "$state/managed.img" ] || { truncate -s 64M "$state/managed.img"; mkfs.fat -F 32 -n MANAGED "$state/managed.img" >/dev/null; }
[ -f "$state/manual.img" ] || { truncate -s 32M "$state/manual.img"; mkfs.fat -F 16 -n MANUAL "$state/manual.img" >/dev/null; }
cat > "$state/seed/meta-data" <<EOF
instance-id: canoe-webusb-fixture
local-hostname: canoe-webusb-fixture
EOF
cat > "$state/seed/user-data" <<EOF
#cloud-config
users:
  - name: canoe
    groups: [sudo, plugdev]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: true
    ssh_authorized_keys:
      - $(cat "$state/id_ed25519.pub")
package_update: true
package_upgrade: false
packages: [xvfb, xdotool, imagemagick, usbutils, python3, python3-usb, curl, unzip, libnss3, libnspr4, libatk1.0-0t64, libatk-bridge2.0-0t64, libcups2t64, libxcomposite1, libxdamage1, libxfixes3, libxrandr2, libgbm1, libasound2t64, libpango-1.0-0, libcairo2, libxkbcommon0]
write_files:
  - path: /etc/udev/rules.d/72-canoe-webusb-fixture.rules
    permissions: '0644'
    content: |
      SUBSYSTEM=="usb", ATTR{idVendor}=="1209", ATTR{idProduct}=="ca0f", GROUP="plugdev", MODE="0660"
runcmd:
  - [udevadm, control, --reload-rules]
  - [udevadm, trigger, --subsystem-match=usb]
  - [touch, /var/lib/cloud/instance/canoe-webusb-ready]
EOF
xorrisofs -quiet -output "$state/seed.iso" -volid cidata -joliet -rational-rock "$state/seed/user-data" "$state/seed/meta-data"
"$CANOE_WEBUSB_QEMU" -name canoe-webusb-fixture -machine q35,accel=kvm -cpu host -m 3072 -smp 4 \
  -L "$CANOE_WEBUSB_FIRMWARE" -display none -serial "file:$state/serial.log" \
  -daemonize -pidfile "$state/qemu.pid" -qmp "unix:$state/qmp.sock,server=on,wait=off" \
  -drive "file=$state/disk.qcow2,format=qcow2,if=virtio" \
  -drive "file=$state/seed.iso,format=raw,media=cdrom" \
  -netdev "user,id=net0,hostfwd=tcp:127.0.0.1:$port-:22" -device virtio-net-pci,netdev=net0 \
  -device qemu-xhci,id=xhci \
  -drive "file=$state/managed.img,format=raw,if=none,id=managed-disk" \
  -device usb-storage,bus=xhci.0,drive=managed-disk,id=managed,removable=on,vendorid=0x1209,productid=0xca0f,managed=on,serial=CANOE_MANAGED \
  -drive "file=$state/manual.img,format=raw,if=none,id=manual-disk" \
  -device usb-storage,bus=xhci.0,drive=manual-disk,id=manual,removable=on,vendorid=0x1209,productid=0xca0e,serial=CANOE_MANUAL
printf 'Started isolated fixture PID %s; SSH port %s; wait for cloud-init before browser qualification.\n' "$(cat "$state/qemu.pid")" "$port"

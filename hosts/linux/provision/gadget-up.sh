#!/usr/bin/env bash
# Expose /dev/vdb to the guest itself as a USB mass-storage device with the
# Canoe export identity (1209:ca0e) via dummy_hcd + configfs. The app's
# export discovery only accepts USB nodes with that identity, so this is the
# fake persist export on Linux. Prints the resulting block node.
set -euo pipefail
backing=${1:-/dev/vdb}
modprobe libcomposite
modprobe dummy_hcd
modprobe usb_f_mass_storage
mountpoint -q /sys/kernel/config || mount -t configfs none /sys/kernel/config
g=/sys/kernel/config/usb_gadget/canoe
if [ -d "$g" ] && [ -n "$(cat "$g/UDC" 2>/dev/null)" ]; then
  echo "gadget already bound" >&2
else
  mkdir -p "$g"
  echo 0x1209 > "$g/idVendor"
  echo 0xca0e > "$g/idProduct"
  echo 0x0200 > "$g/bcdUSB"
  mkdir -p "$g/strings/0x409"
  echo "Canoe" > "$g/strings/0x409/manufacturer"
  echo "Canoe boot root" > "$g/strings/0x409/product"
  echo "CANOE_E2E" > "$g/strings/0x409/serialnumber"
  mkdir -p "$g/configs/c.1/strings/0x409"
  echo "mass storage" > "$g/configs/c.1/strings/0x409/configuration"
  mkdir -p "$g/functions/mass_storage.0"
  echo 1 > "$g/functions/mass_storage.0/lun.0/removable"
  echo 0 > "$g/functions/mass_storage.0/lun.0/ro"
  echo "$backing" > "$g/functions/mass_storage.0/lun.0/file"
  [ -e "$g/configs/c.1/mass_storage.0" ] || ln -s "$g/functions/mass_storage.0" "$g/configs/c.1/"
  udc=$(ls /sys/class/udc | head -1)
  echo "$udc" > "$g/UDC"
  setsid python3 /opt/canoe/export-disconnect.py "$g" </dev/null >/opt/canoe/logs/export-disconnect.log 2>&1 &
fi
usb_identity() {
  # Walk up from the SCSI device to the USB device that carries idVendor/idProduct.
  local dir
  dir=$(readlink -f "$1/device")
  while [ "$dir" != "/" ] && [ -n "$dir" ]; do
    if [ -f "$dir/idVendor" ] && [ -f "$dir/idProduct" ]; then
      echo "$(cat "$dir/idVendor"):$(cat "$dir/idProduct")"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}
for _ in $(seq 1 50); do
  for block in /sys/block/sd*; do
    [ -e "$block" ] || continue
    if [ "$(usb_identity "$block" 2>/dev/null || true)" = "1209:ca0e" ]; then
      echo "/dev/$(basename "$block")"
      exit 0
    fi
  done
  sleep 0.2
done
echo "no 1209:ca0e block device appeared" >&2
exit 1

#!/usr/bin/env bash
# Unbind and remove the fake export gadget.
set -euo pipefail
g=/sys/kernel/config/usb_gadget/canoe
[ -d "$g" ] || exit 0
echo "" > "$g/UDC" 2>/dev/null || true
rm -f "$g/configs/c.1/mass_storage.0"
rmdir "$g/configs/c.1/strings/0x409" "$g/configs/c.1" "$g/functions/mass_storage.0" "$g/strings/0x409" "$g" 2>/dev/null || true

#!/usr/bin/env bash
# Ubuntu kernels do not ship dummy_hcd (CONFIG_USB_DUMMY_HCD is unset), so
# build it out of tree from the matching upstream source against the guest's
# headers. Idempotent; installs into /lib/modules/$(uname -r)/extra.
set -euo pipefail
release=$(uname -r)
if modinfo -n dummy_hcd >/dev/null 2>&1; then echo "dummy_hcd present"; exit 0; fi
upstream=$(echo "$release" | sed -E 's/^([0-9]+\.[0-9]+)\..*/\1/')
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q "linux-headers-$release" build-essential curl >/dev/null
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl -fsSL "https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git/plain/drivers/usb/gadget/udc/dummy_hcd.c?h=v$upstream" -o "$work/dummy_hcd.c"
grep -q "dummy_hcd" "$work/dummy_hcd.c" || { echo "unexpected download" >&2; exit 1; }
printf 'obj-m += dummy_hcd.o\n' > "$work/Makefile"
make -s -C "/lib/modules/$release/build" M="$work" modules
sudo mkdir -p "/lib/modules/$release/extra"
sudo cp "$work/dummy_hcd.ko" "/lib/modules/$release/extra/"
sudo depmod -a
modinfo -n dummy_hcd

#!/usr/bin/env bash
set -euo pipefail
state=${CANOE_E2E_STATE:-$HOME/.local/share/canoe-e2e}/android
kernel=$state/kernel
image=us-docker.pkg.dev/android-cuttlefish-artifacts/cuttlefish-orchestration/cuttlefish-orchestration@sha256:ecdb337615c719ed62e12593f7931a313d7c15a99a919e69fd87510e14a249e6
kernel_revision=3ec022196c4e9d5c1434599cdda63f622dd6f586
ksu_revision=932014ab5b2c9b74a3d11e2ec4d17dd10fc9442e
clang_sha=e215171fe6704a36089015808707c7ba0784ea336cea4f76c67b9675a43d52c6
rust_sha=d0d75de87b821e5f50192b567892e3a04635068b8f07a7bb2d720661c82c6d2c
mkdir -p "$kernel"

checkout() {
  local path=$1 remote=$2 revision=$3
  if [ ! -d "$path/.git" ]; then
    git init "$path"
    git -C "$path" remote add origin "$remote"
    git -C "$path" fetch --depth 1 origin "$revision"
    git -C "$path" checkout --detach FETCH_HEAD
  fi
  [ "$(git -C "$path" rev-parse HEAD)" = "$revision" ] || {
    echo "Unexpected source revision in $path" >&2; exit 1;
  }
}
checkout "$kernel/common" https://android.googlesource.com/kernel/common "$kernel_revision"
checkout "$kernel/KernelSU" https://github.com/tiann/KernelSU "$ksu_revision"
if [ ! -f "$kernel/clang.tar.gz" ]; then
  curl -fL --retry 3 'https://android.googlesource.com/platform/prebuilts/clang/host/linux-x86/+archive/refs/heads/main/clang-r536225.tar.gz' -o "$kernel/clang.tar.gz.partial"
  mv "$kernel/clang.tar.gz.partial" "$kernel/clang.tar.gz"
fi
printf '%s  %s\n' "$clang_sha" "$kernel/clang.tar.gz" | sha256sum -c -
if [ ! -x "$kernel/clang/bin/clang" ]; then
  mkdir -p "$kernel/clang"
  tar -xzf "$kernel/clang.tar.gz" -C "$kernel/clang"
fi
if [ ! -f "$kernel/rust.tar.gz" ]; then
  curl -fL --retry 3 'https://android.googlesource.com/platform/prebuilts/rust/+archive/refs/heads/main/linux-x86/1.82.0.tar.gz' -o "$kernel/rust.tar.gz.partial"
  mv "$kernel/rust.tar.gz.partial" "$kernel/rust.tar.gz"
fi
printf '%s  %s\n' "$rust_sha" "$kernel/rust.tar.gz" | sha256sum -c -
if [ ! -x "$kernel/rust/bin/rustc" ]; then
  mkdir -p "$kernel/rust"
  tar -xzf "$kernel/rust.tar.gz" -C "$kernel/rust"
fi
if [ ! -x "$kernel/tools/bin/bindgen" ]; then
  cargo install --locked --root "$kernel/tools" --version 0.69.5 bindgen-cli
fi
export PATH="$kernel/rust/bin:$kernel/tools/bin:$PATH"
export LIBCLANG_PATH="$kernel/clang/lib"
mkdir -p "$kernel/stock-boot"
docker run --rm --user "$(id -u):$(id -g)" --volume "$state:/state" --entrypoint /state/cvd/bin/unpack_bootimg "$image" \
  --boot_img /state/cvd/boot.img --out /state/kernel/stock-boot
bash "$kernel/common/scripts/extract-ikconfig" "$kernel/stock-boot/kernel" > "$kernel/stock.config"
grep -q 'Linux/x86_64 6.12.74 Kernel Configuration' "$kernel/stock.config"
python3 - "$kernel" <<'PY'
from pathlib import Path
import sys
base = Path(sys.argv[1])
common = base / 'common'
link = common / 'drivers/kernelsu'
if not link.exists():
    link.symlink_to('../../KernelSU/kernel')
for name, marker, line in [
    ('Makefile', 'CONFIG_KSU', '\nobj-$(CONFIG_KSU) += kernelsu/\n'),
    ('Kconfig', 'drivers/kernelsu/Kconfig', '\nsource "drivers/kernelsu/Kconfig"\n'),
]:
    path = common / 'drivers' / name
    text = path.read_text()
    if marker not in text:
        path.write_text(text + line)
config = (base / 'stock.config').read_text()
# Preserve the stock Rust/ashmem and module ABI configuration as well as CFI.
# Debug mode grants this disposable guest's adb shell KSU access for provisioning.
config += '\nCONFIG_KSU=y\nCONFIG_KSU_DEBUG=y\nCONFIG_KSU_X86_PATCH_SYSCALL_DISPATCHER=y\n'
(base / 'out').mkdir(exist_ok=True)
(base / 'out/.config').write_text(config)
PY
make -C "$kernel/common" ARCH=x86_64 O="$kernel/out" LLVM="$kernel/clang/bin/" olddefconfig
# A change to ABI-generation flags does not invalidate existing kernel objects.
# Rebuild them when this recipe changes instead of reusing incompatible CRCs.
recipe=$(sha256sum "$0" | cut -d ' ' -f 1)
if [ "$(cat "$kernel/recipe.sha256" 2>/dev/null || true)" != "$recipe" ]; then
  make -C "$kernel/common" ARCH=x86_64 O="$kernel/out" LLVM="$kernel/clang/bin/" clean
fi
make -C "$kernel/common" ARCH=x86_64 O="$kernel/out" LLVM="$kernel/clang/bin/" \
  KERNELRELEASE=6.12.74-android16-6-g3ec022196c4e-ab15076761 KBUILD_GENDWARFKSYMS_STABLE=1 \
  -j"${CANOE_E2E_KERNEL_JOBS:-8}" bzImage
sha256sum "$kernel/out/arch/x86/boot/bzImage" "$kernel/out/.config" > "$kernel/build.sha256"
printf '%s\n' "$recipe" > "$kernel/recipe.sha256"
printf 'kernel=%s\nkernelsu=%s\nclang=%s\n' "$kernel_revision" "$ksu_revision" "$clang_sha" > "$kernel/revisions.txt"

#!/usr/bin/env bash
# Independent Next build using the same pinned Android ABI/toolchain as standard KSU.
# Builds only; changing the guest kernel is a separate owned-guest action.
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
state=${CANOE_E2E_STATE:-$HOME/.local/share/canoe-e2e}/android
kernel=$state/kernel
common=$kernel/common-next
source=$kernel/KernelSU-Next
revision=3b18216f71df189ab3d1b1ce0bdb21be1268e771
android_revision=3ec022196c4e9d5c1434599cdda63f622dd6f586
[[ -f $kernel/stock.config && -x $kernel/clang/bin/clang && -x $kernel/rust/bin/rustc && -x $kernel/tools/bin/bindgen ]] || {
 echo 'Provision the standard pinned toolchain with build-kernel.sh first.' >&2; exit 1;
}
if [[ ! -d $source/.git ]]; then
 git clone --depth 1 --branch v3.3.0 https://github.com/KernelSU-Next/KernelSU-Next "$source"
fi
[[ $(git -C "$source" rev-parse HEAD) == "$revision" ]] || { echo 'Unexpected Next source revision' >&2; exit 1; }
if [[ ! -e $common ]]; then
 git -C "$kernel/common" worktree add --detach "$common" "$android_revision"
fi
[[ $(git -C "$common" rev-parse HEAD) == "$android_revision" ]] || { echo 'Unexpected Android kernel revision' >&2; exit 1; }
patch=$here/patches/next-x86-dispatcher.patch
if git -C "$common" apply --reverse --check "$patch" 2>/dev/null; then
 : # Already applied to this dedicated worktree.
else
 git -C "$common" apply --check "$patch"
 git -C "$common" apply "$patch"
fi
export PATH="$kernel/rust/bin:$kernel/tools/bin:$PATH"
export LIBCLANG_PATH="$kernel/clang/lib"
python3 - "$kernel" <<'PY'
from pathlib import Path
import sys
base=Path(sys.argv[1]); common=base/'common-next'
# v3.3.0 uses __init/__exit in this header without including their declaration.
p=base/'KernelSU-Next/kernel/feature/sulog.h'
text=p.read_text()
if '#include <linux/init.h>' not in text:
 p.write_text(text.replace('#include <linux/types.h>', '#include <linux/init.h>\n#include <linux/types.h>'))
link=common/'drivers/kernelsu'
if not link.is_symlink(): link.symlink_to('../../KernelSU-Next/kernel')
assert link.resolve()==(base/'KernelSU-Next/kernel').resolve()
for name,marker,line in [('Makefile','CONFIG_KSU','\nobj-$(CONFIG_KSU) += kernelsu/\n'),('Kconfig','drivers/kernelsu/Kconfig','\nsource "drivers/kernelsu/Kconfig"\n')]:
 p=common/'drivers'/name; text=p.read_text()
 if marker not in text:p.write_text(text+line)
(base/'out-next').mkdir(exist_ok=True)
(base/'out-next/.config').write_text((base/'stock.config').read_text()+'\nCONFIG_KSU=y\nCONFIG_KSU_DEBUG=y\n')
PY
make -C "$common" ARCH=x86_64 O="$kernel/out-next" LLVM="$kernel/clang/bin/" olddefconfig
recipe=$(cat "$0" "$patch" | sha256sum | cut -d ' ' -f 1)
if [[ $(cat "$kernel/next-recipe.sha256" 2>/dev/null || true) != "$recipe" ]]; then
 make -C "$common" ARCH=x86_64 O="$kernel/out-next" LLVM="$kernel/clang/bin/" clean
fi
make -C "$common" ARCH=x86_64 O="$kernel/out-next" LLVM="$kernel/clang/bin/" \
 KERNELRELEASE=6.12.74-android16-6-g3ec022196c4e-ab15076761 KBUILD_GENDWARFKSYMS_STABLE=1 \
 -j"${CANOE_E2E_KERNEL_JOBS:-8}" bzImage
sha256sum "$kernel/out-next/arch/x86/boot/bzImage" "$kernel/out-next/.config" > "$kernel/next-build.sha256"
printf '%s\n' "$recipe" > "$kernel/next-recipe.sha256"
printf 'kernel=%s\nkernelsu-next=%s\n' "$android_revision" "$revision" > "$kernel/next-revisions.txt"

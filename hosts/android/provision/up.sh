#!/usr/bin/env bash
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
state=${CANOE_E2E_STATE:-$HOME/.local/share/canoe-e2e}/android
image=us-docker.pkg.dev/android-cuttlefish-artifacts/cuttlefish-orchestration/cuttlefish-orchestration@sha256:ecdb337615c719ed62e12593f7931a313d7c15a99a919e69fd87510e14a249e6
container=canoe-e2e-android
serial=127.0.0.1:6520
[ "${CANOE_E2E_ANDROID_SERIAL:-$serial}" = "$serial" ] || { echo 'Managed provisioning uses 127.0.0.1:6520; custom endpoints support attach/run only' >&2; exit 1; }
adb_bin=${ADB:-adb}
mkdir -p "$state/cvd" "$state/cvd-runtime"
docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image"
if [ ! -f "$state/cvd/boot.img" ]; then
  docker run --rm --user "$(id -u):$(id -g)" --volume "$state:/state" \
    --entrypoint /usr/bin/fetch_cvd "$image" --target_directory=/state/cvd \
    --default_build=16102939/aosp_cf_x86_64_only_phone-userdebug --enable_caching=false
fi
variant=${CANOE_E2E_ANDROID_MANAGER:-standard}
case "$variant" in
  standard)
    recipe=$(sha256sum "$here/build-kernel.sh" | cut -d ' ' -f 1)
    manifest=$state/kernel/build.sha256
    stamp=$state/kernel/recipe.sha256
    build_script=$here/build-kernel.sh
    kernel_path=/state/kernel/out/arch/x86/boot/bzImage
    cmdline=
    apk=$state/KernelSU-v3.3.0.apk
    apk_url=https://github.com/tiann/KernelSU/releases/download/v3.3.0/KernelSU_v3.3.0_32601-release.apk
    apk_sha=c197060ecb89702e7d54a4c95e29cf5e8d97369bbbb436979ab7fd6bcde7b077
    version=32601
    ;;
  next)
    recipe=$(cat "$here/build-next-kernel.sh" "$here/patches/next-x86-dispatcher.patch" | sha256sum | cut -d ' ' -f 1)
    manifest=$state/kernel/next-build.sha256
    stamp=$state/kernel/next-recipe.sha256
    build_script=$here/build-next-kernel.sh
    kernel_path=/state/kernel/out-next/arch/x86/boot/bzImage
    # Upstream Next requires its indirect dispatcher in this test-only guest.
    cmdline=syscall_hardening=off
    apk=$state/KernelSU-Next-v3.3.0.apk
    apk_url=https://github.com/KernelSU-Next/KernelSU-Next/releases/download/v3.3.0/KernelSU_Next_v3.3.0_33214-release.apk
    apk_sha=fd0b12385c98fe9d5f4f1257b5f184e55c74c1376637507df0718305f5d7a924
    version=33214
    ;;
  *) echo 'Android manager/kernel must be standard or next' >&2; exit 1 ;;
esac
if [ ! -f "$manifest" ] || ! sha256sum -c "$manifest" >/dev/null 2>&1 ||
   [ "$(cat "$stamp" 2>/dev/null || true)" != "$recipe" ]; then
  bash "$build_script"
fi
if docker inspect "$container" >/dev/null 2>&1; then
  # The selected container must already belong to this state directory.
  actual=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/state"}}{{.Source}}{{end}}{{end}}' "$container")
  [ "$actual" = "$(realpath "$state")" ] || { echo "Container $container belongs to another workspace" >&2; exit 1; }
  docker start "$container" >/dev/null
else
  docker run -d --name "$container" --label canoe.e2e=android \
    --device /dev/kvm --device /dev/net/tun --device /dev/vhost-vsock \
    --cap-add NET_ADMIN --security-opt seccomp=unconfined \
    --volume "$state:/state" --volume "$state/cvd-runtime:/var/tmp/cvd" \
    --publish 127.0.0.1:6520:6520 --publish 127.0.0.1:8443:1443 "$image"
fi
"$adb_bin" connect "$serial" >/dev/null 2>&1 || true
changed=false
if ! cmp -s "$manifest" "$state/running-kernel.sha256" || \
   ! "$adb_bin" -s "$serial" shell 'test -d /sys/module/kernelsu' 2>/dev/null; then
  changed=true
  # Only this dedicated container's groups are visible here.
  docker exec "$container" cvd fleet > "$state/fleet.json"
  count=$(python3 - "$state/fleet.json" <<'PY'
import json, sys
print(len(json.load(open(sys.argv[1]))['groups']))
PY
)
  if [ "$count" = 0 ]; then
    docker exec "$container" cvd create --group_name=canoe --host_path=/state/cvd --product_path=/state/cvd --kernel_path="$kernel_path" --extra_kernel_cmdline="$cmdline" --report_anonymous_usage_stats=n --gpu_mode=guest_swiftshader --cpus=4 --memory_mb=4096
  elif [ "$count" = 1 ]; then
    active=$(python3 - "$state/fleet.json" <<'PY'
import json, sys
print(int(any(i['status'] != 'Stopped' for g in json.load(open(sys.argv[1]))['groups'] for i in g['instances'])))
PY
)
    if [ "$active" = 1 ]; then docker exec "$container" cvd stop; fi
    docker exec "$container" cvd start --kernel_path="$kernel_path" --extra_kernel_cmdline="$cmdline"
  else
    echo 'Expected one dedicated Cuttlefish group' >&2; exit 1
  fi
fi
wait_boot() {
  for attempt in $(seq 1 180); do
    if [ "$("$adb_bin" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then return; fi
    sleep 1
  done
  echo 'Android did not finish booting' >&2; exit 1
}
wait_boot

[ "$("$adb_bin" -s "$serial" shell getprop ro.product.device | tr -d '\r')" = vsoc_x86_64_only ]
if [ ! -f "$apk" ]; then
  curl -fL --retry 3 "$apk_url" -o "$apk.partial"
  mv "$apk.partial" "$apk"
fi
printf '%s  %s\n' "$apk_sha" "$apk" | sha256sum -c -
"$adb_bin" -s "$serial" install -r "$apk"
if [ "$changed" = true ] || ! "$adb_bin" -s "$serial" shell 'su -c "test -x /data/adb/ksud"' 2>/dev/null; then
  # Bootstrap userspace through the userdebug image's adb root once. Runtime
  # operations subsequently use KSU from an ordinary uid=2000 shell.
  unzip -p "$apk" lib/x86_64/libksud.so > "$state/ksud"
  "$adb_bin" -s "$serial" root
  "$adb_bin" -s "$serial" wait-for-device
  "$adb_bin" -s "$serial" push "$state/ksud" /data/local/tmp/ksud
  "$adb_bin" -s "$serial" shell 'chmod 0755 /data/local/tmp/ksud; /data/local/tmp/ksud install'
  "$adb_bin" -s "$serial" reboot
  sleep 2
  wait_boot
fi
"$adb_bin" -s "$serial" unroot
"$adb_bin" -s "$serial" wait-for-device
actual_version=$("$adb_bin" -s "$serial" shell 'su -c "/data/adb/ksud debug version"' | tr -d '\r')
[[ "$actual_version" == *"$version"* ]] || { echo "Expected $variant kernel $version, got $actual_version" >&2; exit 1; }
if [ "$variant" = next ]; then
  "$adb_bin" -s "$serial" shell 'cat /sys/devices/system/cpu/syscall_hardening' | grep -q 'Disabled'
fi
cp "$manifest" "$state/running-kernel.sha256"
printf '%s\n' "$variant" > "$state/running-variant"

# Application module staging and installation belong to the consumer profile.

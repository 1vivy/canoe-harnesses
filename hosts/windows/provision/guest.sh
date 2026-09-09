#!/usr/bin/env bash
# Control channel to the Windows guest: `guest.sh ssh CMD`, `guest.sh ps FILE.ps1 [ARGS...]`,
# `guest.sh put SRC DST` (DST in C:/... form), `guest.sh get SRC DST`.
set -euo pipefail
state=${CANOE_E2E_STATE:-$HOME/.local/share/canoe-e2e}/windows
key=$state/id_ed25519
port=${CANOE_E2E_WIN_SSH_PORT:-2222}
opts=(-i "$key" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes -o ConnectTimeout=15)
case "${1:-}" in
  ssh) shift; exec ssh "${opts[@]}" -p "$port" canoe@127.0.0.1 "$@" ;;
  ps)
    script=$2; shift 2
    name=$(basename "$script")
    scp -q "${opts[@]}" -P "$port" "$script" "canoe@127.0.0.1:C:/canoe/$name"
    exec ssh "${opts[@]}" -p "$port" canoe@127.0.0.1 "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\canoe\\$name $*" ;;
  put) exec scp -q "${opts[@]}" -P "$port" -r "$2" "canoe@127.0.0.1:$3" ;;
  get) exec scp -q "${opts[@]}" -P "$port" -r "canoe@127.0.0.1:$2" "$3" ;;
  *) echo "usage: $0 ssh CMD | ps FILE.ps1 [ARGS] | put SRC DST | get SRC DST" >&2; exit 2 ;;
esac

#!/usr/bin/env bash
# Thin control channel to the Linux guest: `guest.sh ssh CMD...`, `guest.sh sync SRC DST`.
set -euo pipefail
state=${CANOE_E2E_STATE:-$HOME/.local/share/canoe-e2e}/linux
ip=$(cat "$state/ip")
key=$state/id_ed25519
opts=(-i "$key" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes -o ConnectTimeout=15)
case "${1:-}" in
  ssh) shift; exec ssh "${opts[@]}" "canoe@$ip" "$@" ;;
  sync) exec rsync -a --delete -e "ssh ${opts[*]}" "$2" "canoe@$ip:$3" ;;
  ip) echo "$ip" ;;
  *) echo "usage: $0 ssh CMD... | sync SRC DST | ip" >&2; exit 2 ;;
esac

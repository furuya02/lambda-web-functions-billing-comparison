#!/bin/bash
# バーストの負荷。作った直後 → 一度動かした後 → 3 分おきに 5 回、の順にかける。段階の間は GAP 秒空ける
# 使い方: scripts/run-burst.sh <URL> <名前の接頭辞> [GAP 秒=900]
set -eu
URL=$1; PREFIX=$2; GAP=${3:-900}
L() { echo "$(date -u +%FT%TZ) $*"; }
run() { L "start $1"; node scripts/load.mjs --url "$URL" --name "$PREFIX-$1" "${@:2}" | grep -v '^\[' ; L "end $1"; }
gap() { L "gap ${GAP}s"; sleep "$GAP"; }

run burst-fresh  --concurrency 300 --ms 3000 --rounds 1
gap
run burst-warm   --concurrency 300 --ms 3000 --rounds 1
gap
run burst-every3 --concurrency 300 --ms 3000 --rounds 5 --interval 180000
gap
L "all done"

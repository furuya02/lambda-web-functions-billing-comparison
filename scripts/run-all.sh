#!/bin/bash
# 全パターンを順番にかける。パターンの間は GAP 秒空けて、Web Functions の実行環境がゼロに戻るのを待つ
# 使い方: scripts/run-all.sh <URL> <名前の接頭辞> [GAP 秒=600] [MEM=1]
set -eu
URL=$1; PREFIX=$2; GAP=${3:-600}; MEM=${4:-1}
L() { echo "$(date -u +%FT%TZ) $*"; }
run() { L "start $1"; node scripts/load.mjs --url "$URL" --name "$PREFIX-$1" "${@:2}" | grep -v '^\[' ; L "end $1"; }
gap() { L "gap ${GAP}s"; sleep "$GAP"; }

run serial  --concurrency 1  --ms 5000  --rounds 60
gap
run c10-1s  --concurrency 10 --ms 1000  --rounds 10
run c10-5s  --concurrency 10 --ms 5000  --rounds 10
run c10-20s --concurrency 10 --ms 20000 --rounds 5
gap
run c64-5s  --concurrency 64 --ms 5000  --rounds 10
gap
if [ "$MEM" = "1" ]; then
  run mem-1000mb --concurrency 1 --ms 5000 --rounds 10 --mb 1000
  gap
fi
run sparse  --concurrency 1  --ms 5000  --rounds 15 --interval 120000
L "all done"

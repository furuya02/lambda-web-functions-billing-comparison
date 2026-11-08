#!/bin/bash
# Web Functions の実行環境ごとの存在時間・リクエスト数・CPU・ピークメモリを、ログ（platform.invokeReport）から一覧にする
# 使い方: scripts/envreport.sh <開始 ISO8601 UTC> [終了 ISO8601 UTC=今]
set -eu
START=$1; END=${2:-$(date -u +%FT%TZ)}
REGION=${AWS_REGION:-ap-northeast-1}
LG="/aws/lambda/web/lambda-web-functions-billing-comparison.local"
to_ms() { echo $(( $(date -u -j -f %Y-%m-%dT%H:%M:%SZ "$1" +%s) * 1000 )); }
aws logs filter-log-events --region "$REGION" --log-group-name "$LG" --start-time "$(to_ms "$START")" --end-time "$(to_ms "$END")" \
  --filter-pattern '{ $.type = "platform.initReport" || $.type = "platform.invokeReport" }' \
  --query 'events[].message' --output json 2>/dev/null \
| python3 -c '
import sys, json
evs = [json.loads(m) for m in json.load(sys.stdin)]
init = {e["record"]["instanceId"]: e for e in evs if e["type"] == "platform.initReport"}
rows = []
for e in evs:
    if e["type"] != "platform.invokeReport": continue
    r = e["record"]; m = r["metrics"]; iid = r["instanceId"]
    im = init.get(iid, {}).get("record", {}).get("metrics", {})
    rows.append((init.get(iid, {}).get("timestamp", "?")[:19], e["timestamp"][:19], iid[:8], m["totalDurationMs"]/1000, m["totalRequests"], m["totalCpuTimeMs"]/1000, m["maxMemoryUsageMb"], im.get("totalDurationMs"), im.get("totalCpuTimeMs")))
rows.sort()
print("init(UTC)            report(UTC)          env      active_s requests cpu_s  peakMB  init_ms init_cpu_ms")
ta=tc=0; gp=g2=0
for r in rows:
    print(f"{r[0]:20} {r[1]:20} {r[2]:8} {r[3]:8.1f} {r[4]:8d} {r[5]:6.2f} {r[6]:6d}  {r[7]!s:7} {r[8]!s}")
    ta += r[3]; tc += r[5]; gp += r[3]*r[6]/1024; g2 += r[3]*2
print(f"TOTAL envs={len(rows)} active_s={ta:.1f} cpu_s={tc:.2f} GB-s(peak)={gp:.1f} GB-s(2GB)={g2:.1f}")
'

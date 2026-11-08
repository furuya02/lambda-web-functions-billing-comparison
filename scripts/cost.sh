#!/bin/bash
# Cost Explorer から Lambda の使用量と金額を usageType 別に取る（読み取りのみ。反映は翌日以降）
# 使い方: scripts/cost.sh <開始日 YYYY-MM-DD> <終了日 YYYY-MM-DD（この日は含まない）>
set -eu
START=$1; END=$2
aws ce get-cost-and-usage --region us-east-1 \
  --time-period Start="$START",End="$END" --granularity DAILY \
  --metrics UsageQuantity UnblendedCost \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["AWS Lambda"]}}' \
  --group-by Type=DIMENSION,Key=USAGE_TYPE \
  --query 'ResultsByTime[].{date:TimePeriod.Start,groups:Groups[].{usageType:Keys[0],usage:Metrics.UsageQuantity.Amount,usd:Metrics.UnblendedCost.Amount}}' \
  --output json

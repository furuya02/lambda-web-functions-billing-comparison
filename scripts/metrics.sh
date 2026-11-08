#!/bin/bash
# CloudWatch から課金の試算に使うメトリクスを取る（読み取りのみ）
# 使い方: scripts/metrics.sh <開始 ISO8601 UTC> <終了 ISO8601 UTC>
#   例: scripts/metrics.sh 2026-10-17T00:00:00Z 2026-10-17T03:00:00Z
set -eu
START=$1; END=$2
REGION=${AWS_REGION:-ap-northeast-1}
PROJECT=lambda-web-functions-billing-comparison
PERIOD=60

get() { # namespace metric stat dimensions...
  local ns=$1 metric=$2 stat=$3; shift 3
  aws cloudwatch get-metric-statistics --region "$REGION" --namespace "$ns" --metric-name "$metric" \
    --start-time "$START" --end-time "$END" --period $PERIOD --statistics "$stat" --dimensions "$@" \
    --query "sort_by(Datapoints,&Timestamp)[].[Timestamp,$stat]" --output text
}
total() { awk '{s+=$2} END {printf "%.0f\n", s}'; }
max() { awk 'BEGIN{m=0} {if($2>m)m=$2} END {print m}'; }

echo "== B: Web Functions ($PROJECT) =="
echo "EnvironmentActiveTime(ms) Sum: $(get AWS/Lambda/Web EnvironmentActiveTime Sum Name=FunctionName,Value=$PROJECT | total)"
echo "EnvironmentCPUTime(ms)    Sum: $(get AWS/Lambda/Web EnvironmentCPUTime Sum Name=FunctionName,Value=$PROJECT | total)"
echo "EnvironmentMaxMemoryUsage(MB) Max: $(get AWS/Lambda/Web EnvironmentMaxMemoryUsage Maximum Name=FunctionName,Value=$PROJECT | max)"
echo "EnvironmentConcurrentRequests Max: $(get AWS/Lambda/Web EnvironmentConcurrentRequests Maximum Name=FunctionName,Value=$PROJECT | max)"
echo "ExecutedRequests Sum: $(get AWS/Lambda/Web ExecutedRequests Sum Name=FunctionName,Value=$PROJECT Name=EndpointName,Value=prod | total)"
echo "EndpointActiveEnvironments Max: $(get AWS/Lambda/Web/Usage EndpointActiveEnvironments Maximum Name=FunctionName,Value=$PROJECT Name=EndpointName,Value=prod Name=ExecutionRegion,Value=$REGION | max)"

for MB in 512 2048; do
  FN=$PROJECT-${MB}mb
  echo "== A: 従来 Lambda ($FN) =="
  echo "Invocations Sum: $(get AWS/Lambda Invocations Sum Name=FunctionName,Value=$FN | total)"
  echo "Duration(ms) Sum: $(get AWS/Lambda Duration Sum Name=FunctionName,Value=$FN | total)"
  echo "ConcurrentExecutions Max: $(get AWS/Lambda ConcurrentExecutions Maximum Name=FunctionName,Value=$FN | max)"
done

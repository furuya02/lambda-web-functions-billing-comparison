# lambda-web-functions-billing-comparison

Deploys the same Hono app to AWS Lambda Web Functions and to classic Lambda (Lambda Web Adapter + Function URL, 512 MB / 2048 MB), then applies identical wait-time load to compare billing.

- `GET /wait?ms=N` waits N ms and returns `{ms, env, rss}`
- `GET /wait?ms=N&mb=M` additionally holds an M MB Buffer while waiting

## Architecture

| | Type | Entry point |
|---|---|---|
| Web Functions | CfnWebFunction / Revision / Endpoint (HomeRegion, no auth, maxEnvironments 4) | Endpoint URL |
| Classic 512 MB | nodejs24.x / Arm64 + LambdaAdapterLayerArm64:30 | Function URL (no auth) |
| Classic 2048 MB | same | Function URL (no auth) |

## Setup

```bash
$ git clone https://github.com/furuya02/lambda-web-functions-billing-comparison.git
$ cd lambda-web-functions-billing-comparison

# Build the app (app/dist contains index.js and run.sh)
$ cd app && pnpm install && pnpm build && cd ..

# Deploy (S3 bucket suffix defaults to the account ID; override with -c bucket_suffix=xxx)
$ cd cdk && pnpm install && pnpm cdk deploy --outputs-file outputs.json && cd ..
```

The outputs `WebUrl` / `Url512` / `Url2048` are the three entry points.

## Verify

```bash
$ curl "https://<WebUrl>/wait?ms=1000"
# => {"ms":1000,"mb":0,"env":"e838c6be","rss":68,"heldMb":0}
```

## Load and aggregation

```bash
# All patterns (serial -> concurrency 10 -> concurrency 64 -> memory hold -> sparse), 600 s gap between patterns
$ caffeinate -i scripts/run-all.sh <WebUrl> web
$ caffeinate -i scripts/run-all.sh <Url512> m512 600 0   # skip memory hold for 512 MB
$ caffeinate -i scripts/run-all.sh <Url2048> m2048

# Burst (300 requests x 3 s: right after creation -> 15 min later -> 5 times every 3 min). Run right after redeploying with a higher maxEnvironments
# pnpm cdk deploy -c max_env=150 --outputs-file outputs.json (in the cdk directory)
$ caffeinate -i scripts/run-burst.sh <WebUrl> web
$ caffeinate -i scripts/run-burst.sh <Url512> a512

# Estimate from CloudWatch for each results/*.json window
$ node scripts/estimate.mjs

# Per-environment initReport / invokeReport of the Web Function
$ scripts/envreport.sh 2026-10-16T13:00:00Z

# Cost Explorer by usageType (next day or later)
$ scripts/cost.sh 2026-10-16 2026-10-17
```

## Cleanup

The endpoint and Function URLs have no authentication. Anyone who knows the URL can call them (and make them allocate large memory with the mb parameter), so destroy the stack as soon as you finish measuring.

```bash
$ cd cdk && pnpm cdk destroy
```

Log groups (`/aws/lambda/web/<name>`, `.local`, and the two classic ones) and the S3 bucket are removed with the stack.

## License

MIT

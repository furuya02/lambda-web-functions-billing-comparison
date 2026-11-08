# lambda-web-functions-billing-comparison

同じ Hono アプリを AWS Lambda Web Functions と従来の Lambda（Lambda Web Adapter + Function URL、512 MB / 2048 MB）に載せ、同じ待ち時間の負荷をかけて課金を比べる検証用リポジトリです。

- `GET /wait?ms=N` … N ミリ秒待って `{ms, env, rss}` を返す
- `GET /wait?ms=N&mb=M` … 待っている間だけ M MB の Buffer を保持する

## 構成

| | 種類 | 入口 |
|---|---|---|
| Web Functions | CfnWebFunction / Revision / Endpoint（HomeRegion、認証なし、maxEnvironments 4） | Endpoint URL |
| 従来 512 MB | nodejs24.x / Arm64 + LambdaAdapterLayerArm64:30 | Function URL（認証なし） |
| 従来 2048 MB | 同上 | Function URL（認証なし） |

## 構築手順

```bash
$ git clone https://github.com/furuya02/lambda-web-functions-billing-comparison.git
$ cd lambda-web-functions-billing-comparison

# アプリをビルド（app/dist に index.js と run.sh）
$ cd app && pnpm install && pnpm build && cd ..

# デプロイ（S3 バケット名のサフィックスは既定でアカウント ID。-c bucket_suffix=xxx で上書き可）
$ cd cdk && pnpm install && pnpm cdk deploy --outputs-file outputs.json && cd ..
```

出力 `WebUrl` / `Url512` / `Url2048` が 3 つの入口です。

## 動作確認

```bash
$ curl "https://<WebUrl>/wait?ms=1000"
# => {"ms":1000,"mb":0,"env":"e838c6be","rss":68,"heldMb":0}
```

## 負荷と集計

```bash
# 全パターン（直列 → 同時 10 → 同時 64 → メモリ保持 → 散発）。パターンの間は 600 秒空ける
$ caffeinate -i scripts/run-all.sh <WebUrl> web
$ caffeinate -i scripts/run-all.sh <Url512> m512 600 0   # 512 MB はメモリ保持を省く
$ caffeinate -i scripts/run-all.sh <Url2048> m2048

# バースト（300 件 × 3 秒。作った直後 → 15 分後 → 3 分おきに 5 回）。maxEnvironments を上げてデプロイし直した直後に流す
# pnpm cdk deploy -c max_env=150 --outputs-file outputs.json（cdk ディレクトリで実行）
$ caffeinate -i scripts/run-burst.sh <WebUrl> web
$ caffeinate -i scripts/run-burst.sh <Url512> a512

# CloudWatch から試算（results/*.json の時間帯ごと）
$ node scripts/estimate.mjs

# Web Functions の実行環境ごとの initReport / invokeReport
$ scripts/envreport.sh 2026-10-16T13:00:00Z

# 翌日以降、Cost Explorer を usageType 別に
$ scripts/cost.sh 2026-10-16 2026-10-17
```

## 後片付け

エンドポイントと Function URL は認証なしです。URL を知っていれば誰でも呼び出せる（mb パラメータで大きなメモリも使わせられる）ので、計測が終わったらすぐ削除してください。

```bash
$ cd cdk && pnpm cdk destroy
```

ロググループ（`/aws/lambda/web/<name>`、`.local`、従来 2 つ）と S3 バケットもスタックと一緒に消えます。

## ライセンス

MIT

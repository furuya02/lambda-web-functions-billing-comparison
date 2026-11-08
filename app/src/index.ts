// 課金比較用の擬似 LLM。指定した時間だけ待って返す（CPU はほとんど使わない）
// 同じ index.js を Lambda Web Functions と 従来の Lambda（Lambda Web Adapter）の両方に載せる
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { randomUUID } from 'node:crypto'

// 実行環境（プロセス）の識別子。起動時に 1 回だけ作るので、同じ環境で処理されたリクエストは同じ値になる
const ENV_ID = randomUUID().slice(0, 8)

const app = new Hono()

app.get('/', (c) => c.text('ok'))

// GET /wait?ms=5000        → 5 秒待って返す
// GET /wait?ms=5000&mb=1000 → 待っている間だけ 1,000 MB の Buffer を保持する（メモリ課金が「消費量」かを確かめる）
app.get('/wait', async (c) => {
  const ms = Number(c.req.query('ms') ?? 0)
  const mb = Number(c.req.query('mb') ?? 0)
  // 1 で埋めて、実際にページを確保させる（確保だけだと物理メモリに乗らない）
  const held = mb > 0 ? Buffer.alloc(mb * 1024 * 1024, 1) : null
  await new Promise((r) => setTimeout(r, ms))
  const rss = Math.round(process.memoryUsage().rss / 1024 / 1024)
  // held を参照して、待ちが終わるまで GC されないようにする
  return c.json({ ms, mb, env: ENV_ID, rss, heldMb: held ? held.length / 1024 / 1024 : 0 })
})

// Web Functions は AWS_LAMBDA_HTTP_ENDPOINT（host:port）で待ち受け先を渡してくる
// 従来の Lambda（Lambda Web Adapter）では無いので、AWS_LWA_PORT（既定 8080）で待つ。ローカルも同じ
const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT
const [hostname, port] = endpoint ? endpoint.split(':') : ['0.0.0.0', process.env.AWS_LWA_PORT ?? process.env.PORT ?? '8080']
serve({ fetch: app.fetch, hostname, port: Number(port) }, () => console.log(`listening on ${hostname}:${port} env=${ENV_ID}`))

// 負荷スクリプト。同じパターンを Web Functions と 従来の Lambda に順番にかける
// 例: node scripts/load.mjs --url https://xxx/ --name serial --concurrency 1 --ms 5000 --rounds 60
//     node scripts/load.mjs --url https://xxx/ --name sparse --concurrency 1 --ms 5000 --rounds 15 --interval 120000
//     node scripts/load.mjs --url https://xxx/ --name mem    --concurrency 1 --ms 5000 --rounds 10 --mb 1000
import { mkdirSync, writeFileSync } from 'node:fs'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i >= 0 ? process.argv[i + 1] : d
}
const url = arg('url')
const name = arg('name', 'run')
const concurrency = Number(arg('concurrency', 1))
const ms = Number(arg('ms', 5000))
const mb = Number(arg('mb', 0))
const rounds = Number(arg('rounds', 1))
const interval = Number(arg('interval', 0)) // ラウンド開始の間隔（ms）。0 なら前のラウンドが終わり次第
if (!url) throw new Error('--url が必要です')

const sleep = (t) => new Promise((r) => setTimeout(r, t))
const results = []

const one = async (round, i) => {
  const start = Date.now()
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/wait?ms=${ms}&mb=${mb}`)
    const body = res.ok ? await res.json() : { error: await res.text() }
    results.push({
      round, i, start, end: Date.now(), status: res.status,
      env: body.env, rss: body.rss,
      logstream: res.headers.get('lambda-web-logstream'), // Web Functions のみ
      errorType: res.headers.get('lambda-web-error-type'),
    })
  } catch (e) {
    results.push({ round, i, start, end: Date.now(), status: 0, error: String(e) })
  }
}

const began = Date.now()
for (let r = 0; r < rounds; r++) {
  const roundStart = Date.now()
  await Promise.all(Array.from({ length: concurrency }, (_, i) => one(r, i)))
  const envs = new Set(results.filter((x) => x.round === r).map((x) => x.env))
  const codes = results.filter((x) => x.round === r).map((x) => x.status)
  console.log(`[${name}] round ${r + 1}/${rounds} ${Date.now() - roundStart} ms envs=${envs.size} status=${[...new Set(codes)].join(',')}`)
  if (interval > 0 && r < rounds - 1) await sleep(Math.max(0, interval - (Date.now() - roundStart)))
}

const summary = {
  name, url, concurrency, ms, mb, rounds, interval,
  began: new Date(began).toISOString(), ended: new Date().toISOString(),
  requests: results.length,
  ok: results.filter((x) => x.status === 200).length,
  envs: [...new Set(results.map((x) => x.env).filter(Boolean))],
}
mkdirSync('results', { recursive: true })
const file = `results/${name}_${summary.began.replace(/[:.]/g, '-')}.json`
writeFileSync(file, JSON.stringify({ summary, results }, null, 2))
console.log(JSON.stringify(summary, null, 2))
console.log(`saved: ${file}`)

// results/*.json の各パターンについて、CloudWatch のメトリクスから課金を試算する（読み取りのみ）
// 使い方: node scripts/estimate.mjs [--pad-min 8]
//   Web Functions はパターン終了後 spinDown までのアイドル分を含めるため、終了時刻の後ろに pad-min 分を足して集計する
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

const PROJECT = 'lambda-web-functions-billing-comparison'
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1'
const padMin = Number(process.argv.includes('--pad-min') ? process.argv[process.argv.indexOf('--pad-min') + 1] : 8)

// 東京・Arm の単価（2026/10/16 Price List API）
const P = {
  webReq: 0.0000003, webCpu: 0.0000322421, webMem: 0.0000042688, // /件, /vCPU-秒, /GB-秒
  evReq: 0.0000002, evGbs: 0.0000133334,
}

const cw = (ns, metric, stat, dims, start, end) => {
  const out = execFileSync('aws', [
    'cloudwatch', 'get-metric-statistics', '--region', REGION, '--namespace', ns, '--metric-name', metric,
    '--start-time', start, '--end-time', end, '--period', '60', '--statistics', stat,
    '--dimensions', ...dims, '--query', `Datapoints[].${stat}`, '--output', 'json',
  ]).toString()
  const v = JSON.parse(out)
  return stat === 'Maximum' ? Math.max(0, ...v) : v.reduce((a, b) => a + b, 0)
}

const floorMin = (t) => new Date(Math.floor(t / 60000) * 60000).toISOString()
const files = readdirSync('results').filter((f) => f.endsWith('.json')).sort()
const rows = []
for (const f of files) {
  const { summary: s } = JSON.parse(readFileSync(`results/${f}`))
  const start = floorMin(Date.parse(s.began) - 60000)
  const end = floorMin(Date.parse(s.ended) + (s.name.startsWith('web') ? padMin : 1) * 60000 + 60000)
  const row = { name: s.name, requests: s.requests, ok: s.ok, envs: s.envs.length, start, end }
  if (s.name.startsWith('web')) {
    const fd = [`Name=FunctionName,Value=${PROJECT}`]
    const active = cw('AWS/Lambda/Web', 'EnvironmentActiveTime', 'Sum', fd, start, end)
    const cpu = cw('AWS/Lambda/Web', 'EnvironmentCPUTime', 'Sum', fd, start, end)
    const maxMem = cw('AWS/Lambda/Web', 'EnvironmentMaxMemoryUsage', 'Maximum', fd, start, end)
    const maxEnv = cw('AWS/Lambda/Web/Usage', 'EndpointActiveEnvironments', 'Maximum', [...fd, 'Name=EndpointName,Value=prod', `Name=ExecutionRegion,Value=${REGION}`], start, end)
    const maxConc = cw('AWS/Lambda/Web', 'EnvironmentConcurrentRequests', 'Maximum', fd, start, end)
    const activeS = active / 1000, cpuS = cpu / 1000
    Object.assign(row, {
      activeS: activeS.toFixed(1), cpuS: cpuS.toFixed(2), maxMemMb: maxMem, maxEnv, maxConc,
      gbsPeak: (activeS * maxMem / 1024).toFixed(1), gbs2GB: (activeS * 2).toFixed(1),
      usdReq: (s.requests * P.webReq).toFixed(6), usdCpu: (cpuS * P.webCpu).toFixed(6),
      usdMemPeak: (activeS * maxMem / 1024 * P.webMem).toFixed(6), usdMem2GB: (activeS * 2 * P.webMem).toFixed(6),
    })
    row.usdTotalPeak = (Number(row.usdReq) + Number(row.usdCpu) + Number(row.usdMemPeak)).toFixed(6)
  } else {
    const mb = s.name.startsWith('a512') ? 512 : 2048
    const fd = [`Name=FunctionName,Value=${PROJECT}-${mb}mb`]
    const dur = cw('AWS/Lambda', 'Duration', 'Sum', fd, start, end)
    const inv = cw('AWS/Lambda', 'Invocations', 'Sum', fd, start, end)
    const conc = cw('AWS/Lambda', 'ConcurrentExecutions', 'Maximum', fd, start, end)
    const gbs = dur / 1000 * mb / 1024
    Object.assign(row, {
      invocations: inv, durationS: (dur / 1000).toFixed(1), maxConc: conc, gbs: gbs.toFixed(1),
      usdReq: (inv * P.evReq).toFixed(6), usdGbs: (gbs * P.evGbs).toFixed(6),
    })
    row.usdTotal = (Number(row.usdReq) + Number(row.usdGbs)).toFixed(6)
  }
  rows.push(row)
  console.log(JSON.stringify(row))
}

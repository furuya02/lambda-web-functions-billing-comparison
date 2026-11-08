import { App } from 'aws-cdk-lib'
import { BillingComparisonStack } from '../lib/stack'

const app = new App()
// Web Functions が使えるリージョン（東京）にデプロイする
new BillingComparisonStack(app, 'LambdaWebFunctionsBillingComparison', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-northeast-1' },
})

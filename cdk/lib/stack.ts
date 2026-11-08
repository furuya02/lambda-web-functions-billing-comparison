// 同じ Hono アプリ（app/dist）を 3 つの Lambda に載せ、同じ負荷をかけて課金を比べるスタック
//   B: Lambda Web Functions（L1: CfnWebFunction / CfnWebFunctionRevision / CfnWebFunctionEndpoint）
//   A: 従来の Lambda（Lambda Web Adapter + Function URL）× 2（メモリ 512 MB / 2048 MB）
import * as path from 'node:path'
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, StackProps, Tags } from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import { Construct } from 'constructs'

const PROJECT = 'lambda-web-functions-billing-comparison'
const DIST = path.join(__dirname, '../../app/dist')
// Lambda Web Adapter のレイヤー（Arm64）。バージョンは -c lwa_layer_version=NN で変えられる
const LWA_ACCOUNT = '753240598075'

export class BillingComparisonStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    // Cost Explorer でこのスタックの分だけを見られるようにタグを付ける（コスト配分タグの有効化が必要）
    Tags.of(this).add('Project', PROJECT)

    const suffix = this.node.tryGetContext('bucket_suffix') ?? this.account
    const lwaLayerVersion = this.node.tryGetContext('lwa_layer_version') ?? '30'
    // ロググループは検証後に消し忘れないよう CDK で作り、保持期間も付ける
    const retention = logs.RetentionDays.ONE_WEEK

    // ---------- B: Lambda Web Functions ----------

    // Web Functions はコードを S3 の .zip から読み、バージョニングが必須
    const bucket = new s3.Bucket(this, 'CodeBucket', {
      bucketName: `${PROJECT}-${suffix}`,
      versioned: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })
    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal('lambda.amazonaws.com')],
        actions: ['s3:GetObject', 's3:GetObjectVersion'],
        resources: [bucket.arnForObjects('*')],
        conditions: {
          ArnLike: { 'aws:SourceArn': `arn:aws:lambda:${this.region}:${this.account}:web-function/${PROJECT}/revision/*` },
        },
      }),
    )
    const code = new s3deploy.BucketDeployment(this, 'Code', {
      sources: [s3deploy.Source.asset(DIST)],
      destinationBucket: bucket,
      extract: false, // .zip のまま置く
    })

    const webRole = new iam.Role(this, 'WebRole', {
      roleName: `${PROJECT}-web-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    })

    // Web Functions のロググループ（集約先と .local）。Lambda が先に作る前に CDK で作っておく
    const webLogGroup = new logs.LogGroup(this, 'WebLogGroup', {
      logGroupName: `/aws/lambda/web/${PROJECT}`,
      retention,
      removalPolicy: RemovalPolicy.DESTROY,
    })
    const webLocalLogGroup = new logs.LogGroup(this, 'WebLocalLogGroup', {
      logGroupName: `/aws/lambda/web/${PROJECT}.local`,
      retention,
      removalPolicy: RemovalPolicy.DESTROY,
    })

    const webFn = new lambda.CfnWebFunction(this, 'WebFunction', { functionName: PROJECT })
    const revision = new lambda.CfnWebFunctionRevision(this, 'Revision', {
      functionName: webFn.ref,
      buildConfig: {
        runtimeConfig: { runtime: 'nodejs24.x' },
        codeConfig: { s3Object: { bucket: bucket.bucketName, key: Fn.select(0, code.objectKeys) } },
      },
      serviceConfig: {
        executionRoleArn: webRole.roleArn,
        timeoutSeconds: 60, // 待ち時間の最大 20 秒 + 余裕
      },
    })
    revision.node.addDependency(code, bucket.policy!, webLogGroup, webLocalLogGroup)

    const endpoint = new lambda.CfnWebFunctionEndpoint(this, 'Endpoint', {
      functionName: webFn.ref,
      endpointName: 'prod',
      endpointType: 'HomeRegion',
      authType: 'ApplicationManaged', // 認証なし。検証が終わったらすぐ destroy する前提
      revisionWeights: [{ revisionId: revision.attrRevisionId, weight: 100 }],
      scalingConfig: { maxEnvironments: Number(this.node.tryGetContext('max_env') ?? 4) }, // 費用の上限。バーストは -c max_env=150
    })

    // ---------- A: 従来の Lambda（Lambda Web Adapter）× 2 ----------

    const lwaLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'LwaLayer',
      `arn:aws:lambda:${this.region}:${LWA_ACCOUNT}:layer:LambdaAdapterLayerArm64:${lwaLayerVersion}`,
    )

    const makeEventFunction = (memoryMb: number) => {
      const name = `${PROJECT}-${memoryMb}mb`
      const logGroup = new logs.LogGroup(this, `LogGroup${memoryMb}`, {
        logGroupName: `/aws/lambda/${name}`,
        retention,
        removalPolicy: RemovalPolicy.DESTROY,
      })
      const fn = new lambda.Function(this, `EventFunction${memoryMb}`, {
        functionName: name,
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: memoryMb,
        timeout: Duration.seconds(60),
        code: lambda.Code.fromAsset(DIST),
        handler: 'run.sh', // LWA では起動スクリプトの名前を handler に書く
        layers: [lwaLayer],
        logGroup,
        environment: {
          AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap', // LWA を起動する
          AWS_LWA_PORT: '8080',
        },
      })
      const url = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE })
      new CfnOutput(this, `Url${memoryMb}`, { value: url.url })
      return fn
    }
    makeEventFunction(512)
    makeEventFunction(2048)

    new CfnOutput(this, 'WebUrl', { value: `https://${endpoint.attrDomainName}/` })
  }
}

import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import * as path from "path";

export interface TodoAppStackProps extends cdk.StackProps {
  stage: string;
}

export class TodoAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TodoAppStackProps) {
    super(scope, id, props);

    const { stage } = props;

    const apiKeySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ApiKeySecret",
      `todo-app-${stage}-api-key`
    );

    // DynamoDB Table
    const todosTable = new dynamodb.Table(this, "TodosTable", {
      tableName: `todos-${stage}`,
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy:
        stage === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Add GSI for Airtable lookups
    todosTable.addGlobalSecondaryIndex({
      indexName: "airtable-record-index",
      partitionKey: {
        name: "airtableRecordId",
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Common Lambda environment
    const lambdaEnvironment = {
      TODOS_TABLE_NAME: todosTable.tableName,
      STAGE: stage,
      AIRTABLE_API_KEY: process.env.AIRTABLE_API_KEY || "",
      AIRTABLE_BASE_ID: process.env.AIRTABLE_BASE_ID || "",
      AIRTABLE_TABLE_ID: process.env.AIRTABLE_TABLE_ID || "",
    };

    // Common bundling options
    const bundlingOptions: cdk.aws_lambda_nodejs.BundlingOptions = {
      minify: true,
      sourceMap: false,
      target: "es2020",
      format: nodejs.OutputFormat.CJS,
      mainFields: ["main", "module"],
      externalModules: ["aws-sdk"], // AWS SDK is provided by Lambda runtime
    };

    // API Key Authorizer Lambda
    const authorizerLambda = new nodejs.NodejsFunction(
      this,
      "AuthorizerFunction",
      {
        functionName: `todo-app-${stage}-authorizer`,
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, "lambdas/apiKeyAuthorizer/index.ts"),
        handler: "handler",
        environment: {
          API_KEY_SECRET_NAME: apiKeySecret.secretName,
          STAGE: stage,
        },
        timeout: cdk.Duration.seconds(30),
        bundling: bundlingOptions,
      }
    );

    apiKeySecret.grantRead(authorizerLambda);

    // Create Todo Lambda
    const createTodoLambda = new nodejs.NodejsFunction(
      this,
      "CreateTodoFunction",
      {
        functionName: `todo-app-${stage}-createTodo`,
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, "lambdas/createTodo/index.ts"),
        handler: "handler",
        environment: lambdaEnvironment,
        timeout: cdk.Duration.seconds(30),
        bundling: bundlingOptions,
      }
    );

    // Get Todos Lambda
    const getTodosLambda = new nodejs.NodejsFunction(this, "GetTodosFunction", {
      functionName: `todo-app-${stage}-getTodos`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "lambdas/getTodos/index.ts"),
      handler: "handler",
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
      bundling: bundlingOptions,
    });

    // Airtable Webhook Lambda
    const webhookLambda = new nodejs.NodejsFunction(this, "WebhookFunction", {
      functionName: `todo-app-${stage}-webhook`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "lambdas/airtableWebhook/index.ts"),
      handler: "handler",
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
      bundling: bundlingOptions,
    });

    // Grant DynamoDB permissions to all Lambda functions
    todosTable.grantFullAccess(createTodoLambda);
    todosTable.grantFullAccess(getTodosLambda);
    todosTable.grantFullAccess(webhookLambda);

    // Create API Gateway Authorizer
    const authorizer = new apigateway.RequestAuthorizer(
      this,
      "ApiKeyAuthorizer",
      {
        handler: authorizerLambda,
        identitySources: [apigateway.IdentitySource.header("x-api-key")],
        authorizerName: `todo-app-${stage}-authorizer`,
        resultsCacheTtl: cdk.Duration.minutes(5),
      }
    );

    // API Gateway
    const api = new apigateway.RestApi(this, "TodoApi", {
      restApiName: `Todo API ${stage}`,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
        ],
      },
    });

    // API Routes
    const v1 = api.root.addResource("v1");

    v1.addResource("todo").addMethod(
      "POST",
      new apigateway.LambdaIntegration(createTodoLambda),
      {
        authorizer: authorizer,
      }
    );

    v1.addResource("todos").addMethod(
      "GET",
      new apigateway.LambdaIntegration(getTodosLambda),
      {
        authorizer: authorizer,
      }
    );

    v1.addResource("webhook").addMethod(
      "POST",
      new apigateway.LambdaIntegration(webhookLambda)
    );

    // Outputs
    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.url,
      description: "API Gateway URL",
    });

    new cdk.CfnOutput(this, "WebhookUrl", {
      value: `${api.url}v1/webhook`,
      description: "Airtable Webhook URL",
    });

    new cdk.CfnOutput(this, "ApiKeySecretName", {
      value: apiKeySecret.secretName,
      description: "Secret name containing the API key",
    });
  }
}

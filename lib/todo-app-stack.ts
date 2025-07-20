import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export interface TodoAppStackProps extends cdk.StackProps {
  stage: string;
}

export class TodoAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TodoAppStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // DynamoDB Table
    const todosTable = new dynamodb.Table(this, 'TodosTable', {
      tableName: `todos-${stage}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Add GSI for Airtable lookups
    todosTable.addGlobalSecondaryIndex({
      indexName: 'airtable-record-index',
      partitionKey: { name: 'airtableRecordId', type: dynamodb.AttributeType.STRING },
    });

    // Lambda role with DynamoDB permissions
    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['dynamodb:*'],
              resources: [todosTable.tableArn, `${todosTable.tableArn}/index/*`],
            }),
          ],
        }),
      },
    });

    // Common Lambda environment
    const lambdaEnvironment = {
      TODOS_TABLE_NAME: todosTable.tableName,
      STAGE: stage,
      // Airtable config from environment variables
      AIRTABLE_API_KEY: process.env.AIRTABLE_API_KEY || '',
      AIRTABLE_BASE_ID: process.env.AIRTABLE_BASE_ID || '',
      AIRTABLE_TABLE_ID: process.env.AIRTABLE_TABLE_ID || '',
    };

    // Create Todo Lambda
    const createTodoLambda = new lambda.Function(this, 'CreateTodoFunction', {
      functionName: `todo-app-${stage}-createTodo`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambdas/createTodo')),
      role: lambdaRole,
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
    });

    // Get Todos Lambda
    const getTodosLambda = new lambda.Function(this, 'GetTodosFunction', {
      functionName: `todo-app-${stage}-getTodos`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambdas/getTodos')),
      role: lambdaRole,
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
    });

    // Airtable Webhook Lambda
    const webhookLambda = new lambda.Function(this, 'WebhookFunction', {
      functionName: `todo-app-${stage}-webhook`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambdas/airtableWebhook')),
      role: lambdaRole,
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
    });

    // API Gateway
    const api = new apigateway.RestApi(this, 'TodoApi', {
      restApiName: `Todo API ${stage}`,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // API Routes
    const v1 = api.root.addResource('v1');
    v1.addResource('todo').addMethod('POST', new apigateway.LambdaIntegration(createTodoLambda));
    v1.addResource('todos').addMethod('GET', new apigateway.LambdaIntegration(getTodosLambda));
    v1.addResource('webhook').addMethod('POST', new apigateway.LambdaIntegration(webhookLambda));

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
    new cdk.CfnOutput(this, 'WebhookUrl', { value: `${api.url}v1/webhook` });
  }
}
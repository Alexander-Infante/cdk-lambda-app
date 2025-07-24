import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Template } from "aws-cdk-lib/assertions";
import { TodoAppStack } from "../lib/todo-app-stack";

// Mock NodejsFunction to avoid bundling
jest.mock("aws-cdk-lib/aws-lambda-nodejs", () => ({
  NodejsFunction: jest.fn().mockImplementation((scope, id, props) => {
    // Return a regular Function instead
    return new lambda.Function(scope, id, {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromInline("exports.handler = async () => ({})"),
      functionName: props.functionName,
      environment: props.environment,
      timeout: props.timeout,
    });
  }),
  OutputFormat: {
    CJS: "cjs",
  },
}));

describe("TodoAppStack", () => {
  let template: Template;

  beforeEach(() => {
    const app = new cdk.App();
    const stack = new TodoAppStack(app, "TestTodoAppStack", {
      stage: "test",
    });
    template = Template.fromStack(stack);
  });

  it("creates DynamoDB table with correct configuration", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "todos-test",
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "id", AttributeType: "S" },
        { AttributeName: "airtableRecordId", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "airtable-record-index",
          KeySchema: [{ AttributeName: "airtableRecordId", KeyType: "HASH" }],
        },
      ],
    });
  });

  it("creates all four Lambda functions", () => {
    // Count Lambda functions
    template.resourceCountIs("AWS::Lambda::Function", 4);

    // Check specific function names
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "todo-app-test-authorizer",
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "todo-app-test-createTodo",
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "todo-app-test-getTodos",
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "todo-app-test-webhook",
    });
  });

  it("creates API Gateway with correct structure", () => {
    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      Name: "Todo API test",
    });

    // Check for the three main resources: todo, todos, webhook
    template.resourceCountIs("AWS::ApiGateway::Resource", 4); // v1 + 3 endpoints

    // CDK creates OPTIONS methods for CORS + your 3 actual methods = 8 total
    template.resourceCountIs("AWS::ApiGateway::Method", 8);
  });

  it("creates authorizer with correct configuration", () => {
    template.hasResourceProperties("AWS::ApiGateway::Authorizer", {
      Name: "todo-app-test-authorizer",
      Type: "REQUEST",
      IdentitySource: "method.request.header.x-api-key",
      AuthorizerResultTtlInSeconds: 300,
    });
  });

  it("grants correct DynamoDB permissions to Lambda functions", () => {
    // CDK creates 5 roles: 4 Lambda functions + 1 for API Gateway
    template.resourceCountIs("AWS::IAM::Role", 5);

    // Check that DynamoDB permissions are granted (CDK uses dynamodb:*)
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: [
          {
            Effect: "Allow",
            Action: "dynamodb:*",
          },
        ],
      },
    });
  });

  it("grants Secrets Manager read permissions to authorizer", () => {
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "secretsmanager:GetSecretValue",
              "secretsmanager:DescribeSecret",
            ],
          },
        ],
      },
    });
  });

  it("creates stack outputs", () => {
    template.hasOutput("ApiUrl", {});
    template.hasOutput("WebhookUrl", {});
    template.hasOutput("ApiKeySecretName", {});
  });

  it("configures CORS correctly", () => {
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "OPTIONS",
    });
  });
});

describe("TodoAppStack prod configuration", () => {
  it("sets RETAIN policy for prod DynamoDB table", () => {
    const app = new cdk.App();
    const stack = new TodoAppStack(app, "ProdTodoAppStack", {
      stage: "prod",
    });
    const template = Template.fromStack(stack);

    // CDK uses UpdateReplacePolicy, not DeletionPolicy in Properties
    template.hasResource("AWS::DynamoDB::Table", {
      UpdateReplacePolicy: "Retain",
      DeletionPolicy: "Retain",
    });
  });

  it("sets DESTROY policy for non-prod DynamoDB table", () => {
    const app = new cdk.App();
    const stack = new TodoAppStack(app, "DevTodoAppStack", {
      stage: "dev",
    });
    const template = Template.fromStack(stack);

    // CDK uses UpdateReplacePolicy, not DeletionPolicy in Properties
    template.hasResource("AWS::DynamoDB::Table", {
      UpdateReplacePolicy: "Delete",
      DeletionPolicy: "Delete",
    });
  });
});

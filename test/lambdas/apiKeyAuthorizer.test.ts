import { APIGatewayRequestAuthorizerEvent } from "aws-lambda";
import { handler } from "../../lib/lambdas/apiKeyAuthorizer/index";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";

const secretsMock = mockClient(SecretsManagerClient);

describe("apiKeyAuthorizer Lambda", () => {
  const createEvent = (apiKey?: string): APIGatewayRequestAuthorizerEvent => ({
    type: "REQUEST",
    methodArn:
      "arn:aws:execute-api:us-east-1:123456789012:abcdefghij/dev/GET/todos",
    resource: "/todos",
    path: "/todos",
    httpMethod: "GET",
    headers: apiKey ? { "x-api-key": apiKey } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {} as any,
  });

  beforeEach(() => {
    secretsMock.reset();
    process.env.API_KEY_SECRET_NAME = "test-api-key-secret";

    // Clear cache between tests
    jest.clearAllMocks();
  });

  it("allows access with valid API key", async () => {
    secretsMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({ apiKey: "valid-secret-key" }),
    });

    const result = await handler(createEvent("valid-secret-key"));

    expect(result.principalId).toBe("authorized-user");
    expect(result.policyDocument.Statement[0].Effect).toBe("Allow");
  });

  it("denies access with invalid API key", async () => {
    secretsMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({ apiKey: "valid-secret-key" }),
    });

    const result = await handler(createEvent("wrong-key"));

    expect(result.principalId).toBe("unauthorized");
    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
  });

  it("denies access when no API key provided", async () => {
    const result = await handler(createEvent());

    expect(result.principalId).toBe("unauthorized");
    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");

    // Should not call Secrets Manager
    expect(secretsMock.commandCalls(GetSecretValueCommand)).toHaveLength(0);
  });

  it("handles case-insensitive header names", async () => {
    secretsMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({ apiKey: "valid-secret-key" }),
    });

    const event = createEvent();
    event.headers = { "X-API-Key": "valid-secret-key" }; // Capital letters

    const result = await handler(event);

    expect(result.principalId).toBe("authorized-user");
    expect(result.policyDocument.Statement[0].Effect).toBe("Allow");
  });

  it("denies access when Secrets Manager fails", async () => {
    secretsMock
      .on(GetSecretValueCommand)
      .rejects(new Error("Secrets Manager error"));

    const result = await handler(createEvent("any-key"));

    expect(result.principalId).toBe("unauthorized");
    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
  });

  it("denies access when secret has no apiKey field", async () => {
    secretsMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({ otherField: "value" }), // Missing apiKey
    });

    const result = await handler(createEvent("any-key"));

    expect(result.principalId).toBe("unauthorized");
    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
  });

  it("denies access when API_KEY_SECRET_NAME not set", async () => {
    delete process.env.API_KEY_SECRET_NAME;

    const result = await handler(createEvent("any-key"));

    expect(result.principalId).toBe("unauthorized");
    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");

    // Should not call Secrets Manager
    expect(secretsMock.commandCalls(GetSecretValueCommand)).toHaveLength(0);
  });
});

import { APIGatewayProxyEvent } from "aws-lambda";
import { handler } from "../../lib/lambdas/createTodo/index";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const ddbMock = mockClient(DynamoDBDocumentClient);
global.fetch = jest.fn();
jest.mock("uuid", () => ({ v4: jest.fn(() => "test-uuid") }));

describe("createTodo Lambda", () => {

  const createEvent = (body: any): APIGatewayProxyEvent => ({
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/v1/todo",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: "",
  });

  beforeEach(() => {
    ddbMock.reset();
    (fetch as jest.Mock).mockReset();
    process.env.TODOS_TABLE_NAME = "test-table";
    process.env.AIRTABLE_API_KEY = ""; // Disable Airtable
  });

  it("creates a todo successfully", async () => {
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(createEvent({ title: "Test Todo" }));

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body).todo.title).toBe("Test Todo");
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });

  it("returns 400 when title is missing", async () => {
    const result = await handler(createEvent({}));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe("Title is required");
  });

  it("returns 500 when DynamoDB fails", async () => {
    ddbMock.on(PutCommand).rejects(new Error("DB error"));

    const result = await handler(createEvent({ title: "Test" }));

    expect(result.statusCode).toBe(500);
  });
});

import { APIGatewayProxyEvent } from "aws-lambda";
import { handler } from "../../lib/lambdas/getTodos/index";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const ddbMock = mockClient(DynamoDBDocumentClient);

describe("getTodos Lambda", () => {
  const createEvent = (): APIGatewayProxyEvent => ({
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/v1/todos",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: "",
  });

  beforeEach(() => {
    ddbMock.reset();
    process.env.TODOS_TABLE_NAME = "test-table";
    process.env.STAGE = "test";
  });

  it("returns todos sorted by creation date", async () => {
    const mockTodos = [
      { id: "1", title: "Old Todo", createdAt: "2025-01-01T00:00:00.000Z" },
      { id: "2", title: "New Todo", createdAt: "2025-01-02T00:00:00.000Z" },
    ];

    ddbMock.on(ScanCommand).resolves({ Items: mockTodos });

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.todos).toHaveLength(2);
    expect(body.count).toBe(2);
    // Verify sorting (newer first)
    expect(body.todos[0].title).toBe("New Todo");
    expect(body.todos[1].title).toBe("Old Todo");
  });

  it("returns empty array when no todos exist", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.todos).toEqual([]);
    expect(body.count).toBe(0);
  });

  it("handles undefined Items from DynamoDB", async () => {
    ddbMock.on(ScanCommand).resolves({}); // No Items property

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.todos).toEqual([]);
    expect(body.count).toBe(0);
  });

  it("returns 500 when DynamoDB fails", async () => {
    ddbMock.on(ScanCommand).rejects(new Error("DB error"));

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toBe("Internal server error");
  });
});

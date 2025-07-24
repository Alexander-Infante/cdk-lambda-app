import { APIGatewayProxyEvent } from "aws-lambda";
import { handler } from "../../lib/lambdas/airtableWebhook/index";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const ddbMock = mockClient(DynamoDBDocumentClient);
jest.mock("uuid", () => ({ v4: jest.fn(() => "test-uuid") }));

describe("airtableWebhook Lambda", () => {
  const createEvent = (body: any): APIGatewayProxyEvent => ({
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/v1/webhook",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: "",
  });

  const mockWebhookPayload = {
    changedTablesById: {
      table1: {
        changedRecordsById: {
          rec123: {
            current: {
              fields: {
                Name: "Test Todo from Airtable",
                Description: "Test Description",
                Status: "In Progress",
              },
            },
          },
        },
      },
    },
  };

  beforeEach(() => {
    ddbMock.reset();
    process.env.TODOS_TABLE_NAME = "test-table";
    process.env.STAGE = "test";
  });

  it("creates new todo from Airtable webhook", async () => {
    // Mock that todo doesn't exist
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(createEvent(mockWebhookPayload));

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.processedCount).toBe(1);
    expect(body.createdCount).toBe(1);
    expect(body.updatedCount).toBe(0);

    // Verify DynamoDB calls
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);

    const putCall = ddbMock.commandCalls(PutCommand)[0];
    expect(putCall.args[0].input.Item).toMatchObject({
      title: "Test Todo from Airtable",
      description: "Test Description",
      completed: false,
      source: "airtable",
      airtableRecordId: "rec123",
    });
  });

  it("updates existing todo from Airtable webhook", async () => {
    const existingTodo = {
      id: "existing-id",
      title: "Old Title",
      createdAt: "2025-01-01T00:00:00.000Z",
    };

    // Mock that todo exists
    ddbMock.on(QueryCommand).resolves({ Items: [existingTodo] });
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(createEvent(mockWebhookPayload));

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.processedCount).toBe(1);
    expect(body.createdCount).toBe(0);
    expect(body.updatedCount).toBe(1);

    const putCall = ddbMock.commandCalls(PutCommand)[0];
    expect(putCall.args[0].input.Item).toMatchObject({
      id: "existing-id", // Should keep existing ID
      title: "Test Todo from Airtable", // Should update title
      createdAt: "2025-01-01T00:00:00.000Z", // Should keep existing createdAt
    });
  });

  it("handles completed status correctly", async () => {
    const completedPayload = {
      changedTablesById: {
        table1: {
          changedRecordsById: {
            rec456: {
              current: {
                fields: {
                  Name: "Completed Todo",
                  Status: "Done",
                },
              },
            },
          },
        },
      },
    };

    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(createEvent(completedPayload));

    expect(result.statusCode).toBe(200);

    const putCall = ddbMock.commandCalls(PutCommand)[0];
    expect(putCall.args[0].input.Item?.completed).toBe(true);
  });

  it("skips deleted records", async () => {
    const deletedPayload = {
      changedTablesById: {
        table1: {
          changedRecordsById: {
            rec789: {
              // No 'current' field means deleted
            },
          },
        },
      },
    };

    const result = await handler(createEvent(deletedPayload));

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.processedCount).toBe(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("handles empty webhook payload", async () => {
    const result = await handler(createEvent({}));

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.processedCount).toBe(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";

// Always use AWS DynamoDB (no local configuration)
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

interface Todo {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  createdAt: string;
  source: "api" | "airtable";
  airtableRecordId?: string;
}

async function findExistingTodo(
  airtableRecordId: string
): Promise<Todo | null> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: process.env.TODOS_TABLE_NAME,
        IndexName: "airtable-record-index",
        KeyConditionExpression: "airtableRecordId = :recordId",
        ExpressionAttributeValues: { ":recordId": airtableRecordId },
      })
    );

    return (result.Items?.[0] as Todo) || null;
  } catch (error) {
    console.error("Error finding existing todo:", error);
    return null;
  }
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    console.log(
      "Airtable webhook received for table:",
      process.env.TODOS_TABLE_NAME
    );
    console.log("Webhook payload:", JSON.stringify(event.body, null, 2));

    const payload = JSON.parse(event.body || "{}");

    // Handle both real Airtable webhooks and test data
    const changedTables = payload.changedTablesById || {};

    let processedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;

    for (const [tableId, tableChanges] of Object.entries(changedTables)) {
      const recordChanges = (tableChanges as any).changedRecordsById || {};

      for (const [recordId, changes] of Object.entries(recordChanges)) {
        const current = (changes as any).current;
        if (!current) {
          console.log("Skipping deleted record:", recordId);
          continue; // Skip deleted records
        }

        try {
          // Check if we already have this record
          const existingTodo = await findExistingTodo(recordId);

          const todo: Todo = {
            id: existingTodo?.id || uuidv4(),
            title: current.fields?.Name || "Untitled",
            description: current.fields?.Description || "",
            completed: current.fields?.Status === "Done",
            createdAt: existingTodo?.createdAt || new Date().toISOString(),
            source: "airtable",
            airtableRecordId: recordId,
          };

          // Save/update in DynamoDB
          await docClient.send(
            new PutCommand({
              TableName: process.env.TODOS_TABLE_NAME,
              Item: todo,
            })
          );

          processedCount++;

          if (existingTodo) {
            updatedCount++;
            console.log("Updated todo from Airtable:", todo.id);
          } else {
            createdCount++;
            console.log("Created todo from Airtable:", todo.id);
          }
        } catch (error) {
          console.error("Error processing record:", recordId, error);
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: "Webhook processed successfully",
        processedCount,
        createdCount,
        updatedCount,
        tableName: process.env.TODOS_TABLE_NAME,
        stage: process.env.STAGE,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error("Webhook error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";

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

interface AirtableCreateResponse {
  id: string;
  fields: Record<string, any>;
  createdTime: string;
}

async function createInAirtable(todo: Todo): Promise<string | null> {
  if (
    !process.env.AIRTABLE_API_KEY ||
    !process.env.AIRTABLE_BASE_ID ||
    !process.env.AIRTABLE_TABLE_ID
  ) {
    console.log("Airtable not configured, skipping");
    return null;
  }

  try {
    const fields: Record<string, any> = {
      Name: todo.title,
    };

    if (todo.description) {
      fields.Description = todo.description;
    }

    console.log("Sending to Airtable:", fields);

    const response = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_ID}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Airtable error:", errorText);
      return null;
    }

    const data = (await response.json()) as AirtableCreateResponse;
    console.log("Created in Airtable:", data.id);
    return data.id;
  } catch (error) {
    console.error("Failed to create in Airtable:", error);
    return null;
  }
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    console.log("Create Todo request:", JSON.stringify(event.body, null, 2));

    const body = JSON.parse(event.body || "{}");

    if (!body.title) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Title is required" }),
      };
    }

    const todo: Todo = {
      id: uuidv4(),
      title: body.title,
      description: body.description,
      completed: false,
      createdAt: new Date().toISOString(),
      source: "api",
    };

    // Try to create in Airtable first
    const airtableRecordId = await createInAirtable(todo);
    if (airtableRecordId) {
      todo.airtableRecordId = airtableRecordId;
    }

    // Save to DynamoDB
    await docClient.send(
      new PutCommand({
        TableName: process.env.TODOS_TABLE_NAME,
        Item: todo,
      })
    );

    console.log(
      "Created todo:",
      todo.id,
      "in table:",
      process.env.TODOS_TABLE_NAME
    );

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        todo,
        message: "Todo created successfully",
        tableName: process.env.TODOS_TABLE_NAME,
        stage: process.env.STAGE,
      }),
    };
  } catch (error) {
    console.error("Error creating todo:", error);
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

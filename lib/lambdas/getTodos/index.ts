import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

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
    console.log("Get todos request for table:", process.env.TODOS_TABLE_NAME);

    const result = await docClient.send(
      new ScanCommand({
        TableName: process.env.TODOS_TABLE_NAME,
      })
    );

    const todos = (result.Items || []).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    console.log(
      "Retrieved todos:",
      todos.length,
      "from table:",
      process.env.TODOS_TABLE_NAME
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        todos,
        count: todos.length,
        tableName: process.env.TODOS_TABLE_NAME,
        stage: process.env.STAGE,
      }),
    };
  } catch (error) {
    console.error("Error fetching todos:", error);
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

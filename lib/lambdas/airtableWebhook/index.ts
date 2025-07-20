import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

// Configure DynamoDB client for local development
const dynamoConfig = process.env.STAGE === 'local' ? {
  endpoint: 'http://localhost:8000',
  region: 'localhost',
  credentials: {
    accessKeyId: 'MockAccessKeyId',
    secretAccessKey: 'MockSecretAccessKey',
  },
} : {};

const client = new DynamoDBClient(dynamoConfig);
const docClient = DynamoDBDocumentClient.from(client);

interface Todo {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  createdAt: string;
  source: 'api' | 'airtable';
  airtableRecordId?: string;
}

async function findExistingTodo(airtableRecordId: string): Promise<Todo | null> {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: process.env.TODOS_TABLE_NAME,
      IndexName: 'airtable-record-index',
      KeyConditionExpression: 'airtableRecordId = :recordId',
      ExpressionAttributeValues: { ':recordId': airtableRecordId },
    }));

    return result.Items?.[0] as Todo || null;
  } catch (error) {
    console.error('Error finding existing todo:', error);
    return null;
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const payload = JSON.parse(event.body || '{}');
    
    console.log('Webhook received:', JSON.stringify(payload, null, 2));

    // Handle both real Airtable webhooks and test data
    const changedTables = payload.changedTablesById || {};
    
    let processedCount = 0;

    for (const [tableId, tableChanges] of Object.entries(changedTables)) {
      const recordChanges = (tableChanges as any).changedRecordsById || {};
      
      for (const [recordId, changes] of Object.entries(recordChanges)) {
        const current = (changes as any).current;
        if (!current) continue; // Skip deleted records

        // Check if we already have this record
        const existingTodo = await findExistingTodo(recordId);
        
        const todo: Todo = {
          id: existingTodo?.id || uuidv4(),
          title: current.fields?.Name || 'Untitled',
          description: current.fields?.Description || '',
          completed: current.fields?.Status === 'Done',
          createdAt: existingTodo?.createdAt || new Date().toISOString(),
          source: 'airtable',
          airtableRecordId: recordId,
        };

        // Save/update in DynamoDB
        await docClient.send(new PutCommand({
          TableName: process.env.TODOS_TABLE_NAME,
          Item: todo,
        }));

        processedCount++;
        console.log(`${existingTodo ? 'Updated' : 'Created'} todo from Airtable:`, todo.id);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Webhook processed',
        processedCount,
        environment: process.env.STAGE,
      }),
    };
  } catch (error) {
    console.error('Webhook error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
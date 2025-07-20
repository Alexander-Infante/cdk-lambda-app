import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
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

async function createInAirtable(todo: Todo): Promise<string | null> {
  // Skip Airtable in local development unless explicitly configured
  if (process.env.STAGE === 'local' && !process.env.AIRTABLE_API_KEY) {
    console.log('Local development: Skipping Airtable integration');
    return null;
  }

  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    console.log('Airtable not configured, skipping');
    return null;
  }

  try {
    const response = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_ID}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            'Name': todo.title,
            'Description': todo.description || '',
            'Status': 'To Do',
          },
        }),
      }
    );

    if (!response.ok) {
      console.error('Airtable error:', await response.text());
      return null;
    }

    const data = await response.json();
    return data.id;
  } catch (error) {
    console.error('Failed to create in Airtable:', error);
    return null;
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const body = JSON.parse(event.body || '{}');
    
    if (!body.title) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Title is required' }),
      };
    }

    const todo: Todo = {
      id: uuidv4(),
      title: body.title,
      description: body.description,
      completed: false,
      createdAt: new Date().toISOString(),
      source: 'api',
    };

    // Try to create in Airtable first
    const airtableRecordId = await createInAirtable(todo);
    if (airtableRecordId) {
      todo.airtableRecordId = airtableRecordId;
    }

    // Save to DynamoDB
    await docClient.send(new PutCommand({
      TableName: process.env.TODOS_TABLE_NAME,
      Item: todo,
    }));

    console.log('Created todo:', todo.id, process.env.STAGE === 'local' ? '(local)' : '(aws)');

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({ 
        todo,
        environment: process.env.STAGE 
      }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
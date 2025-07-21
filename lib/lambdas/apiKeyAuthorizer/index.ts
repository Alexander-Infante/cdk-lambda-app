import {
  APIGatewayRequestAuthorizerEvent,
  APIGatewayAuthorizerResult,
} from "aws-lambda";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION || "us-east-1",
});

let cachedApiKey: string | null = null;
let cacheExpiry: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function getApiKeyFromSecrets(): Promise<string | null> {
  if (cachedApiKey && Date.now() < cacheExpiry) {
    return cachedApiKey;
  }

  try {
    const secretName = process.env.API_KEY_SECRET_NAME;
    if (!secretName) {
      console.error("API_KEY_SECRET_NAME environment variable not set");
      return null;
    }

    console.log("Fetching API key from Secrets Manager:", secretName);

    const result = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: secretName,
      })
    );

    if (!result.SecretString) {
      console.error("No secret string found");
      return null;
    }

    const secretData = JSON.parse(result.SecretString);
    const apiKey = secretData.apiKey;

    if (!apiKey) {
      console.error("No apiKey field found in secret");
      return null;
    }

    cachedApiKey = apiKey;
    cacheExpiry = Date.now() + CACHE_DURATION;

    console.log("API key retrieved and cached successfully");
    return apiKey;
  } catch (error) {
    console.error("Error fetching API key from Secrets Manager:", error);
    return null;
  }
}

export const handler = async (
  event: APIGatewayRequestAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> => {
  console.log("Authorizer invoked for:", event.methodArn);

  try {
    const apiKey = event.headers?.["x-api-key"] || event.headers?.["X-API-Key"];

    if (!apiKey) {
      console.log("No API key provided");
      throw new Error("Unauthorized");
    }

    const expectedApiKey = await getApiKeyFromSecrets();

    if (!expectedApiKey) {
      console.error("Could not retrieve expected API key");
      throw new Error("Unauthorized");
    }

    if (apiKey !== expectedApiKey) {
      console.log("API key validation failed");
      throw new Error("Unauthorized");
    }

    console.log("API key validation successful");

    return {
      principalId: "authorized-user",
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Action: "execute-api:Invoke",
            Effect: "Allow",
            Resource: event.methodArn,
          },
        ],
      },
    };
  } catch (error) {
    console.error("Authorization failed:", error);

    return {
      principalId: "unauthorized",
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Action: "execute-api:Invoke",
            Effect: "Deny",
            Resource: event.methodArn,
          },
        ],
      },
    };
  }
};

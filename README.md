# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

## Manual Steps
1. Create IAM User with PowerUserAccess in AWS for the Github Actions CICD Piepline
2. Create an Airtable API Key, gather Base ID and Table ID
3. Store Airtable information in Secrets in Github Actions
4. Create API Key and store in Secrets Manager
5. Create IAM User with specific DynamoDB, Secrets Manager access for running locally

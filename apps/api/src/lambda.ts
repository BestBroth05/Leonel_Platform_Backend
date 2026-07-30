import awsLambdaFastify from "@fastify/aws-lambda";
import type { Context } from "aws-lambda";
import { buildApp } from "./app-context.js";

type LambdaProxy = (
  event: unknown,
  context: Context,
) => Promise<unknown>;

let proxy: LambdaProxy | undefined;

async function getProxy(): Promise<LambdaProxy> {
  if (!proxy) {
    const { app } = await buildApp();
    await app.ready();
    proxy = awsLambdaFastify(app) as LambdaProxy;
  }
  return proxy;
}

/** AWS Lambda entrypoint stub for future SAM packaging */
export async function handler(event: unknown, context: Context) {
  const p = await getProxy();
  return p(event, context);
}

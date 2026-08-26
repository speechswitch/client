import type { Auth, AwsAuth } from "../../auth.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { createAwsSigV4Fetch, type AwsCredentials } from "../../runtime/aws/sigv4.ts";

export interface AwsAuthOptions {
  readonly auth: Auth | undefined;
  readonly fetch: Fetch | undefined;
}

export interface ResolvedAwsAuth {
  readonly region: string;
  readonly credentials: AwsCredentials;
  readonly fetch: Fetch;
}

type Environment = Readonly<Record<string, string | undefined>>;

function value(environment: Environment, ...names: string[]): string | undefined {
  for (const name of names) {
    const candidate = environment[name]?.trim();
    if (candidate) return candidate;
  }
}

function credentials(auth: AwsAuth | undefined, environment: Environment): AwsCredentials {
  const accessKeyId = auth?.accessKeyId ?? value(
    environment,
    "SPEECHSWITCH_AWS_ACCESS_KEY_ID",
    "AWS_ACCESS_KEY_ID",
  );
  const secretAccessKey = auth?.secretAccessKey ?? value(
    environment,
    "SPEECHSWITCH_AWS_SECRET_ACCESS_KEY",
    "AWS_SECRET_ACCESS_KEY",
  );
  if (!accessKeyId || !secretAccessKey) {
    throw new TypeError(
      "Missing AWS credentials: pass auth.aws or set SPEECHSWITCH_AWS_ACCESS_KEY_ID and " +
      "SPEECHSWITCH_AWS_SECRET_ACCESS_KEY (or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY)",
    );
  }
  const sessionToken = auth?.sessionToken ?? value(
    environment,
    "SPEECHSWITCH_AWS_SESSION_TOKEN",
    "AWS_SESSION_TOKEN",
  );
  return { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) };
}

export function resolveAwsAuth(options: AwsAuthOptions, environment: Environment): ResolvedAwsAuth {
  const aws = options.auth?.aws;
  const region = aws?.region ?? value(
    environment,
    "SPEECHSWITCH_AWS_REGION",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
  ) ?? "us-east-1";
  const resolvedCredentials = credentials(aws, environment);
  return {
    region,
    credentials: resolvedCredentials,
    fetch: createAwsSigV4Fetch({
      ...resolvedCredentials,
      region,
      service: "polly",
      fetch: options.fetch ?? globalThis.fetch,
    }),
  };
}

export function processEnvironment(): Environment {
  return typeof process === "undefined" ? {} : process.env;
}

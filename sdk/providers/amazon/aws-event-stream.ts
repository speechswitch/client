import {
  PollyClient,
  StartSpeechSynthesisStreamCommand,
  type StartSpeechSynthesisStreamCommandInput,
  type StartSpeechSynthesisStreamCommandOutput,
} from "@aws-sdk/client-polly";
import type { AwsCredentials } from "./aws-sigv4.ts";

export interface PollyStreamingClient {
  start(
    input: StartSpeechSynthesisStreamCommandInput,
    signal: AbortSignal | undefined,
  ): Promise<StartSpeechSynthesisStreamCommandOutput>;
}

export function createPollyStreamingClient(
  region: string,
  credentials: AwsCredentials,
): PollyStreamingClient {
  const client = new PollyClient({ region, credentials });
  return {
    start: (input, signal) => client.send(
      new StartSpeechSynthesisStreamCommand(input),
      signal ? { abortSignal: signal } : {},
    ),
  };
}

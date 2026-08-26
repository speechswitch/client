import { describe, expect, test } from "bun:test";
import type { Fetch } from "../../fetch.ts";
import { resolveAwsAuth } from "./aws-auth.ts";
import { synthesize } from "./index.ts";

describe("Amazon Polly", () => {
  test("maps the normalized request and streams signed response bytes", async () => {
    let url: URL | undefined;
    let request: RequestInit | undefined;
    const fetch: Fetch = async (input, init) => {
      url = new URL(String(input));
      request = init;
      const audio = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.of(1, 2));
          controller.enqueue(Uint8Array.of(3));
          controller.close();
        },
      });
      return new Response(audio, { headers: { "content-type": "audio/mpeg" } });
    };

    const chunks = await Array.fromAsync(synthesize({
      text: "hello",
      voice: "Joanna",
      format: "mp3",
      sampleRateHz: 24000,
      model: "neural",
      lexicon: "product",
    }, {
      auth: {
        aws: {
          accessKeyId: "access-key",
          secretAccessKey: "secret-key",
          region: "eu-west-1",
        },
      },
      fetch,
    }));

    expect(chunks).toEqual([Uint8Array.of(1, 2), Uint8Array.of(3)]);
    expect(url?.href).toBe("https://polly.eu-west-1.amazonaws.com/v1/speech");
    expect(JSON.parse(new TextDecoder().decode(request?.body as Uint8Array))).toEqual({
      Text: "hello",
      VoiceId: "Joanna",
      OutputFormat: "mp3",
      SampleRate: "24000",
      Engine: "neural",
      LexiconNames: ["product"],
    });
    expect(new Headers(request?.headers).get("authorization")).toContain("Credential=access-key/");
  });

  test("prefers Speechswitch AWS environment variables", async () => {
    const captured: { authorization: string | null } = { authorization: null };
    const fetch: Fetch = async (_input, init) => {
      captured.authorization = new Headers(init?.headers).get("authorization");
      return new Response();
    };
    const resolved = resolveAwsAuth({ auth: undefined, fetch }, {
      SPEECHSWITCH_AWS_ACCESS_KEY_ID: "speechswitch-key",
      SPEECHSWITCH_AWS_SECRET_ACCESS_KEY: "speechswitch-secret",
      SPEECHSWITCH_AWS_REGION: "eu-central-1",
      AWS_ACCESS_KEY_ID: "standard-key",
      AWS_SECRET_ACCESS_KEY: "standard-secret",
      AWS_REGION: "us-west-1",
    });

    await resolved.fetch("https://polly.eu-central-1.amazonaws.com/v1/speech", {
      method: "POST",
      body: "{}",
    });

    expect(resolved.region).toBe("eu-central-1");
    expect(captured.authorization ?? "").toContain("Credential=speechswitch-key/");
  });
});

import type { Equal } from "../../../test-support/types.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Fetch } from "../../runtime/fetch.ts";
import { resolveAwsAuth } from "./aws-auth.ts";
import {
  decodeAwsEventStreamMessages,
  type AwsEventStreamClient,
} from "../../runtime/aws/event-stream.ts";
import { startSpeechSynthesisStream } from "../../generated/clients/amazon-polly.ts";
import {
  synthesize,
  synthesizeWithTimestamps,
  type TtsRequestWithTimestamps,
} from "./index.ts";

describe("Amazon Polly", () => {
  test("excludes the generative engine from speech-mark requests", () => {
    true satisfies Equal<TtsRequestWithTimestamps["model"],
      "standard" | "neural" | "long-form" | undefined
    >;
  });

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
      output: { format: "mp3", sampleRateHz: 24000 },
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

    assert.deepEqual(chunks, [Uint8Array.of(1, 2), Uint8Array.of(3)]);
    assert.equal(url?.href, "https://polly.eu-west-1.amazonaws.com/v1/speech");
    assert.deepEqual(JSON.parse(new TextDecoder().decode(request?.body as Uint8Array)), {
      Text: "hello",
      VoiceId: "Joanna",
      OutputFormat: "mp3",
      SampleRate: "24000",
      Engine: "neural",
      LexiconNames: ["product"],
    });
    assert.ok((new Headers(request?.headers).get("authorization"))?.includes("Credential=access-key/"));
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

    assert.equal(resolved.region, "eu-central-1");
    assert.ok((captured.authorization ?? "")?.includes("Credential=speechswitch-key/"));
  });

  test("streams generative input and audio through the bidirectional client", async () => {
    let headers: Readonly<Record<string, string>> = {};
    let actions: AsyncIterable<Uint8Array> | undefined;
    const eventStream: AwsEventStreamClient = {
      async request(_method, _url, requestHeaders, body) {
        headers = requestHeaders;
        actions = body;
        return (async function* () {
          yield {
            headers: { ":message-type": "event", ":event-type": "AudioEvent" },
            body: Uint8Array.of(1, 2),
          };
          yield {
            headers: { ":message-type": "event", ":event-type": "AudioEvent" },
            body: Uint8Array.of(3),
          };
          yield {
            headers: { ":message-type": "event", ":event-type": "StreamClosedEvent" },
            body: new TextEncoder().encode(JSON.stringify({ RequestCharacters: 5 })),
          };
        })();
      },
    };

    const chunks = await Array.fromAsync(synthesize({
      text: (async function* () {
        yield "hel";
        yield "lo";
      })(),
      voice: "Joanna",
      model: "generative",
      output: { format: "mp3", sampleRateHz: 24000 },
    }, {
      auth: {
        aws: {
          accessKeyId: "access-key",
          secretAccessKey: "secret-key",
          region: "eu-west-1",
        },
      },
      eventStream,
    }));

    assert.deepEqual(chunks, [Uint8Array.of(1, 2), Uint8Array.of(3)]);
    assert.partialDeepStrictEqual(headers, {
      "x-amzn-engine": "generative",
      "x-amzn-outputformat": "mp3",
      "x-amzn-samplerate": "24000",
    });
    if (!actions) throw new TypeError("Generated client did not stream actions");
    const encoded = await Array.fromAsync(decodeAwsEventStreamMessages(actions));
    assert.deepEqual(encoded.map(({ headers, body }) => [
      headers[":event-type"],
      JSON.parse(new TextDecoder().decode(body)),
    ]), [
      ["TextEvent", { Text: "hel" }],
      ["TextEvent", { Text: "lo" }],
      ["CloseStreamEvent", {}],
    ]);
  });

  test("returns the final stream-closed event from the generated audio stream", async () => {
    const eventStream: AwsEventStreamClient = {
      async request() {
        return (async function* () {
          yield {
            headers: { ":message-type": "event", ":event-type": "AudioEvent" },
            body: Uint8Array.of(1, 2),
          };
          yield {
            headers: { ":message-type": "event", ":event-type": "StreamClosedEvent" },
            body: new TextEncoder().encode(JSON.stringify({ RequestCharacters: 5 })),
          };
        })();
      },
    };
    const response = await startSpeechSynthesisStream({
      Engine: "generative",
      OutputFormat: "mp3",
      VoiceId: "Joanna",
      ActionStream: (async function* () {
        yield { CloseStreamEvent: {} } as const;
      })(),
    }, {
      baseUrl: "https://polly.eu-west-1.amazonaws.com",
      eventStream,
      signal: undefined,
    });
    if (!response.EventStream) throw new TypeError("Generated client returned no event stream");

    assert.deepEqual(await response.EventStream.next(), {
      done: false,
      value: { AudioChunk: Uint8Array.of(1, 2) },
    });
    assert.deepEqual(await response.EventStream.next(), {
      done: true,
      value: { RequestCharacters: 5 },
    });
  });

  test("throws modeled exceptions from the generated audio stream", async () => {
    const eventStream: AwsEventStreamClient = {
      async request() {
        return (async function* () {
          yield {
            headers: {
              ":message-type": "exception",
              ":exception-type": "ValidationException",
            },
            body: new TextEncoder().encode(JSON.stringify({
              message: "Text is invalid",
              reason: "fieldValidationFailed",
            })),
          };
        })();
      },
    };
    const response = await startSpeechSynthesisStream({
      Engine: "generative",
      OutputFormat: "mp3",
      VoiceId: "Joanna",
      ActionStream: (async function* () {
        yield { CloseStreamEvent: {} } as const;
      })(),
    }, {
      baseUrl: "https://polly.eu-west-1.amazonaws.com",
      eventStream,
      signal: undefined,
    });
    if (!response.EventStream) throw new TypeError("Generated client returned no event stream");

    try {
      await response.EventStream.next();
      throw new TypeError("Expected the generated stream to throw");
    } catch (error) {
      assert.ok(error instanceof TypeError);
      assert.equal((error as TypeError).message, "Text is invalid");
      assert.deepEqual((error as TypeError).cause, {
        message: "Text is invalid",
        reason: "fieldValidationFailed",
      });
    }
  });

  test("races audio chunks and the independent speech-mark timeline", async () => {
    const fetch: Fetch = async (_input, init) => {
      const request = JSON.parse(
        new TextDecoder().decode(init?.body as Uint8Array),
      ) as { OutputFormat: string };
      if (request.OutputFormat === "json") {
        return new Response(
          '{"time":12,"type":"word","value":"hello","start":0,"end":5}\n',
        );
      }
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(Uint8Array.of(1, 2));
          controller.enqueue(Uint8Array.of(3));
          controller.close();
        },
      }));
    };

    const envelopes = await Array.fromAsync(synthesizeWithTimestamps({
      text: "hello",
      voice: "Joanna",
      output: { format: "mp3" },
      timestampKinds: ["word"],
    }, {
      auth: {
        aws: {
          accessKeyId: "access-key",
          secretAccessKey: "secret-key",
        },
      },
      fetch,
    }));

    assert.equal(envelopes.every(envelope => envelope.correlation === "timeline"), true);
    assert.deepEqual(envelopes.slice(0, 2).map(envelope => envelope.audio ? "audio" : "marks").sort(), [
      "audio",
      "marks",
    ]);
    assert.deepEqual(envelopes.filter(envelope => envelope.audio).map(envelope => [...envelope.audio!]), [
      [1, 2],
      [3],
    ]);
    assert.deepEqual(envelopes.find(envelope => envelope.timestamps.length)?.timestamps, [{
      kind: "word",
      value: "hello",
      startTimeMs: 12,
      source: { start: 0, end: 5 },
    }]);
  });

  test("streams fragmented speech marks without waiting for audio", async () => {
    const encodedMarks = new TextEncoder().encode(
      '{"time":12,"type":"word","value":"hełlo","start":0,"end":6}\r\n',
    );
    const fetch: Fetch = async (_input, init) => {
      const request = JSON.parse(
        new TextDecoder().decode(init?.body as Uint8Array),
      ) as { OutputFormat: string };
      if (request.OutputFormat === "json") {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encodedMarks.slice(0, 48));
            controller.enqueue(encodedMarks.slice(48));
            controller.close();
          },
        }));
      }
      return new Response(new ReadableStream({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(Uint8Array.of(1, 2));
            controller.close();
          }, 20);
        },
      }));
    };

    const envelopes = await Array.fromAsync(synthesizeWithTimestamps({
      text: "hełlo",
      voice: "Joanna",
      output: { format: "mp3" },
      timestampKinds: ["word"],
    }, {
      auth: {
        aws: {
          accessKeyId: "access-key",
          secretAccessKey: "secret-key",
        },
      },
      fetch,
    }));

    assert.deepEqual(envelopes.map(envelope => envelope.audio ? "audio" : "marks"), [
      "marks",
      "audio",
    ]);
    assert.equal(envelopes[0]?.timestamps[0]?.value, "hełlo");
  });

  test("streams audio without waiting for speech marks", async () => {
    const fetch: Fetch = async (_input, init) => {
      const request = JSON.parse(
        new TextDecoder().decode(init?.body as Uint8Array),
      ) as { OutputFormat: string };
      if (request.OutputFormat === "json") {
        return new Response(new ReadableStream({
          start(controller) {
            setTimeout(() => {
              controller.enqueue(new TextEncoder().encode(
                '{"time":12,"type":"word","value":"hello"}\n',
              ));
              controller.close();
            }, 20);
          },
        }));
      }
      return new Response(Uint8Array.of(1, 2));
    };

    const envelopes = await Array.fromAsync(synthesizeWithTimestamps({
      text: "hello",
      voice: "Joanna",
      output: { format: "mp3" },
      timestampKinds: ["word"],
    }, {
      auth: {
        aws: {
          accessKeyId: "access-key",
          secretAccessKey: "secret-key",
        },
      },
      fetch,
    }));

    assert.deepEqual(envelopes.map(envelope => envelope.audio ? "audio" : "marks"), [
      "audio",
      "marks",
    ]);
  });
});

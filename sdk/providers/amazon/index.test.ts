import { describe, expect, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import { resolveAwsAuth } from "./aws-auth.ts";
import {
  decodeAwsEventStreamMessages,
  type AwsEventStreamClient,
} from "../../runtime/aws/event-stream.ts";
import { startSpeechSynthesisStream } from "../../generated/clients/amazon-polly.ts";
import { synthesize, synthesizeWithTimestamps } from "./index.ts";

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

    expect(chunks).toEqual([Uint8Array.of(1, 2), Uint8Array.of(3)]);
    expect(headers).toMatchObject({
      "x-amzn-engine": "generative",
      "x-amzn-outputformat": "mp3",
      "x-amzn-samplerate": "24000",
    });
    if (!actions) throw new TypeError("Generated client did not stream actions");
    const encoded = await Array.fromAsync(decodeAwsEventStreamMessages(actions));
    expect(encoded.map(({ headers, body }) => [
      headers[":event-type"],
      JSON.parse(new TextDecoder().decode(body)),
    ])).toEqual([
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

    expect(await response.EventStream.next()).toEqual({
      done: false,
      value: { AudioChunk: Uint8Array.of(1, 2) },
    });
    expect(await response.EventStream.next()).toEqual({
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
      expect(error).toBeInstanceOf(TypeError);
      expect((error as TypeError).message).toBe("Text is invalid");
      expect((error as TypeError).cause).toEqual({
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

    expect(envelopes.every(envelope => envelope.correlation === "timeline")).toBe(true);
    expect(envelopes.slice(0, 2).map(envelope => envelope.audio ? "audio" : "marks").sort()).toEqual([
      "audio",
      "marks",
    ]);
    expect(envelopes.filter(envelope => envelope.audio).map(envelope => [...envelope.audio!])).toEqual([
      [1, 2],
      [3],
    ]);
    expect(envelopes.find(envelope => envelope.timestamps.length)?.timestamps).toEqual([{
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

    expect(envelopes.map(envelope => envelope.audio ? "audio" : "marks")).toEqual([
      "marks",
      "audio",
    ]);
    expect(envelopes[0]?.timestamps[0]?.value).toBe("hełlo");
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

    expect(envelopes.map(envelope => envelope.audio ? "audio" : "marks")).toEqual([
      "audio",
      "marks",
    ]);
  });
});

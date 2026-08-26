import { expect, test } from "bun:test";
import {
  encodeAwsEventStreamMessage,
  encodeSignedAwsEventStreamMessage,
} from "./event-stream.ts";
import { signAwsRequest } from "./sigv4.ts";

test("encodes Polly's signed event-stream frame", () => {
  const credentials = { accessKeyId: "AKID", secretAccessKey: "SECRET" };
  const request = signAwsRequest(
    "POST",
    new URL("https://polly.eu-west-1.amazonaws.com/v1/synthesisStream"),
    {
      "amz-sdk-invocation-id": "929fc76c-5d6a-47de-92d3-591d1cb9e619",
      "amz-sdk-request": "attempt=1; max=3",
      "content-type": "application/vnd.amazon.eventstream",
      "x-amz-user-agent": "aws-sdk-js/3.1117.0",
      "x-amzn-engine": "generative",
      "x-amzn-lexiconnames": "a, b",
      "x-amzn-outputformat": "mp3",
      "x-amzn-samplerate": "24000",
      "x-amzn-voiceid": "Joanna",
    },
    "STREAMING-AWS4-HMAC-SHA256-EVENTS",
    { ...credentials, region: "eu-west-1", service: "polly" },
    new Date("2026-08-26T15:27:50Z"),
  );
  expect(request.signature).toBe("dc4b029653d4113f3b7c270c368cfec4b5efd659d424c071c8f12ecec33db49c");

  const payload = encodeAwsEventStreamMessage({
    headers: {
      ":event-type": "TextEvent",
      ":message-type": "event",
      ":content-type": "application/json",
    },
    body: new TextEncoder().encode(JSON.stringify({ Text: "hi", TextType: "text" })),
  });
  const [frame, signature] = encodeSignedAwsEventStreamMessage(
    payload,
    request.signature,
    credentials,
    "eu-west-1",
    "polly",
    new Date("2026-08-26T15:27:50.304Z"),
  );

  expect(signature).toBe("f42e169dcb500ecd41cf9e93900b24e9f3e6e8f203a981470e4de3c9989123a2");
  expect(Buffer.from(frame).toString("hex")).toBe(
    "000000d1000000433e6299aa053a6461746508000001a03eaf4a20103a6368756e6b2d7369676e6174757265060020" +
    "f42e169dcb500ecd41cf9e93900b24e9f3e6e8f203a981470e4de3c9989123a20000007e0000004fc5a3ddc60b3a65" +
    "76656e742d74797065070009546578744576656e740d3a6d6573736167652d747970650700056576656e740d3a636f6e" +
    "74656e742d747970650700106170706c69636174696f6e2f6a736f6e7b2254657874223a226869222c22546578745479" +
    "7065223a2274657874227dd17a0d3971380c54",
  );
});

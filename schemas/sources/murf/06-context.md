> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://murf.ai/api/docs/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://murf.ai/_mcp/server.

Murf’s WebSocket implementation is based on the concept of a **Context ID** — a unique identifier used to track a specific TTS request. Context ID ensures continuity in the conversation, especially when the input text is generated in real time (e.g., via an LLM), comes in parts, or when the interaction is interrupted. It serves as a proxy for a single turn in the interaction between a user and the agent.

## Why Use a Context ID?

* **Maintains Conversational Flow:** Links input and output across split or partial messages.
* **Handles Interruptions Gracefully:** If a user interrupts the agent, the Context ID ensures that the current request can be cancelled or skipped.
* **Supports Multi-Turn Interactions:** Essential for structured flows like bookings, troubleshooting, or guided forms.
* **Simplifies Handoff and Debugging:** If support is needed, the Context ID allows you to trace exactly what happened in a specific interaction turn.

![Simple WebSocket Connection](https://fdr-prod-docs-files-public.s3.us-east-1.amazonaws.com/murf.docs.buildwithfern.com/b121ce4ffdbd15aefccc85bc2529206c6d0864259923bec773bd3b360e626ee2/assets/websockets/Simple_connection_Context_id.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA6KXJSKKNFOCF7G4B%2F20260906%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260906T004813Z&X-Amz-Expires=604800&X-Amz-Signature=0ec73118e8d8384e2c350c26b6ebd83fc21abbbd77ea419ff53a67801fe2e21d&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject)

![Simple WebSocket Connection](https://fdr-prod-docs-files-public.s3.us-east-1.amazonaws.com/murf.docs.buildwithfern.com/77597f5f1a75eea7e1caf6c1cd7f9f39f5741cd2eee442587207c674449c03ea/assets/websockets/One_Connection_Multiple_Contexts.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA6KXJSKKNFOCF7G4B%2F20260906%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260906T004813Z&X-Amz-Expires=604800&X-Amz-Signature=79581252d85cc5e5fac59c637d437b4815211b79c725175c11ca029b25737e00&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject)

## Working with Context IDs

#### Input Stream

* Assign a new `context_id` for each turn in the conversation.
* The `end` parameter should be set to `true` at the end of each turn. This clears the context and allows the next turn to start.
* Ensure input text includes proper punctuation for better prosody and consistent audio output.

#### Output Audio

* The response will include the same `context_id`, allowing you to match responses with their corresponding inputs.
* A `final` flag will indicate that all audio for that context has been sent.
* Output is streamed in the same order that input text was received.

#### Handling Interruptions

* If the user interrupts the agent mid-response, start a new `context_id` for the next turn.
* Murf’s WebSocket supports multiplexing, so multiple `context_id`s can run independently over the same connection.
* To cancel a pending or in-progress turn, use the `clear` parameter. If synthesis hasn’t started, the request is cancelled. If synthesis has started, the audio will still play to completion.

## Example for using Context ID in a Voice Agent

Let’s say you’re building a voice agent that helps users book flights.

#### Establish WebSocket Connection

You open a WebSocket connection when the conversation starts. This connection stays open and allows real-time audio streaming between user and agent.

#### Use a Context ID for Each Agent Response (Turn)

#### Turn 1

**User says**: “I want to book a flight to Paris.”

Your backend processes this and generates an agent response:

**Agent text**: “Sure, when would you like to travel?”

You send this text to Murf's WebSocket API:

```json
{
  "context_id": "turn_1",
  "text": "Sure, when would you like to travel?",
}
```

Murf returns audio with context\_id: "turn\_1" so you can play it back to the user.

#### Turn 2

**User says**: “Next Friday.”

**Agent response**: “Got it. Do you prefer morning or evening flights?”

You send this text to Murf's WebSocket API:

```json
{
  "context_id": "turn_2",
  "text": "Got it. Do you prefer morning or evening flights?",
}
```

Murf returns audio tagged with context\_id: "turn\_2".

#### Handle Interruptions

If the agent is mid-response and the user interrupts (e.g., says “Wait, make that Saturday”):

* Stop playback of the current audio. The `clear: true` flag cancels any pending or incomplete responses tied to earlier contexts.
* Send the updated agent reply with a new `context_id`:

```json
// Clear the previous context
{
  "context_id": "turn_2",
  "clear": true
}
// Send the updated agent reply with a new context_id
{
  "context_id": "turn_3",
  "text": "Saturday works. Do you want to fly direct or stopover?",
}
```

Murf returns audio tagged with context\_id: "turn\_3".

## Why This Matters

* Each context ID represents one agent turn in conversation.
* You maintain clean tracking of each response, even with interruptions.
* WebSocket handles all turns over a single connection, supporting real-time, fluid interaction.
> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developers.deepgram.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developers.deepgram.com/_mcp/server.

# Clear

Text to Speech Stream

If you're working on a conversational AI use case between a human and a TTS agent, the human may interrupt the Agent at any time, and you may want to clear (or reset) the internal text buffer. This is useful because the TTS websocket will stop sending audio, allowing your LLM to generate a new response. The TTS websocket will then produce audio only based on the new text provided.

After sending the optional `Clear` message, the TTS websocket will clear the internal text and audio buffer for generating audio and will stop sending new audio chunks as soon as possible.

## Sending `Clear`

To send the `Clear` message, you need to send the following JSON message to the server:

```json JSON
{
    "type": "Clear"
}
```

## `Clear` Confirmation

Upon receiving the `Clear` message, the server will process all remaining audio data and return the following:

```json JSON
{
 
"type": "Cleared",
"sequence_id": 0
}
```

# Conclusion

To ensure seamless interactions between a human and a TTS agent, it's crucial to handle interruptions effectively. Clearing the internal text buffer via a `Clear` message allows for fresh input to be sent from the LLM, ensuring the system adapts to the ongoing conversation. This approach stops the generation of unnecessary audio, enhancing the responsiveness and accuracy of the TTS agent.

---
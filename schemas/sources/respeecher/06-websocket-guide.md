> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://space.respeecher.com/docs/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://space.respeecher.com/_mcp/server.

# WebSockets Guide

WebSockets are the most performant option for text-to-speech.
You can send multiple generation requests over the same WebSocket connection by
specifying a different `context_id` in outgoing messages,
and then differentiate audio by `context_id` in incoming messages.
You can also stream input text in chunks of any size by setting `continue` to `true` in
all but the last chunk.
This helps to avoid any inconsistencies in prosody
that could happen if text chunks were treated completely independently.

Here are the best practices for working with WebSockets:

* create the connection beforehand to avoid introducing additional latency for
  the first generation;
* reuse the connection for multiple generations;
* periodically reopen the connection as any one connection is not guaranteed
  to be kept alive for longer than 12 hours;
* close the connection if it's unused because idle connections may be closed server-side.

See the [API reference](./web-socket) for details.
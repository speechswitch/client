> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Regional endpoints

> Route requests to the Rime region closest to your application for the lowest latency.

Rime provides regional API endpoints so you can route requests to the data center closest to your application's deployment, reducing network latency.

## HTTP endpoints

Use these endpoints for standard HTTP and SSE requests:

| Endpoint                     | Region                                      |
| ---------------------------- | ------------------------------------------- |
| `https://users.rime.ai`      | US West, the default alias for `users-west` |
| `https://users-west.rime.ai` | US West (us-west-2)                         |
| `https://users-east.rime.ai` | US East (us-east-1)                         |

## WebSocket endpoints

Use these endpoints for real-time streaming over WebSocket. The regional routing pattern applies to every WebSocket path (`/ws`, `/ws2`, `/ws3`): the `/ws3` examples below are shown because it's Rime's recommended WebSocket endpoint.

| Endpoint                          | Region              |
| --------------------------------- | ------------------- |
| `wss://users-ws.rime.ai/ws3`      | US West (us-west-2) |
| `wss://users-east-ws.rime.ai/ws3` | US East (us-east-1) |

## Typical network latency

Use these rough round-trip times (RTT), the back-and-forth network delay between your application and Rime, to pick the closest endpoint.

| From metro                                | To US East | To US West |
| :---------------------------------------- | :--------- | :--------- |
| East Coast (NYC, DC, Boston, Atlanta)     | 5–25 ms    | 60–85 ms   |
| Midwest / South (Chicago, Dallas, Denver) | 25–55 ms   | 35–65 ms   |
| West Coast (SF, LA, Seattle)              | 60–85 ms   | 5–25 ms    |

Rules of thumb:

* **Same region** (your app and the Rime endpoint in the same AWS region): typically 1–10 ms.
* **Coast-to-coast**: \~60 ms is the physical floor, set by the speed of light in fiber across \~2,500 miles. 60–85 ms is normal.
* **Above 90 ms** between major US metros usually points to a suboptimal network route, not Rime.

**For voice AI:** if you serve users nationwide from a single region, far-coast users will see 60–85 ms of network round-trip on top of Rime's inference time. To stay comfortably under 200 ms end-to-end, route East-coast users to US East and West-coast users to US West.

For the full latency picture, including Rime's model-inference time, streaming TTFB, and the H100 benchmark numbers, see [Latency](/docs/latency).

## Choosing a region

Choose the endpoint in the region closest to where your application is deployed. For example:

* If your server runs in AWS `us-west-2`, use `users-west.rime.ai` / `users-ws.rime.ai`.
* If your server runs in AWS `us-east-1`, use `users-east.rime.ai` / `users-east-ws.rime.ai`.

<Tip>Use the [`rime speedtest`](/cli-reference/rime-monitoring) command to measure TTFB against each endpoint from your machine.</Tip>

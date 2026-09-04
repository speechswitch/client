> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://space.respeecher.com/docs/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://space.respeecher.com/_mcp/server.

# Bytes

POST https://api.respeecher.com/v1/public/tts/en-rt/tts/bytes
Content-Type: application/json

The easiest way to generate text-to-speech audio. Not suitable for latency-sensitive applications. Use for transcripts up to approximately 5,000 characters. For longer texts, use [SSE](./api/tts/sse) or [WebSocket](./api/tts/web-socket).

Reference: https://space.respeecher.com/docs/space/api/tts/bytes

## Authentication

- `X-API-Key` header (required)

## Servers

- `https://api.respeecher.com/v1/public/tts/en-rt` (public-en-rt, default)
- `https://api.respeecher.com/v1/public/tts/ua-rt` (public-ua-rt)

## Request

### Body (application/json)

- `transcript` (string, required) — Text for narration.
- `voice` (object, required) — Voice for narration.
  - `id` (string, required)
  - `sampling_params` (object, optional) — Optional sampling params overrides. The defaults for this voice can be obtained through the [Voices](../voices/list#response.body.sampling_params) endpoint. See also the [Sampling Params Guide](../tts/sampling-params-guide).
    - `seed` (integer, optional) — Generations with the same parameters _including_ a non-null `seed` are identical.
    - `temperature` (double, optional) — Smaller values correspond to more stable but less expressive speech. Must be greater than or equal to 0.
    - `top_k` (integer, optional) — Must be -1 or greater than 0.
    - `top_p` (double, optional) — Must be greater than 0 and less than or equal to 1.
    - `min_p` (double, optional) — Must be between 0 and 1, inclusive.
    - `presence_penalty` (double, optional) — Must be between 0 and 2, inclusive.
    - `repetition_penalty` (double, optional) — Must be between 1 and 2, inclusive.
    - `frequency_penalty` (double, optional) — Must be between 0 and 2, inclusive.
- `output_format` (object, optional) — Audio format specification.
  - `sample_rate` (integer, optional) — Audio sample rate, defaults to 22050.

## Response

### 200

WAV file (16-bit LE PCM).

- File download.

## Examples

**Request**

```json
{
  "transcript": "Hello, World!",
  "voice": {
    "id": "samantha"
  }
}
```

**SDK Code**

```typescript
import { RespeecherClient } from "@respeecher/respeecher-js";

async function main() {
    const client = new RespeecherClient({
        apiKey: "YOUR_API_KEY_HERE",
    });
    await client.tts.bytes({
        transcript: "Hello, World!",
        voice: {
            id: "samantha",
        },
    });
}
main();

```

```python
from respeecher import Respeecher

client = Respeecher(
    api_key="YOUR_API_KEY_HERE",
)

client.tts.bytes(
    transcript="Hello, World!",
    voice={
        "id": "samantha"
    },
)

```

```go
package main

import (
	"fmt"
	"strings"
	"net/http"
	"io"
)

func main() {

	url := "https://api.respeecher.com/v1/public/tts/en-rt/tts/bytes"

	payload := strings.NewReader("{\n  \"transcript\": \"Hello, World!\",\n  \"voice\": {\n    \"id\": \"samantha\"\n  }\n}")

	req, _ := http.NewRequest("POST", url, payload)

	req.Header.Add("X-API-Key", "<ApiKey>")
	req.Header.Add("Content-Type", "application/json")

	res, _ := http.DefaultClient.Do(req)

	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	fmt.Println(res)
	fmt.Println(string(body))

}
```

```ruby
require 'uri'
require 'net/http'

url = URI("https://api.respeecher.com/v1/public/tts/en-rt/tts/bytes")

http = Net::HTTP.new(url.host, url.port)
http.use_ssl = true

request = Net::HTTP::Post.new(url)
request["X-API-Key"] = '<ApiKey>'
request["Content-Type"] = 'application/json'
request.body = "{\n  \"transcript\": \"Hello, World!\",\n  \"voice\": {\n    \"id\": \"samantha\"\n  }\n}"

response = http.request(request)
puts response.read_body
```

```java
import com.mashape.unirest.http.HttpResponse;
import com.mashape.unirest.http.Unirest;

HttpResponse<String> response = Unirest.post("https://api.respeecher.com/v1/public/tts/en-rt/tts/bytes")
  .header("X-API-Key", "<ApiKey>")
  .header("Content-Type", "application/json")
  .body("{\n  \"transcript\": \"Hello, World!\",\n  \"voice\": {\n    \"id\": \"samantha\"\n  }\n}")
  .asString();
```

```php
<?php
require_once('vendor/autoload.php');

$client = new \GuzzleHttp\Client();

$response = $client->request('POST', 'https://api.respeecher.com/v1/public/tts/en-rt/tts/bytes', [
  'body' => '{
  "transcript": "Hello, World!",
  "voice": {
    "id": "samantha"
  }
}',
  'headers' => [
    'Content-Type' => 'application/json',
    'X-API-Key' => '<ApiKey>',
  ],
]);

echo $response->getBody();
```

```csharp
using RestSharp;

var client = new RestClient("https://api.respeecher.com/v1/public/tts/en-rt/tts/bytes");
var request = new RestRequest(Method.POST);
request.AddHeader("X-API-Key", "<ApiKey>");
request.AddHeader("Content-Type", "application/json");
request.AddParameter("application/json", "{\n  \"transcript\": \"Hello, World!\",\n  \"voice\": {\n    \"id\": \"samantha\"\n  }\n}", ParameterType.RequestBody);
IRestResponse response = client.Execute(request);
```

```swift
import Foundation

let headers = [
  "X-API-Key": "<ApiKey>",
  "Content-Type": "application/json"
]
let parameters = [
  "transcript": "Hello, World!",
  "voice": ["id": "samantha"]
] as [String : Any]

let postData = JSONSerialization.data(withJSONObject: parameters, options: [])

let request = NSMutableURLRequest(url: NSURL(string: "https://api.respeecher.com/v1/public/tts/en-rt/tts/bytes")! as URL,
                                        cachePolicy: .useProtocolCachePolicy,
                                    timeoutInterval: 10.0)
request.httpMethod = "POST"
request.allHTTPHeaderFields = headers
request.httpBody = postData as Data

let session = URLSession.shared
let dataTask = session.dataTask(with: request as URLRequest, completionHandler: { (data, response, error) -> Void in
  if (error != nil) {
    print(error as Any)
  } else {
    let httpResponse = response as? HTTPURLResponse
    print(httpResponse)
  }
})

dataTask.resume()
```
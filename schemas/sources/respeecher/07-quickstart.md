> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://space.respeecher.com/docs/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://space.respeecher.com/_mcp/server.

# Quickstart

> Create your first text-to-speech audio.

## Prerequisites

Before you can make any requests, you must first create an API key.
You can create one in the
[Playground](https://space.respeecher.com/api-keys).
The API key must be included in all subsequent requests in the
`X-API-Key` header, including on the WebSocket handshake.

## Obtain a list of available [voices](./api/voices/list)

Before generating audio from your text, you must first select the ID of
the voice you'd like to use. To view a list of available voices, send the
following request:

### Request

GET [https://api.respeecher.com/v1/public/tts/en-rt/voices](https://api.respeecher.com/v1/public/tts/en-rt/voices)

```curl
curl https://api.respeecher.com/v1/public/tts/en-rt/voices \
     -H "X-API-Key: <ApiKey>"
```

```typescript
import { RespeecherClient } from "@respeecher/respeecher-js";

async function main() {
    const client = new RespeecherClient({
        apiKey: "YOUR_API_KEY_HERE",
    });
    await client.voices.list();
}
main();

```

```python
from respeecher import Respeecher

client = Respeecher(
    api_key="YOUR_API_KEY_HERE",
)

client.voices.list()

```

```go
package main

import (
	"fmt"
	"net/http"
	"io"
)

func main() {

	url := "https://api.respeecher.com/v1/public/tts/en-rt/voices"

	req, _ := http.NewRequest("GET", url, nil)

	req.Header.Add("X-API-Key", "<ApiKey>")

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

url = URI("https://api.respeecher.com/v1/public/tts/en-rt/voices")

http = Net::HTTP.new(url.host, url.port)
http.use_ssl = true

request = Net::HTTP::Get.new(url)
request["X-API-Key"] = '<ApiKey>'

response = http.request(request)
puts response.read_body
```

```java
import com.mashape.unirest.http.HttpResponse;
import com.mashape.unirest.http.Unirest;

HttpResponse<String> response = Unirest.get("https://api.respeecher.com/v1/public/tts/en-rt/voices")
  .header("X-API-Key", "<ApiKey>")
  .asString();
```

```php
<?php
require_once('vendor/autoload.php');

$client = new \GuzzleHttp\Client();

$response = $client->request('GET', 'https://api.respeecher.com/v1/public/tts/en-rt/voices', [
  'headers' => [
    'X-API-Key' => '<ApiKey>',
  ],
]);

echo $response->getBody();
```

```csharp
using RestSharp;

var client = new RestClient("https://api.respeecher.com/v1/public/tts/en-rt/voices");
var request = new RestRequest(Method.GET);
request.AddHeader("X-API-Key", "<ApiKey>");
IRestResponse response = client.Execute(request);
```

```swift
import Foundation

let headers = ["X-API-Key": "<ApiKey>"]

let request = NSMutableURLRequest(url: NSURL(string: "https://api.respeecher.com/v1/public/tts/en-rt/voices")! as URL,
                                        cachePolicy: .useProtocolCachePolicy,
                                    timeoutInterval: 10.0)
request.httpMethod = "GET"
request.allHTTPHeaderFields = headers

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

The result should look something like this:

### Response (200)

```json
[
  {
    "id": "samantha",
    "gender": "female",
    "accent": "American",
    "sampling_params": {
      "temperature": 0.6,
      "top_k": -1,
      "top_p": 0.8,
      "min_p": 0,
      "presence_penalty": 0,
      "repetition_penalty": 2,
      "frequency_penalty": 2
    }
  },
  {
    "id": "amara",
    "gender": "female",
    "accent": "Indian",
    "sampling_params": {
      "temperature": 0.7,
      "top_k": 66,
      "top_p": 0.8,
      "min_p": 0,
      "presence_penalty": 0,
      "repetition_penalty": 1.4,
      "frequency_penalty": 0.8
    }
  }
]
```

Our voices are licensed from professional voice actors.
We do not offer voice cloning, and there is no public cloning API—
not directly, and not through any integration.
If you need a voice that is not in the list,
custom voices are available on request:
contact [support@respeecher.com](mailto:support@respeecher.com).

## Generate your first audio with the [Bytes](./api/tts/bytes) endpoint

Now that you have the ID of the voice you would like to use you can make a
POST request to the Bytes endpoint and generate some audio data.
Redirect the output to a file by appending `--output result.wav` or `> result.wav`
to the `curl` command.
The file `result.wav` can then be listened to in any audio player.

### Request

POST [https://api.respeecher.com/v1/public/tts/en-rt/tts/bytes](https://api.respeecher.com/v1/public/tts/en-rt/tts/bytes)

```curl
curl -X POST https://api.respeecher.com/v1/public/tts/en-rt/tts/bytes \
     -H "X-API-Key: <ApiKey>" \
     -H "Content-Type: application/json" \
     -d '{
  "transcript": "Hello, World!",
  "voice": {
    "id": "samantha"
  }
}'
```

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

## Stream audio with the [Server-Sent Events](./api/tts/sse) endpoint

#### Generate the Audio

### Request

POST [https://api.respeecher.com/v1/public/tts/en-rt/tts/sse](https://api.respeecher.com/v1/public/tts/en-rt/tts/sse)

```curl
curl -X POST https://api.respeecher.com/v1/public/tts/en-rt/tts/sse \
     -H "X-API-Key: <ApiKey>" \
     -H "Content-Type: application/json" \
     -d '{
  "transcript": "Hello, World!",
  "voice": {
    "id": "samantha"
  }
}'
```

```typescript
import { RespeecherClient } from "@respeecher/respeecher-js";

async function main() {
    const client = new RespeecherClient({
        apiKey: "YOUR_API_KEY_HERE",
    });
    await client.tts.sse({
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

client.tts.sse(
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

	url := "https://api.respeecher.com/v1/public/tts/en-rt/tts/sse"

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

url = URI("https://api.respeecher.com/v1/public/tts/en-rt/tts/sse")

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

HttpResponse<String> response = Unirest.post("https://api.respeecher.com/v1/public/tts/en-rt/tts/sse")
  .header("X-API-Key", "<ApiKey>")
  .header("Content-Type", "application/json")
  .body("{\n  \"transcript\": \"Hello, World!\",\n  \"voice\": {\n    \"id\": \"samantha\"\n  }\n}")
  .asString();
```

```php
<?php
require_once('vendor/autoload.php');

$client = new \GuzzleHttp\Client();

$response = $client->request('POST', 'https://api.respeecher.com/v1/public/tts/en-rt/tts/sse', [
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

var client = new RestClient("https://api.respeecher.com/v1/public/tts/en-rt/tts/sse");
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

let request = NSMutableURLRequest(url: NSURL(string: "https://api.respeecher.com/v1/public/tts/en-rt/tts/sse")! as URL,
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

The response is a stream of JSON objects:

```json
{"type": "chunk", "data": "..."}
```

Where `data` contains a base64 encoded chunk of 32-bit floating point
numbers.

Save the response data into a file with the name `result.json`.

#### Assemble the chunks into an audio file

The [SSE](./api/tts/sse) endpoint streams the audio data in chunks. This is
useful for real-time playback; however, for this demo, we will use a short
Python script to parse the chunks and assemble them into a complete audio
file.

Note: this example requires both the `soundfile` and `numpy` modules to
run.

```python
import json
import base64
import numpy as np
import soundfile as sf

sample_rate = 22050
infile = "result.json"
outfile = "result.wav"

with open(infile, "r", encoding="utf-8") as f:
    data = [json.loads(line) for line in f]

chunks = []
for chunk in data:
    audio_bytes = base64.b64decode(chunk["data"])
    audio = np.frombuffer(audio_bytes, dtype=np.float32)
    chunks.append(audio)

full_audio = np.concatenate(chunks)
sf.write(outfile, full_audio, sample_rate)
```

#### Listen to the result

You can now enjoy the `result.wav` audio file generated by the script.

## Stream audio via [WebSockets](./api/tts/web-socket)

The API also supports streaming audio via WebSockets. Here is a quick example
implementation of a Python client that supports real-time playback using
the WebSocket endpoint:

```python
import json
import base64
import pyaudio
import numpy as np
from websocket import create_connection

voice = "<the id of the voice you want to use>"

# connect to pyaudio for audio output
pa = pyaudio.PyAudio()
stream = pa.open(
    format=pyaudio.paFloat32, channels=1, rate=22050, output=True
)

# connect to the websocket
ws = create_connection("wss://<endpoint>/tts/websocket", header=["X-Api-Key: <ApiKey>"])

while True:
    # read input
    try:
        text = input("> ")
    except EOFError:
        break

    # send the input text to the websocket
    transcript = json.dumps({
        "transcript": text, "voice": {"id": voice}, "context_id": ""
    })
    ws.send_text(transcript)

    # receive the result
    chunks = []
    while True:
        chunk = json.loads(ws.recv())
        if chunk.get("type") == "done":
            break

        audio_bytes = base64.b64decode(chunk.get("data", b''))
        stream.write(audio_bytes)
```

## Support

#### [Contact us](https://www.respeecher.com/contact)

Have a question about our API? Contact us here.
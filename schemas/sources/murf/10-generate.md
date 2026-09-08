> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://murf.ai/api/docs/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://murf.ai/_mcp/server.

# Synthesize Speech

POST https://api.murf.ai/v1/speech/generate
Content-Type: application/json

Returns a url to the generated audio file along with other associated properties.

Reference: https://murf.ai/api/docs/api-reference/text-to-speech/generate

## Request

### Headers

- `api-key` (string, optional)

### Body (application/json)

- `text` (string, required) — The text that is to be synthesised. e.g. 'Hello there [pause 1s] friend'
- `voiceId` (string, required) — Use the GET /v1/speech/voices API to find supported voiceIds. You can use either the voiceId (e.g. en-US-natalie) or just the voice actor's name (e.g. natalie).
- `audioDuration` (double, optional) — This parameter allows specifying the duration (in seconds) for the generated audio. If the value is 0, this parameter will be ignored. Only available for Gen2 model.
- `channelType` (string, optional, default: MONO) — Valid values: STEREO, MONO
- `encodeAsBase64` (boolean, optional) — Set to true to receive audio in response as a Base64 encoded string instead of a url. This enables zero retention of audio data on Murf's servers.
- `format` (string, optional, default: WAV) — Format of the generated audio file. Valid values: MP3, WAV, FLAC, ALAW, ULAW, PCM, OGG
- `modelVersion` (enum, optional, default: GEN2) — Valid values: GEN2. Audio will be generated using the new and advanced GEN2 model. Outputs from GEN2 sound more natural and high-quality compared to earlier models.
  - Allowed values: `GEN2`
- `locale` (string, optional) — Specifies the language for the generated audio, enabling a voice to speak in multiple languages natively. Only available in the Gen2 model. Valid values: "en-US", "en-UK", "es-ES", etc. Use the GET /v1/speech/voices endpoint to retrieve the list of available voices and languages.
- `pitch` (integer, optional) — Pitch of the voiceover
- `rate` (integer, optional) — Speed of the voiceover
- `sampleRate` (double, optional, default: 44100) — Valid values are 8000, 24000, 44100, 48000
- `style` (string, optional) — The voice style to be used for voiceover generation.
- `variation` (integer, optional, default: 1) — Higher values will add more variation in terms of Pause, Pitch, and Speed to the voice. Only available for Gen2 model.
- `wordDurationsAsOriginalText` (boolean, optional, default: false) — If set to true, the word durations in response will return words as the original input text. (English only)
- `multiNativeLocale` (string, optional, deprecated) — This field is superseded by `locale` field. Please migrate to `locale` field to ensure compatibility with future API versions. Specifies the language for the generated audio, enabling a voice to speak in multiple languages natively. Only available in the Gen2 model. Valid values: "en-US", "en-UK", "es-ES", etc. Use the GET /v1/speech/voices endpoint to retrieve the list of available voices and languages.

## Response

### 200

Ok

- `audioFile` (string, required)
- `audioLengthInSeconds` (double, required)
- `remainingCharacterCount` (long, required) — Remaining number of characters available for synthesis in the current billing cycle.
- `wordDurations` (list of object, required)
  - `endMs` (integer, optional)
  - `startMs` (integer, optional)
  - `word` (string, optional)
  - `pitchScaleMaximum` (double, optional, deprecated) — This field has been deprecated.
  - `pitchScaleMinimum` (double, optional, deprecated) — This field has been deprecated.
  - `sourceWordIndex` (integer, optional, deprecated) — This field has been deprecated.
- `encodedAudio` (string, optional)
- `warning` (string, optional)
- `consumedCharacterCount` (long, optional, deprecated) — Number of characters consumed so far in the current billing cycle.

## Examples

### Different output formats

**Request**

```json
{
  "text": "Hi, How are you doing today?",
  "voiceId": "Natalie",
  "format": "MP3",
  "locale": "en-US",
  "sampleRate": 44100
}
```

**Response**

```json
{
  "audioFile": "https://cdn.murf.ai/audio/1234567890abcdef.mp3",
  "audioLengthInSeconds": 2.5,
  "remainingCharacterCount": 972,
  "wordDurations": [
    {
      "endMs": 300,
      "startMs": 0,
      "word": "Hi,",
      "pitchScaleMaximum": 1.1,
      "pitchScaleMinimum": 1.1,
      "sourceWordIndex": 0
    },
    {
      "endMs": 600,
      "startMs": 301,
      "word": "How",
      "pitchScaleMaximum": 1.1,
      "pitchScaleMinimum": 1.1,
      "sourceWordIndex": 1
    },
    {
      "endMs": 900,
      "startMs": 601,
      "word": "are",
      "pitchScaleMaximum": 1.1,
      "pitchScaleMinimum": 1.1,
      "sourceWordIndex": 2
    },
    {
      "endMs": 1200,
      "startMs": 901,
      "word": "you",
      "pitchScaleMaximum": 1.1,
      "pitchScaleMinimum": 1.1,
      "sourceWordIndex": 3
    },
    {
      "endMs": 1500,
      "startMs": 1201,
      "word": "doing",
      "pitchScaleMaximum": 1.1,
      "pitchScaleMinimum": 1.1,
      "sourceWordIndex": 4
    },
    {
      "endMs": 1800,
      "startMs": 1501,
      "word": "today?",
      "pitchScaleMaximum": 1.1,
      "pitchScaleMinimum": 1.1,
      "sourceWordIndex": 5
    }
  ],
  "encodedAudio": "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=",
  "warning": "",
  "consumedCharacterCount": 28
}
```

**SDK Code**

```python Different output formats
from murf import Murf

client = Murf()

client.text_to_speech.generate(
    format="MP3",
    locale="en-US",
    sample_rate=44100,
    text="Hi, How are you doing today?",
    voice_id="Natalie",
)

```

```javascript Different output formats
const url = 'https://api.murf.ai/v1/speech/generate';
const options = {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: '{"text":"Hi, How are you doing today?","voiceId":"Natalie","format":"MP3","locale":"en-US","sampleRate":44100}'
};

try {
  const response = await fetch(url, options);
  const data = await response.json();
  console.log(data);
} catch (error) {
  console.error(error);
}
```

```go Different output formats
package main

import (
	"fmt"
	"strings"
	"net/http"
	"io"
)

func main() {

	url := "https://api.murf.ai/v1/speech/generate"

	payload := strings.NewReader("{\n  \"text\": \"Hi, How are you doing today?\",\n  \"voiceId\": \"Natalie\",\n  \"format\": \"MP3\",\n  \"locale\": \"en-US\",\n  \"sampleRate\": 44100\n}")

	req, _ := http.NewRequest("POST", url, payload)

	req.Header.Add("Content-Type", "application/json")

	res, _ := http.DefaultClient.Do(req)

	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	fmt.Println(res)
	fmt.Println(string(body))

}
```

```ruby Different output formats
require 'uri'
require 'net/http'

url = URI("https://api.murf.ai/v1/speech/generate")

http = Net::HTTP.new(url.host, url.port)
http.use_ssl = true

request = Net::HTTP::Post.new(url)
request["Content-Type"] = 'application/json'
request.body = "{\n  \"text\": \"Hi, How are you doing today?\",\n  \"voiceId\": \"Natalie\",\n  \"format\": \"MP3\",\n  \"locale\": \"en-US\",\n  \"sampleRate\": 44100\n}"

response = http.request(request)
puts response.read_body
```

```java Different output formats
import com.mashape.unirest.http.HttpResponse;
import com.mashape.unirest.http.Unirest;

HttpResponse<String> response = Unirest.post("https://api.murf.ai/v1/speech/generate")
  .header("Content-Type", "application/json")
  .body("{\n  \"text\": \"Hi, How are you doing today?\",\n  \"voiceId\": \"Natalie\",\n  \"format\": \"MP3\",\n  \"locale\": \"en-US\",\n  \"sampleRate\": 44100\n}")
  .asString();
```

```php Different output formats
<?php
require_once('vendor/autoload.php');

$client = new \GuzzleHttp\Client();

$response = $client->request('POST', 'https://api.murf.ai/v1/speech/generate', [
  'body' => '{
  "text": "Hi, How are you doing today?",
  "voiceId": "Natalie",
  "format": "MP3",
  "locale": "en-US",
  "sampleRate": 44100
}',
  'headers' => [
    'Content-Type' => 'application/json',
  ],
]);

echo $response->getBody();
```

```csharp Different output formats
using RestSharp;

var client = new RestClient("https://api.murf.ai/v1/speech/generate");
var request = new RestRequest(Method.POST);
request.AddHeader("Content-Type", "application/json");
request.AddParameter("application/json", "{\n  \"text\": \"Hi, How are you doing today?\",\n  \"voiceId\": \"Natalie\",\n  \"format\": \"MP3\",\n  \"locale\": \"en-US\",\n  \"sampleRate\": 44100\n}", ParameterType.RequestBody);
IRestResponse response = client.Execute(request);
```

```swift Different output formats
import Foundation

let headers = ["Content-Type": "application/json"]
let parameters = [
  "text": "Hi, How are you doing today?",
  "voiceId": "Natalie",
  "format": "MP3",
  "locale": "en-US",
  "sampleRate": 44100
] as [String : Any]

let postData = JSONSerialization.data(withJSONObject: parameters, options: [])

let request = NSMutableURLRequest(url: NSURL(string: "https://api.murf.ai/v1/speech/generate")! as URL,
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

### Example 2

**Request**

```json
{
  "text": "Hi, How are you doing today?",
  "voiceId": "Natalie",
  "format": "MP3",
  "locale": "en-US",
  "sampleRate": 44100
}
```

**Response**

```json
{
  "audioFile": "https://cdn.murf.ai/audio/1234567890abcdef.mp3",
  "audioLengthInSeconds": 2.5,
  "remainingCharacterCount": 972,
  "wordDurations": [
    {
      "endMs": 300,
      "startMs": 0,
      "word": "Hi,",
      "pitchScaleMaximum": 1.1,
      "pitchScaleMinimum": 1.1,
      "sourceWordIndex": 0
    },
    {
      "endMs": 600,
      "startMs": 301,
      "word": "How",
      "pitchScaleMaximum": 1.1,
      "pitchScaleMinimum": 1.1,
      "sourceWordIndex": 1
    },
    {
      "endMs": 900,
      "startMs": 601,
      "word": "are",
      "pitchScaleMaximum": 1.1,
      "pitchScaleMinimum": 1.1,
      "sourceWordIndex": 2
    },
    {
      "endMs": 1200,
      "startMs": 901,
      "word": "you",
      "pitchScaleMaximum": 1.1,
      "pitchScaleMinimum": 1.1,
      "sourceWordIndex": 3
    },
    {
      "endMs": 1500,
      "startMs": 1201,
      "word": "doing",
      "pitchScaleMaximum": 1.1,
      "pitchScaleMinimum": 1.1,
      "sourceWordIndex": 4
    },
    {
      "endMs": 1800,
      "startMs": 1501,
      "word": "today?",
      "pitchScaleMaximum": 1.1,
      "pitchScaleMinimum": 1.1,
      "sourceWordIndex": 5
    }
  ],
  "encodedAudio": "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=",
  "warning": "",
  "consumedCharacterCount": 28
}
```

**SDK Code**

```python
from murf import Murf

client = Murf()

client.text_to_speech.generate(
    format="MP3",
    locale="en-US",
    sample_rate=44100,
    text="Hi, How are you doing today?",
    voice_id="Natalie",
)

```

```javascript
const url = 'https://api.murf.ai/v1/speech/generate';
const options = {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: '{"text":"Hi, How are you doing today?","voiceId":"Natalie","format":"MP3","locale":"en-US","sampleRate":44100}'
};

try {
  const response = await fetch(url, options);
  const data = await response.json();
  console.log(data);
} catch (error) {
  console.error(error);
}
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

	url := "https://api.murf.ai/v1/speech/generate"

	payload := strings.NewReader("{\n  \"text\": \"Hi, How are you doing today?\",\n  \"voiceId\": \"Natalie\",\n  \"format\": \"MP3\",\n  \"locale\": \"en-US\",\n  \"sampleRate\": 44100\n}")

	req, _ := http.NewRequest("POST", url, payload)

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

url = URI("https://api.murf.ai/v1/speech/generate")

http = Net::HTTP.new(url.host, url.port)
http.use_ssl = true

request = Net::HTTP::Post.new(url)
request["Content-Type"] = 'application/json'
request.body = "{\n  \"text\": \"Hi, How are you doing today?\",\n  \"voiceId\": \"Natalie\",\n  \"format\": \"MP3\",\n  \"locale\": \"en-US\",\n  \"sampleRate\": 44100\n}"

response = http.request(request)
puts response.read_body
```

```java
import com.mashape.unirest.http.HttpResponse;
import com.mashape.unirest.http.Unirest;

HttpResponse<String> response = Unirest.post("https://api.murf.ai/v1/speech/generate")
  .header("Content-Type", "application/json")
  .body("{\n  \"text\": \"Hi, How are you doing today?\",\n  \"voiceId\": \"Natalie\",\n  \"format\": \"MP3\",\n  \"locale\": \"en-US\",\n  \"sampleRate\": 44100\n}")
  .asString();
```

```php
<?php
require_once('vendor/autoload.php');

$client = new \GuzzleHttp\Client();

$response = $client->request('POST', 'https://api.murf.ai/v1/speech/generate', [
  'body' => '{
  "text": "Hi, How are you doing today?",
  "voiceId": "Natalie",
  "format": "MP3",
  "locale": "en-US",
  "sampleRate": 44100
}',
  'headers' => [
    'Content-Type' => 'application/json',
  ],
]);

echo $response->getBody();
```

```csharp
using RestSharp;

var client = new RestClient("https://api.murf.ai/v1/speech/generate");
var request = new RestRequest(Method.POST);
request.AddHeader("Content-Type", "application/json");
request.AddParameter("application/json", "{\n  \"text\": \"Hi, How are you doing today?\",\n  \"voiceId\": \"Natalie\",\n  \"format\": \"MP3\",\n  \"locale\": \"en-US\",\n  \"sampleRate\": 44100\n}", ParameterType.RequestBody);
IRestResponse response = client.Execute(request);
```

```swift
import Foundation

let headers = ["Content-Type": "application/json"]
let parameters = [
  "text": "Hi, How are you doing today?",
  "voiceId": "Natalie",
  "format": "MP3",
  "locale": "en-US",
  "sampleRate": 44100
] as [String : Any]

let postData = JSONSerialization.data(withJSONObject: parameters, options: [])

let request = NSMutableURLRequest(url: NSURL(string: "https://api.murf.ai/v1/speech/generate")! as URL,
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
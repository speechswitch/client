> ## Documentation Index
> Fetch the complete documentation index at: https://typecast.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Streaming Text To Speech

> Generate speech from text using real-time streaming, allowing audio playback to begin before the entire synthesis is complete.

This endpoint streams audio data in chunks, enabling low-latency audio playback for applications requiring immediate feedback.

**Streaming Format:**
- **WAV format**: First chunk contains WAV header (size=0xFFFFFFFF for streaming) followed by raw PCM data. Subsequent chunks contain only PCM data.
- **MP3 format**: Each chunk contains post-processed MP3 data that can be decoded independently.

**Use Cases:**
- Conversational AI, chatbots and real-time voice assistants
- Interactive applications requiring immediate audio feedback
- Long-form content where waiting for full synthesis is impractical

**Request Parameters:**
Uses the same TTSRequest schema as the standard TTS endpoint. Set `output.audio_format` to "wav" or "mp3" to control the streaming format.
```

## OpenAPI

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "Typecast API",
    "x-logo": {
      "url": "https://typecast.ai/_ipx/_/image/logo/tc_logo.webp"
    },
    "version": "0.1.2"
  },
  "servers": [
    {
      "url": "https://api.typecast.ai",
      "description": "Production server"
    }
  ],
  "security": [
    {
      "ApiKeyAuth": []
    }
  ],
  "paths": {
    "/v1/text-to-speech/stream": {
      "post": {
        "tags": [
          "Text-to-Speech"
        ],
        "x-mint": {
          "href": "/api-reference/text-to-speech/streaming-text-to-speech"
        },
        "summary": "Streaming Text To Speech",
        "responses": {
          "200": {
            "content": {
              "audio/wav": {
                "schema": {
                  "type": "string",
                  "format": "binary",
                  "description": "Chunked WAV audio stream (16-bit, mono, 32000 Hz). First chunk includes WAV header with size 0xFFFFFFFF (indicating streaming), followed by raw PCM data. Subsequent chunks contain only PCM data."
                },
                "example": "[Binary audio stream - WAV chunks]"
              },
              "audio/mpeg": {
                "schema": {
                  "type": "string",
                  "format": "binary",
                  "description": "Chunked MP3 audio stream. Each chunk contains valid MP3 frames that can be decoded and played independently."
                },
                "example": "[Binary audio stream - MP3 chunks]"
              }
            },
            "description": "Success - Returns streaming audio data in chunks"
          },
          "400": {
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                },
                "example": {
                  "detail": "Invalid voice_id"
                }
              }
            },
            "description": "Bad Request - Invalid parameters"
          },
          "401": {
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                },
                "example": {
                  "detail": "Invalid API key"
                }
              }
            },
            "description": "Unauthorized - Authentication failed"
          },
          "402": {
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                },
                "example": {
                  "detail": "Insufficient credit"
                }
              }
            },
            "description": "Payment Required - Insufficient credits"
          },
          "404": {
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                },
                "example": {
                  "detail": "Voice not found"
                }
              }
            },
            "description": "Not Found - Voice model not available"
          },
          "422": {
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                },
                "example": {
                  "message": "The input text contains characters or symbols that cannot be synthesized into speech. Please check your input text.",
                  "error_code": "TEXT_NOT_SYNTHESIZABLE"
                }
              }
            },
            "description": "Validation Error - The request is invalid or the input text cannot be synthesized.\nInput errors detected before streaming starts return `TEXT_NOT_SYNTHESIZABLE`. After the streaming response has started, its HTTP status can no longer be changed."
          },
          "429": {
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                },
                "example": {
                  "detail": "Too many requests"
                }
              }
            },
            "description": "Too Many Requests - Rate limit exceeded"
          },
          "500": {
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                },
                "example": {
                  "detail": "An unexpected error occurred"
                }
              }
            },
            "description": "Internal Server Error - Server processing failed"
          }
        },
        "description": "Generate speech from text using real-time streaming, allowing audio playback to begin before the entire synthesis is complete.\n\nThis endpoint streams audio data in chunks, enabling low-latency audio playback for applications requiring immediate feedback.\n\n**Streaming Format:**\n- **WAV format**: First chunk contains WAV header (size=0xFFFFFFFF for streaming) followed by raw PCM data. Subsequent chunks contain only PCM data.\n- **MP3 format**: Each chunk contains post-processed MP3 data that can be decoded independently.\n\n**Use Cases:**\n- Conversational AI, chatbots and real-time voice assistants\n- Interactive applications requiring immediate audio feedback\n- Long-form content where waiting for full synthesis is impractical\n\n**Request Parameters:**\nUses the same TTSRequest schema as the standard TTS endpoint. Set `output.audio_format` to \"wav\" or \"mp3\" to control the streaming format.\n```",
        "operationId": "text_to_speech_stream_v1_text_to_speech_stream_post",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/TTSRequestStreamStream"
              }
            }
          },
          "required": true
        },
        "x-codeSamples": [
          {
            "lang": "cURL",
            "label": "cURL (stream + play)",
            "source": "# Pipe streaming audio directly into ffplay for real-time playback.\n# Requires: ffmpeg (brew/choco/apt install ffmpeg)\ncurl -N -s --request POST \\\n  --url https://api.typecast.ai/v1/text-to-speech/stream \\\n  --header 'Content-Type: application/json' \\\n  --header 'X-API-KEY: <api-key>' \\\n  --data @- <<EOF | ffplay -autoexit -nodisp -loglevel error -i pipe:0\n{\n  \"voice_id\": \"tc_60e5426de8b95f1d3000d7b5\",\n  \"text\": \"Thanks for reaching out. Your reservation has been confirmed for Friday at 7 PM.\",\n  \"model\": \"ssfm-v30\"\n}\nEOF\n"
          },
          {
            "lang": "Python",
            "label": "Python (requests + sounddevice)",
            "source": "# Real-time playback using sounddevice (pip install requests sounddevice).\n# Streaming WAV format: 32000 Hz, 16-bit, mono — skip the 44-byte\n# WAV header and feed raw PCM samples to the audio output.\nimport requests\nimport sounddevice as sd\n\nAPI_HOST = \"https://api.typecast.ai\"\nheaders = {\"X-API-KEY\": \"<api-key>\", \"Content-Type\": \"application/json\"}\npayload = {\n    \"voice_id\": \"tc_60e5426de8b95f1d3000d7b5\",\n    \"text\": \"Thanks for reaching out. Your reservation has been confirmed for Friday at 7 PM.\",\n    \"model\": \"ssfm-v30\",\n}\n\nresp = requests.post(\n    f\"{API_HOST}/v1/text-to-speech/stream\",\n    headers=headers, json=payload, stream=True, timeout=60,\n)\nresp.raise_for_status()\n\nwith sd.RawOutputStream(samplerate=32000, channels=1, dtype=\"int16\") as player:\n    buf, first = bytearray(), True\n    for chunk in resp.iter_content(chunk_size=4096):\n        if not chunk:\n            continue\n        if first:\n            chunk = chunk[44:]  # strip WAV header\n            first = False\n        buf.extend(chunk)\n        # Write 2-byte-aligned slices (int16 samples).\n        n = len(buf) - (len(buf) % 2)\n        if n:\n            player.write(bytes(buf[:n]))\n            del buf[:n]\n\nprint(\"Playback completed\")\n"
          },
          {
            "lang": "C#",
            "label": "C# (HttpClient + ffplay)",
            "source": "// Real-time playback by piping the stream into ffplay.\n// Requires: ffmpeg (brew/choco/apt install ffmpeg)\nusing System;\nusing System.Diagnostics;\nusing System.Net.Http;\nusing System.Text;\nusing System.Threading.Tasks;\n\nvar client = new HttpClient();\nclient.DefaultRequestHeaders.Add(\"X-API-KEY\", \"<api-key>\");\n\nvar requestBody = @\"{\n  \"\"voice_id\"\": \"\"tc_60e5426de8b95f1d3000d7b5\"\",\n  \"\"text\"\": \"\"Thanks for reaching out. Your reservation has been confirmed for Friday at 7 PM.\"\",\n  \"\"model\"\": \"\"ssfm-v30\"\"\n}\";\n\nvar ffplay = new Process\n{\n    StartInfo = new ProcessStartInfo\n    {\n        FileName = \"ffplay\",\n        Arguments = \"-autoexit -nodisp -loglevel error -i pipe:0\",\n        RedirectStandardInput = true,\n        UseShellExecute = false,\n    }\n};\nffplay.Start();\n\nvar request = new HttpRequestMessage(HttpMethod.Post, \"https://api.typecast.ai/v1/text-to-speech/stream\")\n{\n    Content = new StringContent(requestBody, Encoding.UTF8, \"application/json\")\n};\n\n// ResponseHeadersRead enables true streaming (avoids full buffering).\nusing var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);\nresponse.EnsureSuccessStatusCode();\nusing var stream = await response.Content.ReadAsStreamAsync();\nawait stream.CopyToAsync(ffplay.StandardInput.BaseStream);\nffplay.StandardInput.Close();\nawait ffplay.WaitForExitAsync();\n"
          },
          {
            "lang": "Kotlin",
            "label": "Kotlin (OkHttp + ffplay)",
            "source": "// Real-time playback by piping the OkHttp response stream into ffplay.\n// Requires: ffmpeg (brew/choco/apt install ffmpeg)\n// For Android, replace the ffplay Process with AudioTrack + raw PCM feed.\nimport okhttp3.MediaType.Companion.toMediaType\nimport okhttp3.OkHttpClient\nimport okhttp3.Request\nimport okhttp3.RequestBody.Companion.toRequestBody\n\nval ffplay = ProcessBuilder(\n    \"ffplay\", \"-autoexit\", \"-nodisp\", \"-loglevel\", \"error\", \"-i\", \"pipe:0\"\n).redirectError(ProcessBuilder.Redirect.DISCARD).start()\n\nval client = OkHttpClient()\nval body = \"\"\"\n{\n  \"voice_id\": \"tc_60e5426de8b95f1d3000d7b5\",\n  \"text\": \"Thanks for reaching out. Your reservation has been confirmed for Friday at 7 PM.\",\n  \"model\": \"ssfm-v30\"\n}\n\"\"\".trimIndent().toRequestBody(\"application/json\".toMediaType())\n\nval request = Request.Builder()\n    .url(\"https://api.typecast.ai/v1/text-to-speech/stream\")\n    .addHeader(\"X-API-KEY\", \"<api-key>\")\n    .post(body)\n    .build()\n\nclient.newCall(request).execute().use { response ->\n    response.body?.byteStream()?.use { input -> input.copyTo(ffplay.outputStream) }\n}\nffplay.outputStream.close()\nffplay.waitFor()\n"
          },
          {
            "lang": "C++",
            "label": "C++ (libcurl + ffplay)",
            "source": "// Real-time playback: libcurl write callback pipes each chunk into\n// ffplay via popen. Requires: ffmpeg (brew/choco/apt install ffmpeg)\n#include <curl/curl.h>\n#include <cstdio>\n#include <string>\n\nstatic FILE* player = nullptr;\n\nsize_t cb(void* ptr, size_t size, size_t nmemb, void*) {\n    return fwrite(ptr, size, nmemb, player);\n}\n\nint main() {\n    player = popen(\"ffplay -autoexit -nodisp -loglevel error -i pipe:0\", \"w\");\n\n    CURL* curl = curl_easy_init();\n    struct curl_slist* headers = nullptr;\n    headers = curl_slist_append(headers, \"Content-Type: application/json\");\n    headers = curl_slist_append(headers, \"X-API-KEY: <api-key>\");\n\n    std::string body = R\"({\n        \"voice_id\": \"tc_60e5426de8b95f1d3000d7b5\",\n        \"text\": \"Thanks for reaching out. Your reservation has been confirmed for Friday at 7 PM.\",\n        \"model\": \"ssfm-v30\"\n    })\";\n\n    curl_easy_setopt(curl, CURLOPT_URL, \"https://api.typecast.ai/v1/text-to-speech/stream\");\n    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);\n    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());\n    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, cb);\n\n    curl_easy_perform(curl);\n\n    curl_slist_free_all(headers);\n    curl_easy_cleanup(curl);\n    pclose(player);\n    return 0;\n}\n"
          },
          {
            "lang": "C",
            "label": "C (libcurl + ffplay)",
            "source": "/* Real-time playback: libcurl write callback pipes each chunk into\n * ffplay via popen. Requires: ffmpeg (brew/choco/apt install ffmpeg) */\n#include <stdio.h>\n#include <curl/curl.h>\n\nstatic FILE* player = NULL;\n\nsize_t cb(void* ptr, size_t size, size_t nmemb, void* ud) {\n    (void)ud;\n    return fwrite(ptr, size, nmemb, player);\n}\n\nint main(void) {\n    player = popen(\"ffplay -autoexit -nodisp -loglevel error -i pipe:0\", \"w\");\n\n    curl_global_init(CURL_GLOBAL_ALL);\n    CURL* curl = curl_easy_init();\n\n    struct curl_slist* headers = NULL;\n    headers = curl_slist_append(headers, \"Content-Type: application/json\");\n    headers = curl_slist_append(headers, \"X-API-KEY: <api-key>\");\n\n    const char* body =\n        \"{\"\n        \"\\\"voice_id\\\":\\\"tc_60e5426de8b95f1d3000d7b5\\\",\"\n        \"\\\"text\\\":\\\"Thanks for reaching out. Your reservation has been confirmed for Friday at 7 PM.\\\",\"\n        \"\\\"model\\\":\\\"ssfm-v30\\\"\"\n        \"}\";\n\n    curl_easy_setopt(curl, CURLOPT_URL, \"https://api.typecast.ai/v1/text-to-speech/stream\");\n    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);\n    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body);\n    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, cb);\n\n    curl_easy_perform(curl);\n\n    curl_slist_free_all(headers);\n    curl_easy_cleanup(curl);\n    curl_global_cleanup();\n    pclose(player);\n    return 0;\n}\n"
          },
          {
            "lang": "Swift",
            "label": "Swift (URLSession + ffplay)",
            "source": "// Real-time playback (macOS): pipe URLSession bytes into ffplay via\n// Process. Requires: ffmpeg (brew install ffmpeg).\n// Requires iOS 15 / macOS 12 for URLSession.bytes(for:).\n// Compile with: swiftc -parse-as-library main.swift -o streaming_tts\n// For iOS, replace Process/ffplay with AVAudioEngine + scheduled PCM buffers.\nimport Foundation\n\n@main\nstruct StreamingTTS {\n    static func main() async throws {\n        let ffplay = Process()\n        ffplay.executableURL = URL(fileURLWithPath: \"/usr/bin/env\")\n        ffplay.arguments = [\"ffplay\", \"-autoexit\", \"-nodisp\", \"-loglevel\", \"error\", \"-i\", \"pipe:0\"]\n        let pipe = Pipe()\n        ffplay.standardInput = pipe\n        try ffplay.run()\n\n        var request = URLRequest(url: URL(string: \"https://api.typecast.ai/v1/text-to-speech/stream\")!)\n        request.httpMethod = \"POST\"\n        request.setValue(\"application/json\", forHTTPHeaderField: \"Content-Type\")\n        request.setValue(\"<api-key>\", forHTTPHeaderField: \"X-API-KEY\")\n        request.httpBody = try JSONSerialization.data(withJSONObject: [\n            \"voice_id\": \"tc_60e5426de8b95f1d3000d7b5\",\n            \"text\": \"Thanks for reaching out. Your reservation has been confirmed for Friday at 7 PM.\",\n            \"model\": \"ssfm-v30\",\n        ])\n\n        let (bytes, _) = try await URLSession.shared.bytes(for: request)\n        var buffer = Data()\n        buffer.reserveCapacity(4096)\n        for try await byte in bytes {\n            buffer.append(byte)\n            if buffer.count >= 4096 {\n                try pipe.fileHandleForWriting.write(contentsOf: buffer)\n                buffer.removeAll(keepingCapacity: true)\n            }\n        }\n        if !buffer.isEmpty {\n            try pipe.fileHandleForWriting.write(contentsOf: buffer)\n        }\n        try pipe.fileHandleForWriting.close()\n        ffplay.waitUntilExit()\n    }\n}\n"
          },
          {
            "lang": "Rust",
            "label": "Rust (reqwest + ffplay)",
            "source": "// Real-time playback: pipe reqwest stream into ffplay via tokio Command.\n// Requires: ffmpeg (brew/choco/apt install ffmpeg)\n// Cargo.toml:\n//   reqwest = { version = \"0.12\", features = [\"json\", \"stream\"] }\n//   tokio   = { version = \"1\", features = [\"full\"] }\n//   serde_json = \"1\"\nuse reqwest;\nuse serde_json::json;\nuse std::process::Stdio;\nuse tokio::io::AsyncWriteExt;\nuse tokio::process::Command;\n\n#[tokio::main]\nasync fn main() -> Result<(), Box<dyn std::error::Error>> {\n    let mut ffplay = Command::new(\"ffplay\")\n        .args([\"-autoexit\", \"-nodisp\", \"-loglevel\", \"error\", \"-i\", \"pipe:0\"])\n        .stdin(Stdio::piped())\n        .spawn()?;\n    let mut stdin = ffplay.stdin.take().expect(\"failed to open ffplay stdin\");\n\n    let client = reqwest::Client::new();\n    let body = json!({\n        \"voice_id\": \"tc_60e5426de8b95f1d3000d7b5\",\n        \"text\": \"Thanks for reaching out. Your reservation has been confirmed for Friday at 7 PM.\",\n        \"model\": \"ssfm-v30\"\n    });\n\n    let mut response = client\n        .post(\"https://api.typecast.ai/v1/text-to-speech/stream\")\n        .header(\"X-API-KEY\", \"<api-key>\")\n        .header(\"Content-Type\", \"application/json\")\n        .json(&body)\n        .send()\n        .await?;\n\n    while let Some(chunk) = response.chunk().await? {\n        stdin.write_all(&chunk).await?;\n    }\n    drop(stdin);\n    ffplay.wait().await?;\n    Ok(())\n}\n"
          },
          {
            "lang": "JavaScript",
            "label": "JavaScript (Node.js + ffplay)",
            "source": "// Node 18+ (built-in fetch). Pipe streamed audio into ffplay.\n// Requires: ffmpeg (brew/choco/apt install ffmpeg)\nimport { spawn } from \"node:child_process\";\n\nconst ffplay = spawn(\n    \"ffplay\",\n    [\"-autoexit\", \"-nodisp\", \"-loglevel\", \"error\", \"-i\", \"pipe:0\"],\n    { stdio: [\"pipe\", \"ignore\", \"ignore\"] },\n);\n\nconst response = await fetch(\"https://api.typecast.ai/v1/text-to-speech/stream\", {\n    method: \"POST\",\n    headers: {\n        \"Content-Type\": \"application/json\",\n        \"X-API-KEY\": \"<api-key>\",\n    },\n    body: JSON.stringify({\n        voice_id: \"tc_60e5426de8b95f1d3000d7b5\",\n        text: \"Thanks for reaching out. Your reservation has been confirmed for Friday at 7 PM.\",\n        model: \"ssfm-v30\",\n    }),\n});\nif (!response.ok) throw new Error(`HTTP ${response.status}`);\n\n// fetch().body is a Web ReadableStream — read chunks as they arrive.\nconst reader = response.body.getReader();\nwhile (true) {\n    const { value, done } = await reader.read();\n    if (done) break;\n    ffplay.stdin.write(value);\n}\nffplay.stdin.end();\nawait new Promise((resolve) => ffplay.on(\"close\", resolve));\n"
          },
          {
            "lang": "PHP",
            "label": "PHP (curl + ffplay)",
            "source": "<?php\n// Pipes the libcurl write callback straight into ffplay's stdin.\n// Requires: ffmpeg (brew/choco/apt install ffmpeg)\n$ffplay = popen(\"ffplay -autoexit -nodisp -loglevel error -i pipe:0\", \"w\");\n\n$payload = json_encode([\n    \"voice_id\" => \"tc_60e5426de8b95f1d3000d7b5\",\n    \"text\" => \"Thanks for reaching out. Your reservation has been confirmed for Friday at 7 PM.\",\n    \"model\" => \"ssfm-v30\",\n]);\n\n$ch = curl_init(\"https://api.typecast.ai/v1/text-to-speech/stream\");\ncurl_setopt_array($ch, [\n    CURLOPT_POST => true,\n    CURLOPT_HTTPHEADER => [\n        \"Content-Type: application/json\",\n        \"X-API-KEY: <api-key>\",\n    ],\n    CURLOPT_POSTFIELDS => $payload,\n    CURLOPT_WRITEFUNCTION => function ($ch, $data) use ($ffplay) {\n        fwrite($ffplay, $data);\n        return strlen($data);\n    },\n]);\ncurl_exec($ch);\npclose($ffplay);\n"
          },
          {
            "lang": "Go",
            "label": "Go (net/http + ffplay)",
            "source": "// Pipes the streaming response body into ffplay's stdin.\n// Requires: ffmpeg (brew/choco/apt install ffmpeg)\npackage main\n\nimport (\n    \"bytes\"\n    \"io\"\n    \"net/http\"\n    \"os/exec\"\n)\n\nfunc main() {\n    ffplay := exec.Command(\"ffplay\", \"-autoexit\", \"-nodisp\", \"-loglevel\", \"error\", \"-i\", \"pipe:0\")\n    stdin, _ := ffplay.StdinPipe()\n    if err := ffplay.Start(); err != nil {\n        panic(err)\n    }\n\n    body := []byte(`{\n        \"voice_id\": \"tc_60e5426de8b95f1d3000d7b5\",\n        \"text\": \"Thanks for reaching out. Your reservation has been confirmed for Friday at 7 PM.\",\n        \"model\": \"ssfm-v30\"\n    }`)\n\n    req, _ := http.NewRequest(\"POST\", \"https://api.typecast.ai/v1/text-to-speech/stream\", bytes.NewReader(body))\n    req.Header.Set(\"Content-Type\", \"application/json\")\n    req.Header.Set(\"X-API-KEY\", \"<api-key>\")\n\n    resp, err := http.DefaultClient.Do(req)\n    if err != nil {\n        panic(err)\n    }\n    defer resp.Body.Close()\n\n    io.Copy(stdin, resp.Body)\n    stdin.Close()\n    ffplay.Wait()\n}\n"
          },
          {
            "lang": "Java",
            "label": "Java (HttpClient + ffplay)",
            "source": "// Java 11+ HttpClient with InputStream body handler.\n// Pipes the streaming response into ffplay's stdin.\n// Requires: ffmpeg (brew/choco/apt install ffmpeg)\nimport java.net.URI;\nimport java.net.http.HttpClient;\nimport java.net.http.HttpRequest;\nimport java.net.http.HttpResponse;\nimport java.io.InputStream;\nimport java.io.OutputStream;\n\npublic class StreamingTTS {\n    public static void main(String[] args) throws Exception {\n        Process ffplay = new ProcessBuilder(\n                \"ffplay\", \"-autoexit\", \"-nodisp\", \"-loglevel\", \"error\", \"-i\", \"pipe:0\")\n                .redirectError(ProcessBuilder.Redirect.DISCARD)\n                .start();\n\n        String body = \"\"\"\n            {\n              \"voice_id\": \"tc_60e5426de8b95f1d3000d7b5\",\n              \"text\": \"Thanks for reaching out. Your reservation has been confirmed for Friday at 7 PM.\",\n              \"model\": \"ssfm-v30\"\n            }\n            \"\"\";\n\n        HttpRequest request = HttpRequest.newBuilder()\n                .uri(URI.create(\"https://api.typecast.ai/v1/text-to-speech/stream\"))\n                .header(\"Content-Type\", \"application/json\")\n                .header(\"X-API-KEY\", \"<api-key>\")\n                .POST(HttpRequest.BodyPublishers.ofString(body))\n                .build();\n\n        HttpResponse<InputStream> response = HttpClient.newHttpClient()\n                .send(request, HttpResponse.BodyHandlers.ofInputStream());\n\n        try (InputStream in = response.body();\n             OutputStream out = ffplay.getOutputStream()) {\n            in.transferTo(out);\n        }\n        ffplay.waitFor();\n    }\n}\n"
          },
          {
            "lang": "Ruby",
            "label": "Ruby (net/http + ffplay)",
            "source": "# Pipes the streaming response into ffplay via IO.popen.\n# Requires: ffmpeg (brew/choco/apt install ffmpeg)\nrequire \"net/http\"\nrequire \"uri\"\nrequire \"json\"\n\nffplay = IO.popen(\n  [\"ffplay\", \"-autoexit\", \"-nodisp\", \"-loglevel\", \"error\", \"-i\", \"pipe:0\"],\n  \"wb\",\n)\n\nuri = URI(\"https://api.typecast.ai/v1/text-to-speech/stream\")\nhttp = Net::HTTP.new(uri.host, uri.port)\nhttp.use_ssl = true\n\nreq = Net::HTTP::Post.new(uri)\nreq[\"Content-Type\"] = \"application/json\"\nreq[\"X-API-KEY\"] = \"<api-key>\"\nreq.body = {\n  voice_id: \"tc_60e5426de8b95f1d3000d7b5\",\n  text: \"Thanks for reaching out. Your reservation has been confirmed for Friday at 7 PM.\",\n  model: \"ssfm-v30\",\n}.to_json\n\nhttp.request(req) do |response|\n  response.read_body { |chunk| ffplay.write(chunk) }\nend\n\nffplay.close\n"
          }
        ]
      }
    }
  },
  "components": {
    "schemas": {
      "Limits": {
        "type": "object",
        "title": "Limits",
        "required": [
          "concurrency_limit"
        ],
        "properties": {
          "concurrency_limit": {
            "type": "integer",
            "title": "Concurrency Limit",
            "description": "Maximum number of concurrent requests allowed"
          },
          "custom_voice_slot": {
            "type": "integer",
            "title": "Custom Voice Slot",
            "default": 0,
            "minimum": 0,
            "description": "Maximum number of custom voices (created via instant cloning) allowed on the current plan."
          },
          "professional_voice_slot": {
            "type": "integer",
            "title": "Professional Voice Slot",
            "default": 0,
            "minimum": 0,
            "description": "프리미엄 클로닝 보이스 슬롯 한도"
          }
        },
        "description": "Usage limit information"
      },
      "Output": {
        "type": "object",
        "title": "Output",
        "properties": {
          "volume": {
            "anyOf": [
              {
                "type": "integer",
                "maximum": 200,
                "minimum": 0
              },
              {
                "type": "null"
              }
            ],
            "title": "Volume",
            "example": 100,
            "description": "Adjusts the relative volume of the output audio: 0 (completely silent), 50 (half volume), 100 (standard volume, default), 150 (50% louder than standard), 200 (maximum volume, twice as loud as standard).\n\nSince this only scales the existing volume, using `volume` can amplify the loudness differences between voices if they have different baseline levels. For consistent output across all clips, use `target_lufs` instead.\n\n- **Note:** This parameter cannot be used simultaneously with the `target_lufs` parameter.\n\nRequired range: 0 <= x <= 200\n"
          },
          "audio_pitch": {
            "type": "integer",
            "title": "Audio Pitch",
            "default": 0,
            "example": 0,
            "maximum": 12,
            "minimum": -12,
            "description": "Adjusts the pitch in semitones to affect perceived gender and age: -12 (one octave lower, deeper voice), -6 (half octave lower), 0 (original pitch, default), +6 (half octave higher), +12 (one octave higher, higher voice)"
          },
          "audio_tempo": {
            "type": "number",
            "title": "Audio Tempo",
            "default": 1,
            "example": 1,
            "maximum": 2,
            "minimum": 0.5,
            "description": "Controls speech speed: 0.5 (half speed, very slow and clear), 0.75 (slightly slower than normal), 1.0 (normal speaking speed, default), 1.5 (50% faster than normal), 2.0 (double speed, very fast speech)"
          },
          "target_lufs": {
            "type": "number",
            "anyOf": [
              {
                "type": "number",
                "maximum": 0,
                "minimum": -70
              },
              {
                "type": "null"
              }
            ],
            "title": "Target Lufs",
            "example": -14,
            "description": "Sets the target absolute loudness (LUFS) for the output audio. This normalizes all generated voices to a consistent volume level, regardless of the original source's loudness. Values closer to 0 are louder, while values closer to -70 are quieter.\n\n- Required range: -70 <= x <= 0\n- Recommended values: -14 (common streaming standard), -23 (broadcast standard)\n- **Note:** This parameter cannot be used simultaneously with the `volume` parameter. Use `target_lufs` for consistent absolute loudness across different clips, or use `volume` for traditional relative scaling.\n"
          },
          "audio_format": {
            "enum": [
              "wav",
              "mp3"
            ],
            "type": "string",
            "title": "Audio Format",
            "default": "wav",
            "example": "wav",
            "description": "Output audio format.\n\n**WAV format:**\n- Uncompressed PCM audio\n- 16-bit depth, mono channel, 44100 Hz sample rate\n- Higher quality, larger file size\n- Recommended for professional audio production\n\n**MP3 format:**\n- Compressed MPEG Layer III audio\n- 320 kbps bitrate, 44100 Hz sample rate\n- Smaller file size\n- Recommended for web streaming and distribution\n"
          }
        },
        "description": "Audio output settings for controlling the final audio characteristics"
      },
      "Prompt": {
        "title": "Prompt (ssfm-v21)",
        "properties": {
          "emotion_preset": {
            "example": "normal",
            "description": "Emotion preset to apply.\n\nSupported emotions for ssfm-v21: normal, happy, sad, angry\n\nCheck available emotions for each voice through the /v2/voices API.\n"
          },
          "emotion_intensity": {
            "example": 1,
            "description": "Controls the strength of emotional expression (0.0 to 2.0).\n\n- 0.0: Completely neutral\n- 1.0: Standard expression (default)\n- 2.0: Maximum intensity\n"
          }
        },
        "description": "Emotion and style settings for the generated speech."
      },
      "AgeEnum": {
        "enum": [
          "child",
          "teenager",
          "young_adult",
          "middle_age",
          "elder"
        ],
        "type": "string",
        "title": "AgeEnum",
        "description": "Age group classification enum - Converts database values (Korean) to API values (English).\n\nAvailable values:\n- **child**: Child voice (under 12 years old)\n- **teenager**: Teenage voice (13-19 years old)\n- **young_adult**: Young adult voice (20-35 years old)\n- **middle_age**: Middle-aged voice (36-60 years old)\n- **elder**: Elder voice (over 60 years old)\n"
      },
      "Credits": {
        "type": "object",
        "title": "Credits",
        "required": [
          "plan_credits",
          "used_credits"
        ],
        "properties": {
          "plan_credits": {
            "type": "integer",
            "title": "Plan Credits",
            "description": "Total monthly credits provided by the plan"
          },
          "used_credits": {
            "type": "integer",
            "title": "Used Credits",
            "description": "Number of credits used"
          }
        },
        "description": "Credit usage information"
      },
      "VoiceV2": {
        "type": "object",
        "title": "VoiceV2",
        "required": [
          "voice_id",
          "voice_name",
          "models",
          "voice_type"
        ],
        "properties": {
          "age": {
            "anyOf": [
              {
                "$ref": "#/components/schemas/AgeEnum"
              },
              {
                "type": "null"
              }
            ],
            "description": "Voice age group classification (child/teenager/young_adult/middle_age/elder)"
          },
          "gender": {
            "anyOf": [
              {
                "$ref": "#/components/schemas/GenderEnum"
              },
              {
                "type": "null"
              }
            ],
            "description": "Voice gender classification (male/female)"
          },
          "models": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/ModelInfo"
            },
            "title": "Models",
            "description": "List of supported TTS models with their available emotions (e.g., [{'version': 'ssfm-v21', 'emotions': ['happy', 'sad']}])"
          },
          "voice_id": {
            "type": "string",
            "title": "Voice Id",
            "description": "Unique voice identifier. Built-in voices use the `tc_` prefix (e.g., `tc_60e5426de8b95f1d3000d7b5`); cloned custom voices created via `POST /v1/voices/clone` use the `uc_` prefix and are also returned by `/v2/voices` for the owner."
          },
          "use_cases": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "title": "Use Cases",
            "description": "List of use case categories this voice is suitable for"
          },
          "voice_name": {
            "type": "string",
            "title": "Voice Name",
            "description": "Human-readable name of the voice"
          },
          "voice_type": {
            "$ref": "#/components/schemas/VoiceType",
            "description": "Voice type — `original` for Typecast-provided stock voices, `custom` for user-cloned voices."
          }
        },
        "description": "V2 Voice response model with model-grouped emotions and enhanced metadata"
      },
      "VoiceV3": {
        "type": "object",
        "title": "VoiceV3",
        "required": [
          "voice_id",
          "voice_name",
          "voice_type",
          "models"
        ],
        "properties": {
          "age": {
            "anyOf": [
              {
                "$ref": "#/components/schemas/AgeEnum"
              },
              {
                "type": "null"
              }
            ],
            "description": "Voice age group."
          },
          "gender": {
            "anyOf": [
              {
                "$ref": "#/components/schemas/GenderEnum"
              },
              {
                "type": "null"
              }
            ],
            "description": "Voice gender (`male` or `female`)."
          },
          "models": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/ModelInfo"
            },
            "title": "Models",
            "description": "Supported TTS models and their available emotions."
          },
          "voice_id": {
            "type": "string",
            "title": "Voice Id",
            "description": "Unique voice identifier. Built-in voices use the `tc_` prefix and custom voices use the `uc_` prefix."
          },
          "use_cases": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "title": "Use Cases",
            "description": "Recommended use-case categories."
          },
          "voice_name": {
            "$ref": "#/components/schemas/VoiceName",
            "description": "Localized voice names, such as `{\"eng\": \"Daejin\", \"kor\": \"대진\"}`."
          },
          "voice_type": {
            "$ref": "#/components/schemas/VoiceType",
            "description": "Voice type (`original` or `custom`)."
          },
          "preview_url": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "title": "Preview Url",
            "description": "Preview audio URL when available."
          }
        },
        "description": "Voice metadata with localized names and a preview audio URL."
      },
      "PlanTier": {
        "enum": [
          "free",
          "lite",
          "plus",
          "custom"
        ],
        "type": "string",
        "title": "PlanTier",
        "description": "Subscription plan for the API.\n\nAvailable values:\n- **free**: Free tier with limited credits\n- **lite**: Lite plan with moderate credits\n- **plus**: Plus plan with higher credits\n- **custom**: Custom enterprise plan"
      },
      "TTSModel": {
        "enum": [
          "ssfm-v30",
          "ssfm-v21"
        ],
        "type": "string",
        "title": "TTSModel",
        "description": "TTS model version to use for speech synthesis. Different models offer varying capabilities and quality levels.\n\nAvailable models:\n- **ssfm-v30**: Latest model with improved prosody and additional emotion presets (recommended)\n- **ssfm-v21**: Stable production model with proven reliability and consistent quality\n"
      },
      "ModelInfo": {
        "type": "object",
        "title": "ModelInfo",
        "required": [
          "version",
          "emotions"
        ],
        "properties": {
          "version": {
            "$ref": "#/components/schemas/TTSModel",
            "description": "TTS model version (e.g., ssfm-v21, ssfm-v30)"
          },
          "emotions": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "title": "Emotions",
            "description": "List of supported emotions for this model"
          }
        },
        "description": "Model information including version and supported emotions"
      },
      "VoiceName": {
        "type": "object",
        "title": "VoiceName",
        "required": [
          "eng",
          "kor"
        ],
        "properties": {
          "eng": {
            "type": "string",
            "title": "Eng",
            "description": "English voice name."
          },
          "kor": {
            "type": "string",
            "title": "Kor",
            "description": "Korean voice name."
          }
        },
        "description": "Localized voice names keyed by ISO 639-3 language code."
      },
      "VoiceType": {
        "enum": [
          "original",
          "custom"
        ],
        "type": "string",
        "title": "VoiceType",
        "description": "Voice type classification.\n\n- `original` — Typecast-provided stock voices available to every account.\n- `custom` — Voices the user created by uploading or cloning their own sample."
      },
      "GenderEnum": {
        "enum": [
          "male",
          "female"
        ],
        "type": "string",
        "title": "GenderEnum",
        "description": "Gender classification enum - Converts database values (Korean) to API values (English).\n\nAvailable values:\n- **male**: Male voice\n- **female**: Female voice\n"
      },
      "TTSRequest": {
        "type": "object",
        "title": "TTSRequest",
        "required": [
          "voice_id",
          "text",
          "model"
        ],
        "properties": {
          "seed": {
            "type": "integer",
            "anyOf": [
              {
                "type": "integer",
                "maximum": 4294967295,
                "minimum": 0
              },
              {
                "type": "null"
              }
            ],
            "title": "Seed",
            "format": "uint32",
            "example": 42,
            "minimum": 0,
            "description": "Unsigned integer seed for reproducible speech generation. The same seed with the same input parameters will produce identical audio output.\n\n- Must be a non-negative integer (≥ 0). Negative values are not accepted.\n- If omitted, the server generates a random seed each time, producing slight variations."
          },
          "text": {
            "type": "string",
            "title": "Text",
            "example": "Everything is so incredibly perfect that I feel like I'm dreaming.",
            "maxLength": 2000,
            "minLength": 1,
            "description": "Text to convert to speech. Minimum 1 character, maximum 2000 characters. Credits consumed based on text length. Supports multiple languages including English, Korean, Japanese, and Chinese. Special characters and punctuation are handled automatically."
          },
          "model": {
            "$ref": "#/components/schemas/TTSModel",
            "example": "ssfm-v30",
            "description": "Voice model to use for speech synthesis.\n\n- **ssfm-v30**: Latest model with improved prosody and additional emotion presets (recommended)\n- **ssfm-v21**: Stable production model with reliable quality\n"
          },
          "output": {
            "$ref": "#/components/schemas/Output",
            "description": "Audio output settings including volume (0-200), pitch (-12 to +12 semitones), tempo (0.5x to 2.0x), and format (wav/mp3) for controlling the final audio characteristics"
          },
          "prompt": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/SmartPrompt"
              },
              {
                "$ref": "#/components/schemas/PresetPrompt"
              },
              {
                "$ref": "#/components/schemas/Prompt"
              }
            ],
            "title": "Prompt",
            "description": "Emotion and style settings for the generated speech, including emotion type (happy/sad/angry/normal) and intensity (0.0 to 2.0) to control the emotional expression"
          },
          "language": {
            "type": "string",
            "title": "Language",
            "example": "eng",
            "description": "Language code following ISO 639-3 standard. Case-insensitive (both \"ENG\" and \"eng\" are accepted). If not provided, will be auto-detected based on text content.\n\n<details>\n<summary><strong>ssfm-v30 Supported Languages (37)</strong></summary>\n\n| Code | Language | Code | Language | Code | Language |\n|------|----------|------|----------|------|----------|\n| ARA | Arabic | IND | Indonesian | POR | Portuguese |\n| BEN | Bengali | ITA | Italian | RON | Romanian |\n| BUL | Bulgarian | JPN | Japanese | RUS | Russian |\n| CES | Czech | KOR | Korean | SLK | Slovak |\n| DAN | Danish | MSA | Malay | SPA | Spanish |\n| DEU | German | NAN | Min Nan | SWE | Swedish |\n| ELL | Greek | NLD | Dutch | TAM | Tamil |\n| ENG | English | NOR | Norwegian | TGL | Tagalog |\n| FIN | Finnish | PAN | Punjabi | THA | Thai |\n| FRA | French | POL | Polish | TUR | Turkish |\n| HIN | Hindi | UKR | Ukrainian | VIE | Vietnamese |\n| HRV | Croatian | YUE | Cantonese | ZHO | Chinese |\n| HUN | Hungarian | | | | |\n\n</details>\n\n<details>\n<summary><strong>ssfm-v21 Supported Languages (27)</strong></summary>\n\n| Code | Language | Code | Language | Code | Language |\n|------|----------|------|----------|------|----------|\n| ARA | Arabic | IND | Indonesian | RON | Romanian |\n| BUL | Bulgarian | ITA | Italian | RUS | Russian |\n| CES | Czech | JPN | Japanese | SLK | Slovak |\n| DAN | Danish | KOR | Korean | SPA | Spanish |\n| DEU | German | MSA | Malay | SWE | Swedish |\n| ELL | Greek | NLD | Dutch | TAM | Tamil |\n| ENG | English | POL | Polish | TGL | Tagalog |\n| FIN | Finnish | POR | Portuguese | UKR | Ukrainian |\n| FRA | French | HRV | Croatian | ZHO | Chinese |\n\n</details>\n"
          },
          "voice_id": {
            "type": "string",
            "title": "Voice Id",
            "example": "tc_60e5426de8b95f1d3000d7b5",
            "description": "Voice identifier. Two prefixes are supported:\n\n- `tc_` — Built-in Typecast voices (e.g., `tc_60e5426de8b95f1d3000d7b5`). See [Listing all voices](/docs/api-reference/voices/list-voices) for available IDs.\n- `uc_` — Custom voices created via [Instant cloning](/docs/api-reference/voices/instant-cloning) (e.g., `uc_64a1b2c3d4e5f6a7b8c9d0e1`). Only the owner of a cloned voice can use it.\n\nCase-sensitive: must use lowercase prefix."
          }
        },
        "description": "Text-to-speech request parameters"
      },
      "EmotionEnum": {
        "enum": [
          "normal",
          "sad",
          "happy",
          "angry",
          "whisper",
          "toneup",
          "tonedown"
        ],
        "type": "string",
        "title": "EmotionEnum",
        "description": "Available emotion presets for speech synthesis. Each emotion affects the tone, pace, and expressiveness of the generated speech.\n\n**ssfm-v21 Supported Emotions (4 types):**\n- normal: Neutral, balanced tone\n- happy: Bright, cheerful expression\n- sad: Melancholic, subdued tone\n- angry: Strong, intense delivery\n\n**ssfm-v30 Supported Emotions (7 types):**\n- normal: Neutral, balanced tone\n- happy: Bright, cheerful expression\n- sad: Melancholic, subdued tone\n- angry: Strong, intense delivery\n- whisper: Soft, quiet speech\n- toneup: Higher tonal emphasis\n- tonedown: Lower tonal emphasis\n\nCheck available emotions for each voice through the /v2/voices API response.\n"
      },
      "SmartPrompt": {
        "type": "object",
        "title": "SmartPrompt (ssfm-v30)",
        "example": {
          "next_text": "I am literally bursting with happiness and I never want this feeling to end!",
          "emotion_type": "smart",
          "previous_text": "I feel like I'm walking on air and I just want to scream with joy!"
        },
        "properties": {
          "next_text": {
            "type": "string",
            "title": "Next Text",
            "default": "",
            "example": "I am literally bursting with happiness and I never want this feeling to end!",
            "description": "Text that comes AFTER the `text` field in TTSRequest. Provides forward context for emotion inference.\n\nThe model analyzes the flow: `previous_text` → `text` (synthesized) → `next_text`\n\n- Maximum 2000 characters\n- Helps the model anticipate emotional transitions\n- Leave empty if no following context is available\n"
          },
          "emotion_type": {
            "type": "string",
            "const": "smart",
            "title": "Emotion Type",
            "default": "smart",
            "description": "Discriminator field to identify the prompt type. Must be set to \"smart\" for context-aware emotion inference.\n"
          },
          "previous_text": {
            "type": "string",
            "title": "Previous Text",
            "default": "",
            "example": "I feel like I'm walking on air and I just want to scream with joy!",
            "description": "Text that comes BEFORE the `text` field in TTSRequest. Provides backward context for emotion inference.\n\nThe model analyzes the flow: `previous_text` → `text` (synthesized) → `next_text`\n\n- Maximum 2000 characters\n- Helps the model understand emotional build-up and context\n- Leave empty if no preceding context is available\n"
          }
        },
        "description": "Emotion and style settings for the generated speech.",
        "additionalProperties": false
      },
      "PresetPrompt": {
        "type": "object",
        "title": "PresetPrompt (ssfm-v30)",
        "properties": {
          "emotion_type": {
            "type": "string",
            "const": "preset",
            "title": "Emotion Type",
            "default": "preset",
            "description": "Discriminator field to identify the prompt type. Must be set to \"preset\" for preset-based emotion control.\n"
          },
          "emotion_preset": {
            "$ref": "#/components/schemas/EmotionEnum",
            "default": "normal",
            "example": "normal",
            "description": "Emotion preset to apply to the generated speech.\n\nSupported emotions: normal, happy, sad, angry, whisper, toneup, tonedown\n\nCheck available emotions for each voice through the /v2/voices API.\n"
          },
          "emotion_intensity": {
            "type": "number",
            "title": "Emotion Intensity",
            "default": 1,
            "example": 1,
            "maximum": 2,
            "minimum": 0,
            "description": "Controls the strength of emotional expression in the generated speech.\n\n- 0.0: Completely neutral, no emotional coloring\n- 0.5: Subtle emotional hints\n- 1.0: Standard emotional expression (default)\n- 1.5: Strong emotional emphasis\n- 2.0: Maximum intensity, highly expressive\n"
          }
        },
        "description": "Emotion and style settings for the generated speech.",
        "additionalProperties": false
      },
      "UseCasesEnum": {
        "enum": [
          "Announcer",
          "Anime",
          "Audiobook",
          "Conversational",
          "Documentary",
          "E-learning",
          "Rapper",
          "Game",
          "Tiktok/Reels",
          "News",
          "Podcast",
          "Voicemail",
          "Ads"
        ],
        "type": "string",
        "description": "Voice use case categories for content type filtering. Each voice is tagged with one or more use cases indicating its suitability for specific content types.\n\n**Available Use Cases:**\n- **Announcer**: Public announcements and presentations\n- **Anime**: Animation and character voices\n- **Audiobook**: Long-form narration and storytelling\n- **Conversational**: Chatbots and conversational AI\n- **Documentary**: Documentary narration and commentary\n- **E-learning**: Educational content and tutorials\n- **Rapper**: Rap and music performance\n- **Game**: Video game characters and narration\n- **Tiktok/Reels**: Short-form social media content\n- **News**: News broadcasting\n- **Podcast**: Broadcasting and podcast production\n- **Voicemail**: IVR systems and voice assistants\n- **Ads**: Advertising and promotional content\n"
      },
      "ErrorResponse": {
        "type": "object",
        "example": {
          "message": "The input text contains characters or symbols that cannot be synthesized into speech. Please check your input text.",
          "error_code": "TEXT_NOT_SYNTHESIZABLE"
        },
        "properties": {
          "detail": {
            "type": "string",
            "description": "Error message describing the issue"
          },
          "message": {
            "type": "string",
            "description": "Human-readable message for structured errors"
          },
          "error_code": {
            "type": "string",
            "description": "Machine-readable error code for structured errors"
          }
        },
        "description": "API errors use `detail` for legacy and validation errors, or `error_code` and `message` for structured errors."
      },
      "ComposeRequest": {
        "type": "object",
        "title": "ComposeRequest",
        "required": [
          "segments"
        ],
        "properties": {
          "segments": {
            "type": "array",
            "items": {
              "oneOf": [
                {
                  "$ref": "#/components/schemas/TTSComposeSegment"
                },
                {
                  "$ref": "#/components/schemas/PauseComposeSegment"
                }
              ],
              "discriminator": {
                "mapping": {
                  "tts": "#/components/schemas/TTSComposeSegment",
                  "pause": "#/components/schemas/PauseComposeSegment"
                },
                "propertyName": "type"
              }
            },
            "title": "Segments",
            "maxItems": 50,
            "minItems": 1,
            "description": "Speech and pause segments in output order. Provide 1–50 segments with at least one `tts` segment."
          }
        },
        "description": "A sequence of speech and pause segments returned as one audio file."
      },
      "CustomVoiceItem": {
        "type": "object",
        "title": "CustomVoiceItem",
        "required": [
          "voice_id",
          "name",
          "model",
          "source",
          "status",
          "created_at"
        ],
        "properties": {
          "name": {
            "type": "string",
            "title": "Name",
            "description": "Voice name."
          },
          "error": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "title": "Error",
            "description": "Failure reason when `status` is `failed`."
          },
          "model": {
            "type": "string",
            "title": "Model",
            "description": "TTS model version."
          },
          "source": {
            "type": "string",
            "title": "Source",
            "description": "Creation method (`instant` or `professional`)."
          },
          "status": {
            "$ref": "#/components/schemas/CustomVoiceStatus",
            "description": "Current creation or training status."
          },
          "voice_id": {
            "type": "string",
            "title": "Voice Id",
            "description": "Unique custom voice identifier with the `uc_` prefix."
          },
          "created_at": {
            "type": "string",
            "title": "Created At",
            "format": "date-time",
            "description": "Creation time in UTC."
          }
        },
        "description": "A custom voice owned by the authenticated account."
      },
      "ValidationError": {
        "type": "object",
        "title": "ValidationError",
        "required": [
          "loc",
          "msg",
          "type"
        ],
        "properties": {
          "ctx": {
            "type": "object",
            "title": "Context"
          },
          "loc": {
            "type": "array",
            "items": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "integer"
                }
              ]
            },
            "title": "Location"
          },
          "msg": {
            "type": "string",
            "title": "Message"
          },
          "type": {
            "type": "string",
            "title": "Error Type"
          },
          "input": {
            "title": "Input"
          }
        }
      },
      "RecommendedVoice": {
        "type": "object",
        "title": "RecommendedVoice",
        "required": [
          "voice_id",
          "voice_name",
          "score"
        ],
        "properties": {
          "score": {
            "type": "number",
            "title": "Score",
            "example": 0.92,
            "description": "Recommendation relevance score. Higher values indicate a stronger match for the query."
          },
          "voice_id": {
            "type": "string",
            "title": "Voice Id",
            "example": "tc_60e5426de8b95f1d3000d7b5",
            "description": "Typecast voice identifier with the `tc_` prefix. Use this value as `voice_id` in text-to-speech requests."
          },
          "voice_name": {
            "type": "string",
            "title": "Voice Name",
            "example": "Olivia",
            "description": "Human-readable voice name."
          }
        },
        "description": "Recommended voice candidate returned by `GET /v1/voices/recommendations`, sorted by relevance."
      },
      "CustomVoiceStatus": {
        "enum": [
          "pending",
          "training",
          "completed",
          "failed"
        ],
        "type": "string",
        "title": "CustomVoiceStatus",
        "description": "Current creation or training status of a custom voice."
      },
      "TTSComposeSegment": {
        "type": "object",
        "title": "TTSComposeSegment",
        "examples": [
          {
            "text": "Welcome to today's update.",
            "type": "tts",
            "model": "ssfm-v30",
            "output": {
              "audio_format": "wav"
            },
            "language": "eng",
            "voice_id": "tc_672c5f5ce59fac2a48faeaee"
          }
        ],
        "required": [
          "type",
          "voice_id",
          "text",
          "model"
        ],
        "properties": {
          "seed": {
            "anyOf": [
              {
                "type": "integer",
                "maximum": 4294967295,
                "minimum": 0
              },
              {
                "type": "null"
              }
            ],
            "title": "Seed",
            "example": 42,
            "description": "Optional unsigned integer seed for reproducible synthesis."
          },
          "text": {
            "type": "string",
            "title": "Text",
            "example": "Welcome to today's update.",
            "maxLength": 2000,
            "minLength": 1,
            "description": "Text to synthesize. The combined text across all `tts` segments may not exceed 2,000 characters."
          },
          "type": {
            "type": "string",
            "const": "tts",
            "title": "Type",
            "default": "tts",
            "description": "Segment discriminator. Always `tts`."
          },
          "model": {
            "$ref": "#/components/schemas/TTSModel",
            "example": "ssfm-v30",
            "description": "Voice model used for this segment. Models may differ between segments."
          },
          "output": {
            "$ref": "#/components/schemas/Output",
            "description": "Audio settings for this segment. All segments must use the same `audio_format`."
          },
          "prompt": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/SmartPrompt"
              },
              {
                "$ref": "#/components/schemas/PresetPrompt"
              },
              {
                "$ref": "#/components/schemas/Prompt"
              }
            ],
            "title": "Prompt",
            "description": "Emotion and context settings for this segment."
          },
          "language": {
            "type": "string",
            "title": "Language",
            "example": "eng",
            "description": "ISO 639-3 language code. If omitted, the language is detected from the text."
          },
          "voice_id": {
            "type": "string",
            "title": "Voice Id",
            "example": "tc_672c5f5ce59fac2a48faeaee",
            "description": "Built-in (`tc_`) or custom (`uc_`) Typecast voice identifier."
          }
        },
        "description": "A speech segment with the same synthesis options as a standard text-to-speech request."
      },
      "OutputStreamStream": {
        "type": "object",
        "title": "OutputStreamStream",
        "properties": {
          "audio_pitch": {
            "type": "integer",
            "title": "Audio Pitch",
            "default": 0,
            "example": 0,
            "maximum": 12,
            "minimum": -12,
            "description": "Adjusts the pitch in semitones to affect perceived gender and age: -12 (one octave lower, deeper voice), -6 (half octave lower), 0 (original pitch, default), +6 (half octave higher), +12 (one octave higher, higher voice)"
          },
          "audio_tempo": {
            "type": "number",
            "title": "Audio Tempo",
            "default": 1,
            "example": 1,
            "maximum": 2,
            "minimum": 0.5,
            "description": "Controls speech speed: 0.5 (half speed, very slow and clear), 0.75 (slightly slower than normal), 1.0 (normal speaking speed, default), 1.5 (50% faster than normal), 2.0 (double speed, very fast speech)"
          },
          "target_lufs": {
            "type": "number",
            "anyOf": [
              {
                "type": "number",
                "maximum": 0,
                "minimum": -70
              },
              {
                "type": "null"
              }
            ],
            "title": "Target Lufs",
            "example": -14,
            "description": "Sets the target absolute loudness (LUFS) for streaming output audio. This normalizes generated audio to a consistent loudness regardless of the original source. Cannot be used with the `volume` parameter.\n\nRecommended values: -14 (common streaming standard), -23 (broadcast standard).\n"
          },
          "audio_format": {
            "enum": [
              "wav",
              "mp3"
            ],
            "type": "string",
            "title": "Audio Format",
            "default": "wav",
            "example": "wav",
            "description": "Output audio format for streaming.\n\n**WAV format:**\n- Uncompressed PCM audio\n- 16-bit depth, mono channel, **32000 Hz** sample rate\n- Chunked transfer: first chunk contains the WAV header (size = 0xFFFFFFFF), subsequent chunks contain raw PCM data\n- Recommended when you want to play audio as it arrives\n\n**MP3 format:**\n- Compressed MPEG Layer III audio\n- 320 kbps bitrate, 44100 Hz sample rate\n- Chunked transfer: each chunk contains independently decodable MPEG frames\n- Recommended for bandwidth-constrained clients\n"
          }
        },
        "description": "Audio output settings for streaming. Use `target_lufs` for LUFS loudness normalization; `volume` is not available in streaming mode."
      },
      "CustomVoiceResponse": {
        "type": "object",
        "title": "CustomVoiceResponse",
        "required": [
          "voice_id",
          "name",
          "model",
          "status"
        ],
        "properties": {
          "name": {
            "type": "string",
            "title": "Name",
            "description": "Human-readable voice name (1-30 characters)."
          },
          "model": {
            "type": "string",
            "allOf": [
              {
                "$ref": "#/components/schemas/TTSModel"
              }
            ],
            "title": "Model",
            "description": "Engine model the voice was cloned for (`ssfm-v21` or `ssfm-v30`)."
          },
          "status": {
            "$ref": "#/components/schemas/CustomVoiceStatus",
            "description": "생성/학습 상태"
          },
          "voice_id": {
            "type": "string",
            "title": "Voice Id",
            "example": "uc_64a1b2c3d4e5f6a7b8c9d0e1",
            "description": "Custom voice identifier with the `uc_` prefix. Use this value as `voice_id` in `POST /v1/text-to-speech` and other endpoints that accept `voice_id`."
          }
        },
        "description": "Response of `POST /v1/voices/clone` — custom voice metadata returned by instant cloning."
      },
      "HTTPValidationError": {
        "type": "object",
        "title": "HTTPValidationError",
        "properties": {
          "detail": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/ValidationError"
            },
            "title": "Detail"
          }
        }
      },
      "PauseComposeSegment": {
        "type": "object",
        "title": "PauseComposeSegment",
        "examples": [
          {
            "type": "pause",
            "duration_seconds": 1.5
          }
        ],
        "required": [
          "type",
          "duration_seconds"
        ],
        "properties": {
          "type": {
            "type": "string",
            "const": "pause",
            "title": "Type",
            "default": "pause",
            "description": "Segment discriminator. Always `pause`."
          },
          "duration_seconds": {
            "type": "number",
            "title": "Duration Seconds",
            "example": 1.5,
            "maximum": 10,
            "description": "Pause duration in seconds. Each pause may be up to 10 seconds; all pauses combined may be up to 60 seconds.",
            "exclusiveMinimum": 0
          }
        },
        "description": "A silent interval inserted without consuming credits.",
        "additionalProperties": false
      },
      "AlignmentSegmentWord": {
        "type": "object",
        "title": "AlignmentSegmentWord",
        "required": [
          "text",
          "start",
          "end"
        ],
        "properties": {
          "end": {
            "type": "number",
            "title": "End",
            "description": "End time of this segment, in seconds from the beginning of the audio."
          },
          "text": {
            "type": "string",
            "title": "Text",
            "description": "The text fragment from the original transcript (includes any attached punctuation)."
          },
          "start": {
            "type": "number",
            "title": "Start",
            "description": "Start time of this segment, in seconds from the beginning of the audio."
          }
        },
        "description": "A single word-level alignment segment between the original transcript and the generated audio."
      },
      "SubscriptionResponse": {
        "type": "object",
        "title": "SubscriptionResponse",
        "required": [
          "plan",
          "credits",
          "limits",
          "professional_clone_generations"
        ],
        "properties": {
          "plan": {
            "$ref": "#/components/schemas/PlanTier",
            "description": "Current subscription plan"
          },
          "limits": {
            "$ref": "#/components/schemas/Limits",
            "description": "Usage limit information"
          },
          "credits": {
            "$ref": "#/components/schemas/Credits",
            "description": "Credit usage information"
          },
          "professional_clone_generations": {
            "$ref": "#/components/schemas/ProfessionalCloneGenerations"
          }
        },
        "description": "Subscription information response model"
      },
      "TTSRequestStreamStream": {
        "type": "object",
        "title": "TTSRequestStreamStream",
        "required": [
          "voice_id",
          "text",
          "model"
        ],
        "properties": {
          "seed": {
            "type": "integer",
            "anyOf": [
              {
                "type": "integer",
                "maximum": 4294967295,
                "minimum": 0
              },
              {
                "type": "null"
              }
            ],
            "title": "Seed",
            "format": "uint32",
            "example": 42,
            "minimum": 0,
            "description": "Unsigned integer seed for reproducible speech generation. The same seed with the same input parameters will produce identical audio output.\n\n- Must be a non-negative integer (≥ 0). Negative values are not accepted.\n- If omitted, the server generates a random seed each time, producing slight variations."
          },
          "text": {
            "type": "string",
            "title": "Text",
            "example": "Everything is so incredibly perfect that I feel like I'm dreaming.",
            "maxLength": 2000,
            "minLength": 1,
            "description": "Text to convert to speech. Minimum 1 character, maximum 2000 characters. Credits consumed based on text length. Supports multiple languages including English, Korean, Japanese, and Chinese. Special characters and punctuation are handled automatically."
          },
          "model": {
            "$ref": "#/components/schemas/TTSModel",
            "example": "ssfm-v30",
            "description": "Voice model to use for speech synthesis.\n\n- **ssfm-v30**: Latest model with improved prosody and additional emotion presets (recommended)\n- **ssfm-v21**: Stable production model with reliable quality\n"
          },
          "output": {
            "$ref": "#/components/schemas/OutputStreamStream",
            "description": "Streaming audio output settings including pitch (-12 to +12 semitones), tempo (0.5x to 2.0x), format (wav/mp3), and target_lufs (-70 to 0 LUFS). Note: volume is not available in streaming mode."
          },
          "prompt": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/SmartPrompt"
              },
              {
                "$ref": "#/components/schemas/PresetPrompt"
              },
              {
                "$ref": "#/components/schemas/Prompt"
              }
            ],
            "title": "Prompt",
            "description": "Emotion and style settings for the generated speech, including emotion type (happy/sad/angry/normal) and intensity (0.0 to 2.0) to control the emotional expression"
          },
          "language": {
            "type": "string",
            "title": "Language",
            "example": "eng",
            "description": "Language code following ISO 639-3 standard. Case-insensitive (both \"ENG\" and \"eng\" are accepted). If not provided, will be auto-detected based on text content.\n\n<details>\n<summary><strong>ssfm-v30 Supported Languages (37)</strong></summary>\n\n| Code | Language | Code | Language | Code | Language |\n|------|----------|------|----------|------|----------|\n| ARA | Arabic | IND | Indonesian | POR | Portuguese |\n| BEN | Bengali | ITA | Italian | RON | Romanian |\n| BUL | Bulgarian | JPN | Japanese | RUS | Russian |\n| CES | Czech | KOR | Korean | SLK | Slovak |\n| DAN | Danish | MSA | Malay | SPA | Spanish |\n| DEU | German | NAN | Min Nan | SWE | Swedish |\n| ELL | Greek | NLD | Dutch | TAM | Tamil |\n| ENG | English | NOR | Norwegian | TGL | Tagalog |\n| FIN | Finnish | PAN | Punjabi | THA | Thai |\n| FRA | French | POL | Polish | TUR | Turkish |\n| HIN | Hindi | UKR | Ukrainian | VIE | Vietnamese |\n| HRV | Croatian | YUE | Cantonese | ZHO | Chinese |\n| HUN | Hungarian | | | | |\n\n</details>\n\n<details>\n<summary><strong>ssfm-v21 Supported Languages (27)</strong></summary>\n\n| Code | Language | Code | Language | Code | Language |\n|------|----------|------|----------|------|----------|\n| ARA | Arabic | IND | Indonesian | RON | Romanian |\n| BUL | Bulgarian | ITA | Italian | RUS | Russian |\n| CES | Czech | JPN | Japanese | SLK | Slovak |\n| DAN | Danish | KOR | Korean | SPA | Spanish |\n| DEU | German | MSA | Malay | SWE | Swedish |\n| ELL | Greek | NLD | Dutch | TAM | Tamil |\n| ENG | English | POL | Polish | TGL | Tagalog |\n| FIN | Finnish | POR | Portuguese | UKR | Ukrainian |\n| FRA | French | HRV | Croatian | ZHO | Chinese |\n\n</details>\n"
          },
          "voice_id": {
            "type": "string",
            "title": "Voice Id",
            "example": "tc_60e5426de8b95f1d3000d7b5",
            "description": "Voice identifier. Two prefixes are supported:\n\n- `tc_` — Built-in Typecast voices (e.g., `tc_60e5426de8b95f1d3000d7b5`). See [Listing all voices](/docs/api-reference/voices/list-voices) for available IDs.\n- `uc_` — Custom voices created via [Instant cloning](/docs/api-reference/voices/instant-cloning) (e.g., `uc_64a1b2c3d4e5f6a7b8c9d0e1`). Only the owner of a cloned voice can use it.\n\nCase-sensitive: must use lowercase prefix."
          }
        },
        "description": "Text-to-speech streaming request parameters"
      },
      "AlignmentSegmentCharacter": {
        "type": "object",
        "title": "AlignmentSegmentCharacter",
        "required": [
          "text",
          "start",
          "end"
        ],
        "properties": {
          "end": {
            "type": "number",
            "title": "End",
            "description": "End time of this segment, in seconds from the beginning of the audio."
          },
          "text": {
            "type": "string",
            "title": "Text",
            "description": "The text fragment from the original transcript (includes any attached punctuation and whitespace)."
          },
          "start": {
            "type": "number",
            "title": "Start",
            "description": "Start time of this segment, in seconds from the beginning of the audio."
          }
        },
        "description": "A single character-level alignment segment between the original transcript and the generated audio."
      },
      "CustomVoiceCreateResponse": {
        "type": "object",
        "title": "CustomVoiceCreateResponse",
        "required": [
          "voice_id",
          "name",
          "model",
          "status"
        ],
        "properties": {
          "name": {
            "type": "string",
            "title": "Name",
            "description": "Voice name."
          },
          "model": {
            "type": "string",
            "title": "Model",
            "description": "TTS model version."
          },
          "status": {
            "$ref": "#/components/schemas/CustomVoiceStatus",
            "description": "Current creation or training status."
          },
          "voice_id": {
            "type": "string",
            "title": "Voice Id",
            "description": "Unique custom voice identifier with the `uc_` prefix."
          }
        },
        "description": "Result returned after creating an instant or professional custom voice."
      },
      "TTSWithTimestampsResponse": {
        "type": "object",
        "title": "TTSWithTimestampsResponse",
        "required": [
          "audio",
          "audio_format",
          "audio_duration",
          "words",
          "characters"
        ],
        "properties": {
          "audio": {
            "type": "string",
            "title": "Audio",
            "description": "Base64-encoded audio bytes. Decode and write to a file using the `audio_format` extension."
          },
          "words": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "$ref": "#/components/schemas/AlignmentSegmentWord"
                }
              },
              {
                "type": "null"
              }
            ],
            "title": "Words",
            "description": "Word-level timestamps (with attached punctuation). `null` when the request uses `granularity=char`."
          },
          "characters": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "$ref": "#/components/schemas/AlignmentSegmentCharacter"
                }
              },
              {
                "type": "null"
              }
            ],
            "title": "Characters",
            "description": "Character-level timestamps (including punctuation and whitespace). `null` when the request uses `granularity=word`."
          },
          "audio_format": {
            "enum": [
              "wav",
              "mp3"
            ],
            "type": "string",
            "title": "Audio Format",
            "description": "Audio encoding format of the bytes in `audio` — either `wav` or `mp3`, mirroring the request's `output.audio_format`."
          },
          "audio_duration": {
            "type": "number",
            "title": "Audio Duration",
            "description": "Length of the generated audio in seconds."
          }
        },
        "description": "Response payload for POST /v1/text-to-speech/with-timestamps — base64-encoded audio plus per-word and per-character timestamps aligned with the generated speech."
      },
      "ProfessionalCloneGenerations": {
        "type": "object",
        "title": "ProfessionalCloneGenerations",
        "properties": {
          "plan_generations": {
            "type": "integer",
            "title": "Plan Generations",
            "default": 0,
            "minimum": 0,
            "description": "플랜 제공 학습 횟수"
          },
          "used_generations": {
            "type": "integer",
            "title": "Used Generations",
            "default": 0,
            "minimum": 0,
            "description": "사용된 학습 횟수"
          }
        },
        "description": "프리미엄 클로닝 학습 횟수 정보"
      },
      "TTSRequestWith-timestampsWith-timestamps": {
        "type": "object",
        "title": "TTSRequestWith-timestampsWith-timestamps",
        "required": [
          "voice_id",
          "text",
          "model"
        ],
        "properties": {
          "seed": {
            "type": "integer",
            "anyOf": [
              {
                "type": "integer",
                "maximum": 4294967295,
                "minimum": 0
              },
              {
                "type": "null"
              }
            ],
            "title": "Seed",
            "format": "uint32",
            "example": 42,
            "minimum": 0,
            "description": "Unsigned integer seed for reproducible speech generation. The same seed with the same input parameters will produce identical audio output.\n\n- Must be a non-negative integer (≥ 0). Negative values are not accepted.\n- If omitted, the server generates a random seed each time, producing slight variations."
          },
          "text": {
            "type": "string",
            "title": "Text",
            "example": "Everything is so incredibly perfect that I feel like I'm dreaming.",
            "maxLength": 2000,
            "minLength": 1,
            "description": "Text to convert to speech. Minimum 1 character, maximum 2000 characters. Credits consumed based on text length. Supports multiple languages including English, Korean, Japanese, and Chinese. Special characters and punctuation are handled automatically."
          },
          "model": {
            "$ref": "#/components/schemas/TTSModel",
            "example": "ssfm-v30",
            "description": "Voice model to use for speech synthesis.\n\n- **ssfm-v30**: Latest model with improved prosody and additional emotion presets (recommended)\n- **ssfm-v21**: Stable production model with reliable quality\n"
          },
          "output": {
            "$ref": "#/components/schemas/Output",
            "description": "Audio output settings including volume (0-200), pitch (-12 to +12 semitones), tempo (0.5x to 2.0x), and format (wav/mp3) for controlling the final audio characteristics"
          },
          "prompt": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/SmartPrompt"
              },
              {
                "$ref": "#/components/schemas/PresetPrompt"
              },
              {
                "$ref": "#/components/schemas/Prompt"
              }
            ],
            "title": "Prompt",
            "description": "Emotion and style settings for the generated speech, including emotion type (happy/sad/angry/normal) and intensity (0.0 to 2.0) to control the emotional expression"
          },
          "language": {
            "type": "string",
            "title": "Language",
            "example": "eng",
            "description": "Language code following ISO 639-3 standard. Case-insensitive (both \"ENG\" and \"eng\" are accepted). If not provided, will be auto-detected based on text content.\n\n<details>\n<summary><strong>ssfm-v30 Supported Languages (37)</strong></summary>\n\n| Code | Language | Code | Language | Code | Language |\n|------|----------|------|----------|------|----------|\n| ARA | Arabic | IND | Indonesian | POR | Portuguese |\n| BEN | Bengali | ITA | Italian | RON | Romanian |\n| BUL | Bulgarian | JPN | Japanese | RUS | Russian |\n| CES | Czech | KOR | Korean | SLK | Slovak |\n| DAN | Danish | MSA | Malay | SPA | Spanish |\n| DEU | German | NAN | Min Nan | SWE | Swedish |\n| ELL | Greek | NLD | Dutch | TAM | Tamil |\n| ENG | English | NOR | Norwegian | TGL | Tagalog |\n| FIN | Finnish | PAN | Punjabi | THA | Thai |\n| FRA | French | POL | Polish | TUR | Turkish |\n| HIN | Hindi | UKR | Ukrainian | VIE | Vietnamese |\n| HRV | Croatian | YUE | Cantonese | ZHO | Chinese |\n| HUN | Hungarian | | | | |\n\n</details>\n\n<details>\n<summary><strong>ssfm-v21 Supported Languages (27)</strong></summary>\n\n| Code | Language | Code | Language | Code | Language |\n|------|----------|------|----------|------|----------|\n| ARA | Arabic | IND | Indonesian | RON | Romanian |\n| BUL | Bulgarian | ITA | Italian | RUS | Russian |\n| CES | Czech | JPN | Japanese | SLK | Slovak |\n| DAN | Danish | KOR | Korean | SPA | Spanish |\n| DEU | German | MSA | Malay | SWE | Swedish |\n| ELL | Greek | NLD | Dutch | TAM | Tamil |\n| ENG | English | POL | Polish | TGL | Tagalog |\n| FIN | Finnish | POR | Portuguese | UKR | Ukrainian |\n| FRA | French | HRV | Croatian | ZHO | Chinese |\n\n</details>\n\n> **Timestamp endpoint note.** For languages without inter-word whitespace — Japanese (`jpn`) and Chinese (`zho`) — word-level alignment collapses the whole sentence into a single segment. Always pair these languages with `granularity=char` to receive usable per-character timestamps.\n"
          },
          "voice_id": {
            "type": "string",
            "title": "Voice Id",
            "example": "tc_60e5426de8b95f1d3000d7b5",
            "description": "Voice identifier. Two prefixes are supported:\n\n- `tc_` — Built-in Typecast voices (e.g., `tc_60e5426de8b95f1d3000d7b5`). See [Listing all voices](/docs/api-reference/voices/list-voices) for available IDs.\n- `uc_` — Custom voices created via [Instant cloning](/docs/api-reference/voices/instant-cloning) (e.g., `uc_64a1b2c3d4e5f6a7b8c9d0e1`). Only the owner of a cloned voice can use it.\n\nCase-sensitive: must use lowercase prefix."
          }
        },
        "description": "Text-to-speech request parameters"
      },
      "Body_create_voice_clone_v1_voices_clone_post": {
        "type": "object",
        "title": "Body_create_voice_clone_v1_voices_clone_post",
        "required": [
          "file",
          "name",
          "model"
        ],
        "properties": {
          "file": {
            "type": "string",
            "title": "File",
            "format": "binary",
            "description": "Audio sample. WAV or MP3, max 25 MB, 5-150 seconds.",
            "contentMediaType": "application/octet-stream"
          },
          "name": {
            "type": "string",
            "title": "Name",
            "maxLength": 30,
            "minLength": 1,
            "description": "Voice name (1-30 characters)."
          },
          "model": {
            "$ref": "#/components/schemas/TTSModel",
            "allOf": [
              {
                "$ref": "#/components/schemas/TTSModel"
              }
            ],
            "description": "Engine model the voice is cloned for (`ssfm-v21` or `ssfm-v30`)."
          }
        },
        "description": "Multipart request body for instant cloning."
      },
      "Body_create_instant_clone_v1_custom_voices_instant_clone_post": {
        "type": "object",
        "title": "Body_create_instant_clone_v1_custom_voices_instant_clone_post",
        "required": [
          "file",
          "name",
          "model"
        ],
        "properties": {
          "file": {
            "type": "string",
            "title": "File",
            "format": "binary",
            "description": "One WAV or MP3 recording, 25 MiB or less and 5 to 150 seconds long.",
            "contentMediaType": "application/octet-stream"
          },
          "name": {
            "type": "string",
            "title": "Name",
            "example": "Product Narrator",
            "maxLength": 30,
            "minLength": 1,
            "description": "Voice name, up to 30 characters."
          },
          "model": {
            "$ref": "#/components/schemas/TTSModel",
            "example": "ssfm-v30",
            "description": "TTS model version."
          }
        },
        "description": "Multipart request body for instant voice cloning."
      },
      "Body_create_professional_clone_v1_custom_voices_professional_clone_post": {
        "type": "object",
        "title": "Body_create_professional_clone_v1_custom_voices_professional_clone_post",
        "required": [
          "name",
          "files",
          "model",
          "language"
        ],
        "properties": {
          "name": {
            "type": "string",
            "title": "Name",
            "example": "Custom Voice Name",
            "maxLength": 30,
            "minLength": 1,
            "description": "Voice name, up to 30 characters."
          },
          "files": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "binary",
              "contentMediaType": "application/octet-stream"
            },
            "title": "Files",
            "description": "WAV or MP3 recordings used for training. Only one file can be uploaded.\r\n\r\n**Upload limits**\r\n\r\n* One WAV or MP3 file\r\n* File size: 1 GiB or less\r\n* Duration: 5 minutes to 3 hours\r\n* Sample rate: 16 kHz or higher\r\n\r\nFor best results, we recommend audio that meets the following conditions:\r\n\r\n* Record in a speaking style that closely matches how you want the generated voice to sound.\r\n* Record in a quiet environment without background noise.\r\n* Include only one speaker.\r\n* Record in the language specified in the `language` field.\r\n* Longer input audio results in higher-quality generated voices."
          },
          "model": {
            "$ref": "#/components/schemas/TTSModel",
            "example": "ssfm-v30",
            "description": "TTS model version."
          },
          "language": {
            "type": "string",
            "title": "Language",
            "example": "eng",
            "description": "ISO 639-3 language code, such as `kor` or `eng`."
          }
        },
        "description": "Multipart request body for professional voice cloning."
      }
    },
    "securitySchemes": {
      "ApiKeyAuth": {
        "in": "header",
        "name": "X-API-KEY",
        "type": "apiKey",
        "description": "API key for authentication. You can obtain an API key from the Typecast API Console."
      },
      "BearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT"
      }
    }
  }
}
```

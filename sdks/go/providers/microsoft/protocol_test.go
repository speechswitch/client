package microsoft

import (
	"context"
	"fmt"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"testing"
)

func TestMalformedMetadataAndNativeFrameBoundaries(t *testing.T) {
	for _, row := range []struct{ body, message string }{
		{`{"Metadata":null}`, "Microsoft returned invalid synthesis Metadata"},
		{`{"Metadata":[{"Type":1}]}`, "Microsoft returned an invalid metadata type"},
		{`{"Metadata":[{"Type":"SessionEnd","Data":{}}]}`, "Microsoft returned invalid metadata Offset"},
		{`{"Metadata":[{"Type":"SessionEnd","Data":{"Offset":-1}}]}`, "Microsoft returned invalid metadata Offset"},
		{`{"Metadata":[{"Type":"SessionEnd","Data":{"Offset":1.5}}]}`, "Microsoft returned invalid metadata Offset"},
		{`{"Metadata":[{"Type":"SessionEnd","Data":{"Offset":0}},{"Type":"SessionEnd","Data":{"Offset":0}}]}`, "Microsoft returned duplicate SessionEnd metadata"},
		{`{"Metadata":[{"Type":"WordBoundary","Data":{"Offset":0,"Duration":1,"text":{"Text":1}}}]}`, "Microsoft returned invalid boundary text"},
		{`{"Metadata":[{"Type":"WordBoundary","Data":{"Offset":0,"Duration":null,"text":{"Text":"Hi"}}}]}`, "Microsoft returned invalid metadata Duration"},
		{`{"Metadata":[{"Type":"WordBoundary","Data":{"Offset":9007199254740991,"Duration":1,"text":{"Text":"Hi"}}}]}`, "Microsoft metadata timing overflow"},
		{`{"Metadata":[{"Type":"WordBoundary","Data":{"Offset":0,"Duration":1,"text":{"Text":"Hi","BoundaryType":false}}}]}`, "Microsoft returned invalid boundary text"},
		{`{"Metadata":[{"Type":"Bookmark","Data":{"Offset":0,"Bookmark":null}}]}`, "Microsoft returned an invalid bookmark"},
		{`{"Metadata":[{"Type":"Viseme","Data":{"Offset":0,"VisemeId":2,"AnimationChunk":null}}]}`, "Microsoft returned invalid viseme metadata"},
		{`{"Metadata":[{"Type":"Viseme","Data":{"Offset":0,"VisemeId":2,"IsLastAnimation":null}}]}`, "Microsoft returned invalid viseme metadata"},
	} {
		body, err := object([]byte(row.body))
		if err != nil {
			t.Fatal(err)
		}
		_, _, err = metadata(body)
		errorText(t, err, row.message)
	}
	for _, row := range []struct {
		raw     runtime.WebSocketMessage
		limit   int
		message string
	}{
		{runtime.WebSocketText("Path: audio\r\npath: response\r\nX-RequestId: id\r\n\r\n"), 1000, "Microsoft frame repeats header path"},
		{runtime.WebSocketText("Path: response\r\n\r\n{}"), 1000, "Microsoft frame is missing Path or X-RequestId"},
		{runtime.WebSocketText("Path: response\r\nBad name: value\r\nX-RequestId: id\r\n\r\n{}"), 1000, "Microsoft frame contains an invalid header"},
		{textFrame("turn.end", "id", "{}"), 1, "Microsoft message exceeds MaxMessageBytes"},
		{audioFrame("id", "stream"), 1, "Microsoft message exceeds MaxMessageBytes"},
	} {
		_, err := decode(row.raw, row.limit)
		errorText(t, err, row.message)
	}
	_, err := object([]byte(`{"audio":NaN}`))
	errorText(t, err, "Microsoft returned invalid JSON")
}

func TestStreamIdentityAndPrematureCompletion(t *testing.T) {
	for _, mode := range []string{"changed stream", "wrong audio stream", "wrong metadata stream", "early end", "early close"} {
		t.Run(mode, func(t *testing.T) {
			socket := newSocket()
			input := newSource("Hi")
			input.stall = true
			socket.hook = func(_ context.Context, f sentFrame) error {
				if f.path != "text.piece" {
					return nil
				}
				socket.reply(textFrame("response", f.id, `{"audio":{"streamId":"stream"}}`))
				switch mode {
				case "changed stream":
					socket.reply(textFrame("response", f.id, `{"audio":{"streamId":"other"}}`))
				case "wrong audio stream":
					socket.reply(audioFrame(f.id, "other"))
				case "wrong metadata stream":
					socket.reply(runtime.WebSocketText(fmt.Sprintf("Path: audio.metadata\r\nX-RequestId: %s\r\nX-StreamId: other\r\n\r\n{\"Metadata\":[]}", f.id)))
				case "early end":
					socket.reply(textFrame("turn.end", f.id, "{}"))
				case "early close":
					socket.incoming <- socketResult{err: io.EOF}
				}
				return nil
			}
			stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			_, err = stream.Next(context.Background())
			expected := map[string]string{"changed stream": "Microsoft changed the audio stream within a synthesis turn", "wrong audio stream": "Microsoft returned audio for an unexpected stream", "wrong metadata stream": "Microsoft returned metadata for an unexpected stream", "early end": "Microsoft ended synthesis before text.end", "early close": "Microsoft WebSocket closed before turn.end"}
			errorText(t, err, expected[mode])
			wait(t, input.closed)
			equal(t, socket.closes.Load(), int32(1))
		})
	}
}

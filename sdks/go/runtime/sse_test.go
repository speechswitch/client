package runtime

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"

	"github.com/speechswitch/client/sdks/go/generated/transport"
)

func TestSSESharedFixtures(t *testing.T) {
	content, err := os.ReadFile("../../fixtures/sse.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name, Text, Hex, Error string
		Limit                  int
		Events                 []transport.SseMessage
	}
	if err := json.Unmarshal(content, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			wire := []byte(fixture.Text)
			if fixture.Hex != "" {
				wire, err = hex.DecodeString(fixture.Hex)
				if err != nil {
					t.Fatal(err)
				}
			}
			limit := fixture.Limit
			if limit == 0 {
				limit = 4096
			}
			for split := 0; split <= len(wire); split++ {
				decoder, err := NewSSEDecoder(limit)
				if err != nil {
					t.Fatal(err)
				}
				events := []transport.SseMessage{}
				failure := ""
			chunks:
				for _, chunk := range [][]byte{wire[:split], nil, wire[split:]} {
					for _, b := range chunk {
						event, err := decoder.Push(b)
						if err != nil {
							failure = err.Error()
							break chunks
						}
						if event != nil {
							events = append(events, *event)
						}
					}
				}
				if !reflect.DeepEqual(events, fixture.Events) || failure != fixture.Error {
					t.Fatalf("split %d: got %#v / %q; want %#v / %q", split, events, failure, fixture.Events, fixture.Error)
				}
				if failure != "" {
					if event, err := decoder.Push('\n'); event != nil || !errors.Is(err, ErrSSEClosed) {
						t.Fatalf("got %#v / %v", event, err)
					}
				}
				decoder.Finish()
				decoder.Finish()
				if event, err := decoder.Push('\n'); event != nil || !errors.Is(err, ErrSSEClosed) {
					t.Fatalf("got %#v / %v", event, err)
				}
			}
		})
	}
}

func TestSSEInvalidLimit(t *testing.T) {
	for _, limit := range []int{0, -1} {
		decoder, err := NewSSEDecoder(limit)
		if decoder != nil || !errors.Is(err, ErrSSEInvalidLimit) {
			t.Fatalf("got %#v / %v", decoder, err)
		}
	}
	var zero SSEDecoder
	if _, err := zero.Push('x'); !errors.Is(err, ErrSSEClosed) {
		t.Fatal(err)
	}
}

func TestSSECRDispatchDoesNotWaitForNextRead(t *testing.T) {
	decoder, err := NewSSEDecoder(100)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range []byte("data: x\r") {
		if event, err := decoder.Push(b); event != nil || err != nil {
			t.Fatalf("got %#v / %v", event, err)
		}
	}
	event, err := decoder.Push('\r')
	if err != nil || event == nil || *event != (transport.SseMessage{Event: "message", Data: "x"}) {
		t.Fatalf("got %#v / %v", event, err)
	}
}

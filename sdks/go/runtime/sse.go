package runtime

import (
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/speechswitch/client/sdks/go/generated/transport"
)

var (
	ErrSSEInvalidLimit  = errors.New("SSE event limit must be positive")
	ErrSSEEventTooLarge = errors.New("SSE event exceeds byte limit")
	ErrSSEClosed        = errors.New("SSE decoder is closed")
)

// SSEDecoder frames data events, not JSON/audio or reconnection semantics.
// https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream
// It is single-consumer and does not own the HTTP response.
type SSEDecoder struct {
	limit, size           int
	line                  []byte
	data                  []string
	event                 string
	first, skipLF, closed bool
}

// NewSSEDecoder sets a positive raw-byte limit per block, including comments,
// unknown fields and a leading BOM. Line endings count as one byte; the blank
// separator is excluded. A limit error is terminal.
func NewSSEDecoder(maxEventBytes int) (*SSEDecoder, error) {
	if maxEventBytes <= 0 {
		return nil, ErrSSEInvalidLimit
	}
	return &SSEDecoder{limit: maxEventBytes, first: true}, nil
}

// Push consumes a byte; dispatch returned messages immediately, even after CR.
func (d *SSEDecoder) Push(b byte) (*transport.SseMessage, error) {
	if d.closed || d.limit == 0 {
		return nil, ErrSSEClosed
	}
	if d.skipLF {
		d.skipLF = false
		if b == '\n' {
			return nil, nil
		}
	}
	newline := b == '\r' || b == '\n'
	d.skipLF = b == '\r'
	if !newline || len(d.line) != 0 {
		if d.size == d.limit {
			d.Finish()
			return nil, ErrSSEEventTooLarge
		}
		d.size++
	}
	if !newline {
		d.line = append(d.line, b)
		return nil, nil
	}
	line := DecodeUTF8(d.line)
	d.line = d.line[:0]
	if d.first {
		line = strings.TrimPrefix(line, "\ufeff")
		d.first = false
	}
	if line == "" {
		d.size = 0
		event := d.event
		d.event = ""
		if len(d.data) == 0 {
			return nil, nil
		}
		if event == "" {
			event = "message"
		}
		message := &transport.SseMessage{Event: event, Data: strings.Join(d.data, "\n")}
		d.data = nil
		return message, nil
	}
	field, value, _ := strings.Cut(line, ":")
	value = strings.TrimPrefix(value, " ")
	switch field {
	case "data":
		d.data = append(d.data, value)
	case "event":
		d.event = value
	}
	return nil, nil
}

// Finish discards unfinished data at EOF/consumer exit. It is idempotent and
// never emits a provider done event.
func (d *SSEDecoder) Finish() {
	d.closed = true
	d.line = nil
	d.data = nil
	d.event = ""
}

// DecodeUTF8 replaces malformed sequences using WHATWG maximal-subpart rules.
// Call it on complete input (or a complete SSE line), not arbitrary byte chunks.
func DecodeUTF8(input []byte) string {
	if utf8.Valid(input) {
		return string(input)
	}
	var text strings.Builder
	for len(input) > 0 {
		r, n := utf8.DecodeRune(input)
		if r == utf8.RuneError && n == 1 {
			// WHATWG consumes the valid prefix of a broken sequence once, not
			// once per byte (DecodeRune), nor once per invalid run (ToValidUTF8).
			first := input[0]
			width := 1
			low, high := byte(0x80), byte(0xbf)
			switch {
			case first >= 0xc2 && first <= 0xdf:
				width = 2
			case first >= 0xe0 && first <= 0xef:
				width = 3
				if first == 0xe0 {
					low = 0xa0
				}
				if first == 0xed {
					high = 0x9f
				}
			case first >= 0xf0 && first <= 0xf4:
				width = 4
				if first == 0xf0 {
					low = 0x90
				}
				if first == 0xf4 {
					high = 0x8f
				}
			}
			for n < width && n < len(input) {
				if input[n] < low || input[n] > high {
					break
				}
				n++
				low, high = 0x80, 0xbf
			}
		}
		text.WriteRune(r)
		input = input[n:]
	}
	return text.String()
}

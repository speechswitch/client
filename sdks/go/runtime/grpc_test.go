package runtime

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"encoding/pem"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func grpcTestFrame(data []byte) []byte {
	frame := make([]byte, 5+len(data))
	binary.BigEndian.PutUint32(frame[1:], uint32(len(data)))
	copy(frame[5:], data)
	return frame
}

func grpcTestRead(reader io.Reader) ([]byte, error) {
	var prefix [5]byte
	if _, err := io.ReadFull(reader, prefix[:]); err != nil {
		return nil, err
	}
	length := binary.BigEndian.Uint32(prefix[1:])
	if prefix[0] != 0 || length > 8*1024*1024 {
		return nil, errors.New("invalid test frame")
	}
	data := make([]byte, length)
	_, err := io.ReadFull(reader, data)
	return data, err
}

func TestGRPCFullDuplexBeforeHeadersAndHalfClose(t *testing.T) {
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ProtoMajor != 2 || r.Method != "POST" || r.URL.RequestURI() != "/api%2Fv1/Speak?tenant=one" || r.Header.Get("Authorization") != "Bearer test" || r.Header.Get("Te") != "trailers" || r.Header.Get("Grpc-Accept-Encoding") != "identity" {
			t.Errorf("request: %s %s %v", r.Method, r.URL, r.Header)
		}
		// A server may wait for config before returning response headers.
		config, err := grpcTestRead(r.Body)
		if err != nil || string(config) != "config" {
			t.Errorf("config: %s %v", config, err)
			return
		}
		w.Header().Set("Content-Type", "application/grpc+proto")
		w.Header().Set("Trailer", "Grpc-Status")
		w.Write(grpcTestFrame([]byte("early")))
		w.(http.Flusher).Flush()
		for {
			data, err := grpcTestRead(r.Body)
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Errorf("input: %v", err)
				return
			}
			frame := grpcTestFrame(data)
			w.Write(frame[:2])
			w.(http.Flusher).Flush()
			w.Write(frame[2:])
			w.(http.Flusher).Flush()
		}
		w.Header().Set("Grpc-Status", "0")
	}))
	server.EnableHTTP2 = true
	server.StartTLS()
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	headers := http.Header{"Authorization": {"Bearer test"}}
	stream, err := ConnectGRPC(ctx, server.URL+"/api%2Fv1/Speak?tenant=one", GRPCOptions{Transport: server.Client(), Header: headers})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if err := stream.Send(ctx, []byte("config")); err != nil {
		t.Fatal(err)
	}
	if data, err := stream.Receive(ctx); err != nil || string(data) != "early" {
		t.Fatalf("early: %s %v", data, err)
	}
	for _, message := range [][]byte{nil, bytes.Repeat([]byte{0, 255, 128}, 2000000)} {
		if err := stream.Send(ctx, message); err != nil {
			t.Fatal(err)
		}
		if data, err := stream.Receive(ctx); err != nil || !bytes.Equal(data, message) {
			t.Fatalf("echo length=%d error=%v", len(data), err)
		}
	}
	if err := stream.End(ctx); err != nil {
		t.Fatal(err)
	}
	if err := stream.End(ctx); err != nil {
		t.Fatal(err)
	}
	if err := stream.Send(ctx, []byte("late")); err == nil || err.Error() != "gRPC input is closed" {
		t.Fatalf("late send: %v", err)
	}
	if data, err := stream.Receive(ctx); data != nil || err != io.EOF {
		t.Fatalf("final: %x %v", data, err)
	}
	if !reflect.DeepEqual(headers, http.Header{"Authorization": {"Bearer test"}}) {
		t.Fatalf("mutated headers: %v", headers)
	}
}

type grpcTestBody struct {
	io.Reader
	closes     atomic.Int32
	closeError error
}

func (b *grpcTestBody) Close() error {
	b.closes.Add(1)
	if closer, ok := b.Reader.(io.Closer); ok {
		closer.Close()
	}
	return b.closeError
}

func TestGRPCFramingAndFinalStatusErrors(t *testing.T) {
	for _, test := range []struct {
		name                   string
		data                   []byte
		header, trailer        http.Header
		status, protocol, code int
		error                  string
	}{
		{name: "missing status", error: "gRPC response lacks a valid final status"},
		{name: "status leading zero", trailer: http.Header{"Grpc-Status": {"00"}}, error: "gRPC response lacks a valid final status"},
		{name: "status range", trailer: http.Header{"Grpc-Status": {"17"}}, error: "gRPC response lacks a valid final status"},
		{name: "duplicate status", trailer: http.Header{"Grpc-Status": {"0", "0"}}, error: "gRPC response lacks a valid final status"},
		{name: "denied", header: http.Header{"Grpc-Status": {"16"}, "Grpc-Message": {"Denied%20%F0%9F%98%80+literal"}}, code: 16, error: "Denied 😀+literal"},
		{name: "broken percent", trailer: http.Header{"Grpc-Status": {"3"}, "Grpc-Message": {"bad%xx"}}, code: 3, error: "bad%xx"},
		{name: "broken unicode", trailer: http.Header{"Grpc-Status": {"3"}, "Grpc-Message": {"bad%FF"}}, code: 3, error: "bad%FF"},
		{name: "default message", trailer: http.Header{"Grpc-Status": {"8"}}, code: 8, error: "gRPC failed with status 8"},
		{name: "empty message", trailer: http.Header{"Grpc-Status": {"8"}, "Grpc-Message": {""}}, code: 8, error: ""},
		{name: "truncated prefix", data: []byte{0, 0}, error: "Truncated gRPC message"},
		{name: "truncated payload", data: []byte{0, 0, 0, 0, 2, 1}, error: "Truncated gRPC message"},
		{name: "compression flag", data: []byte{1, 0, 0, 0, 0}, error: "Compressed gRPC messages are not supported"},
		{name: "compression header", header: http.Header{"Grpc-Encoding": {"gzip"}}, error: "Compressed gRPC messages are not supported"},
		{name: "oversized", data: []byte{0, 255, 255, 255, 255}, error: "gRPC message exceeds byte limit"},
		{name: "content type", header: http.Header{"Content-Type": {"application/grpc+json"}}, error: "gRPC returned an invalid content type"},
		{name: "http error", status: 403, error: "gRPC returned HTTP 403"},
		{name: "http1", protocol: 1, error: "gRPC requires HTTP2"},
		{name: "trailers only data", header: http.Header{"Grpc-Status": {"0"}}, data: grpcTestFrame(nil), error: "gRPC trailers-only response contained data"},
		{name: "two final blocks", header: http.Header{"Grpc-Status": {"0"}}, trailer: http.Header{"Grpc-Status": {"0"}}, error: "gRPC returned multiple final status blocks"},
		{name: "headers limit", header: http.Header{"X-Large": {strings.Repeat("x", 513)}}, error: "gRPC response headers exceed byte limit"},
		{name: "trailers limit", trailer: http.Header{"Grpc-Status": {"0"}, "Grpc-Message": {strings.Repeat("x", 513)}}, error: "gRPC trailers exceed byte limit"},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := &grpcTestBody{Reader: bytes.NewReader(test.data), closeError: errors.New("cleanup failure")}
			header := test.header.Clone()
			if header == nil {
				header = make(http.Header)
			}
			if len(header.Values("Content-Type")) == 0 {
				header.Set("Content-Type", "application/grpc")
			}
			status, protocol := test.status, test.protocol
			if status == 0 {
				status = 200
			}
			if protocol == 0 {
				protocol = 2
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			stream, err := ConnectGRPC(ctx, "https://example.invalid/Speak", GRPCOptions{MaxHeaderBytes: 512, Transport: transportFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: status, ProtoMajor: protocol, Header: header, Trailer: test.trailer, Body: body}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			data, err := stream.Receive(ctx)
			if data != nil || err == nil || err.Error() != test.error {
				t.Fatalf("result: %x %v", data, err)
			}
			var statusError *GRPCError
			if test.code != 0 && (!errors.As(err, &statusError) || statusError.StatusCode != test.code) {
				t.Fatalf("status: %v", err)
			}
			stream.Close()
			if body.closes.Load() != 1 {
				t.Fatalf("close count: %d", body.closes.Load())
			}
		})
	}
}

func TestGRPCOutputDuringBlockedWriteAndCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stream, err := ConnectGRPC(ctx, "https://example.invalid/Speak", GRPCOptions{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, ProtoMajor: 2, Header: http.Header{"Content-Type": {"application/grpc"}}, Body: io.NopCloser(bytes.NewReader(grpcTestFrame([]byte("early"))))}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	writing := make(chan error, 1)
	go func() { writing <- stream.Send(ctx, []byte("blocked")) }()
	if data, err := stream.Receive(ctx); err != nil || string(data) != "early" {
		t.Fatalf("output: %s %v", data, err)
	}
	select {
	case err := <-writing:
		t.Fatalf("write did not block: %v", err)
	default:
	}
	stream.Close()
	select {
	case err := <-writing:
		if err != io.EOF {
			t.Fatalf("write cancellation: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("write leaked")
	}
}

func TestGRPCCancelPendingHeadersReadAndIdle(t *testing.T) {
	for _, phase := range []string{"headers", "body", "idle"} {
		t.Run(phase, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			entered := make(chan struct{})
			reader, writer := io.Pipe()
			defer writer.Close()
			body := &grpcTestBody{Reader: reader}
			stream, err := ConnectGRPC(ctx, "https://example.invalid/Speak", GRPCOptions{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
				close(entered)
				if phase == "headers" {
					<-r.Context().Done()
					return nil, r.Context().Err()
				}
				return &http.Response{StatusCode: 200, ProtoMajor: 2, Header: http.Header{"Content-Type": {"application/grpc"}}, Body: body}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			<-entered
			done := make(chan error, 1)
			if phase != "idle" {
				go func() { _, err := stream.Receive(context.Background()); done <- err }()
			}
			cancel()
			if phase != "idle" {
				select {
				case err := <-done:
					if err != context.Canceled {
						t.Fatalf("cancel: %v", err)
					}
				case <-time.After(5 * time.Second):
					t.Fatal("receive leaked")
				}
			}
			<-stream.(*grpcStream).ready
			if phase != "headers" {
				stream.Close()
				if body.closes.Load() != 1 {
					t.Fatalf("close: %d", body.closes.Load())
				}
			}
		})
	}
}

func TestGRPCLateResponseAndOriginalTransportError(t *testing.T) {
	release := make(chan struct{})
	body := &grpcTestBody{Reader: bytes.NewReader(nil)}
	stream, err := ConnectGRPC(context.Background(), "https://example.invalid/Speak", GRPCOptions{Transport: transportFunc(func(*http.Request) (*http.Response, error) { <-release; return &http.Response{Body: body}, nil })})
	if err != nil {
		t.Fatal(err)
	}
	stream.Close()
	close(release)
	<-stream.(*grpcStream).ready
	if body.closes.Load() != 1 {
		t.Fatal("late response leaked")
	}
	failure := errors.New("original failure")
	stream, err = ConnectGRPC(context.Background(), "https://example.invalid/Speak?private=query", GRPCOptions{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		return nil, &url.Error{Op: "Post", URL: "private URL", Err: failure}
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if _, err := stream.Receive(context.Background()); err != failure {
		t.Fatalf("lost original failure: %v", err)
	}
}

func TestGRPCPeerStopsInputBeforeFinalError(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	body := &grpcTestBody{Reader: bytes.NewReader(grpcTestFrame([]byte("audio")))}
	stream, err := ConnectGRPC(ctx, "https://example.invalid/Speak", GRPCOptions{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		r.Body.Close()
		return &http.Response{StatusCode: 200, ProtoMajor: 2, Header: http.Header{"Content-Type": {"application/grpc"}}, Trailer: http.Header{"Grpc-Status": {"8"}, "Grpc-Message": {"Quota%20exhausted"}}, Body: body}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if err := stream.Send(ctx, []byte("text")); err != io.EOF {
		t.Fatalf("send: %v", err)
	}
	if data, err := stream.Receive(ctx); err != nil || string(data) != "audio" {
		t.Fatalf("audio: %s %v", data, err)
	}
	_, err = stream.Receive(ctx)
	var status *GRPCError
	if !errors.As(err, &status) || *status != (GRPCError{StatusCode: 8, Message: "Quota exhausted"}) {
		t.Fatalf("status: %v", err)
	}
	stream.Close()
	if body.closes.Load() != 1 {
		t.Fatalf("body close: %d", body.closes.Load())
	}
}

func TestGRPCOperationCancellation(t *testing.T) {
	for _, operation := range []string{"send", "receive", "queued send", "queued end"} {
		t.Run(operation, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			reader, writer := io.Pipe()
			defer writer.Close()
			body := &grpcTestBody{Reader: reader}
			stream, err := ConnectGRPC(ctx, "https://example.invalid/Speak", GRPCOptions{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, ProtoMajor: 2, Header: http.Header{"Content-Type": {"application/grpc"}}, Body: body}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			<-stream.(*grpcStream).ready
			queued := operation == "queued send" || operation == "queued end"
			if queued {
				stream.(*grpcStream).writeMu.Lock()
			}
			opCtx, opCancel := context.WithCancel(ctx)
			defer opCancel()
			done := make(chan error, 1)
			go func() {
				var err error
				switch operation {
				case "receive":
					_, err = stream.Receive(opCtx)
				case "queued end":
					err = stream.End(opCtx)
				default:
					err = stream.Send(opCtx, []byte("text"))
				}
				done <- err
			}()
			opCancel()
			// Cancellation must close the call even while a writer waits for its turn.
			select {
			case <-stream.(*grpcStream).stopped:
			case <-ctx.Done():
				t.Fatal("cancellation did not release the call")
			}
			if queued {
				stream.(*grpcStream).writeMu.Unlock()
			}
			select {
			case err := <-done:
				if err != context.Canceled {
					t.Fatalf("operation error: %v", err)
				}
			case <-ctx.Done():
				t.Fatal("operation leaked")
			}
			if body.closes.Load() != 1 {
				t.Fatalf("body close: %d", body.closes.Load())
			}
		})
	}
}

func TestGRPCRejectsInvalidConfigurationBeforeIO(t *testing.T) {
	for _, test := range []struct {
		name, address, error string
		options              GRPCOptions
	}{
		{name: "scheme", address: "wss://example.invalid/Speak", error: "gRPC URL must be HTTP(S) without credentials or a fragment"},
		{name: "credentials", address: "https://secret@example.invalid/Speak", error: "gRPC URL must be HTTP(S) without credentials or a fragment"},
		{name: "fragment", address: "https://example.invalid/Speak#fragment", error: "gRPC URL must be HTTP(S) without credentials or a fragment"},
		{name: "message limit", options: GRPCOptions{MaxMessageBytes: -1}, error: "gRPC byte limits must be positive uint32 values"},
		{name: "header limit", options: GRPCOptions{MaxHeaderBytes: -1}, error: "gRPC byte limits must be positive uint32 values"},
		{name: "header budget", options: GRPCOptions{MaxHeaderBytes: 1}, error: "gRPC request headers exceed byte limit"},
		{name: "header name", options: GRPCOptions{Header: http.Header{"Bad:Name": {"x"}}}, error: "Invalid gRPC request header"},
		{name: "header value", options: GRPCOptions{Header: http.Header{"Authorization": {"Bearer x\r\nOther: secret"}}}, error: "Invalid gRPC request header"},
		{name: "wire header", options: GRPCOptions{Header: http.Header{"Content-Type": {"application/json"}}}, error: "Invalid gRPC request header"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var calls atomic.Int32
			test.options.Transport = transportFunc(func(*http.Request) (*http.Response, error) {
				calls.Add(1)
				return nil, errors.New("unexpected IO")
			})
			if test.address == "" {
				test.address = "https://example.invalid/Speak"
			}
			stream, err := ConnectGRPC(context.Background(), test.address, test.options)
			if stream != nil {
				stream.Close()
				<-stream.(*grpcStream).ready
			}
			if stream != nil || err == nil || err.Error() != test.error || calls.Load() != 0 {
				t.Fatalf("configuration: stream=%v error=%v calls=%d", stream, err, calls.Load())
			}
		})
	}
	stream, err := ConnectGRPC(context.Background(), "http://example.invalid/Speak", GRPCOptions{})
	if stream != nil || err == nil || err.Error() != "Native gRPC requires HTTPS; inject an HTTP2 transport for prior-knowledge HTTP" {
		t.Fatalf("native plaintext: %v %v", stream, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if stream, err := ConnectGRPC(ctx, "https://example.invalid/Speak", GRPCOptions{}); stream != nil || err != context.Canceled {
		t.Fatalf("canceled connect: %v %v", stream, err)
	}
}

func TestGRPCOversizeSendDoesNotWritePrefix(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	input := make(chan []byte, 1)
	stream, err := ConnectGRPC(ctx, "http://example.invalid/Speak", GRPCOptions{MaxMessageBytes: 2, Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		defer r.Body.Close()
		data, err := io.ReadAll(r.Body)
		input <- data
		if err != nil {
			return nil, err
		}
		return &http.Response{StatusCode: 200, ProtoMajor: 2, Header: http.Header{"Content-Type": {"application/grpc"}, "Grpc-Status": {"0"}}, Body: io.NopCloser(bytes.NewReader(nil))}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if err := stream.Send(ctx, []byte{1, 2, 3}); err == nil || err.Error() != "gRPC message exceeds byte limit" {
		t.Fatalf("oversize: %v", err)
	}
	if err := stream.Send(ctx, []byte{1, 2}); err != nil {
		t.Fatal(err)
	}
	if err := stream.End(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := stream.Receive(ctx); err != io.EOF {
		t.Fatalf("status: %v", err)
	}
	if data := <-input; !bytes.Equal(data, []byte{0, 0, 0, 0, 2, 1, 2}) {
		t.Fatalf("wire: %x", data)
	}
}

// Isolate the test CA in a child, without disabling verification or changing the
// parent process's global roots. Forced fallback roots work on every Go platform.
func TestGRPCNativeChild(t *testing.T) {
	address := os.Getenv("SPEECHSWITCH_TEST_GRPC_URL")
	if address == "" {
		return
	}
	roots := x509.NewCertPool()
	if os.Getenv("SPEECHSWITCH_TEST_GRPC_MODE") != "untrusted" {
		certificate, err := os.ReadFile(os.Getenv("SPEECHSWITCH_TEST_GRPC_CA"))
		if err != nil || !roots.AppendCertsFromPEM(certificate) {
			t.Fatalf("test CA: %v", err)
		}
	}
	x509.SetFallbackRoots(roots)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stream, err := ConnectGRPC(ctx, address, GRPCOptions{Header: http.Header{"Authorization": {"Bearer native"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	err = stream.Send(ctx, []byte("config"))
	if err == io.EOF {
		_, err = stream.Receive(ctx)
	}
	switch os.Getenv("SPEECHSWITCH_TEST_GRPC_MODE") {
	case "no alpn":
		if err == nil || err.Error() != "gRPC requires negotiated HTTP2" {
			t.Fatalf("ALPN: %v", err)
		}
		return
	case "untrusted":
		var authority x509.UnknownAuthorityError
		if !errors.As(err, &authority) {
			t.Fatalf("certificate verification: %v", err)
		}
		return
	case "redirect":
		if err == nil || err == io.EOF {
			_, err = stream.Receive(ctx)
		}
		if err == nil || err.Error() != "gRPC returned HTTP 302" {
			t.Fatalf("redirect: %v", err)
		}
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	if data, err := stream.Receive(ctx); err != nil || string(data) != "native" {
		t.Fatalf("native: %s %v", data, err)
	}
	if err := stream.End(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := stream.Receive(ctx); err != io.EOF {
		t.Fatalf("status: %v", err)
	}
}

func TestGRPCNativeTLSAuthAndALPN(t *testing.T) {
	for _, mode := range []string{"success", "no alpn", "untrusted", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.ProtoMajor != 2 || r.Header.Get("Authorization") != "Bearer native" {
					t.Errorf("native headers: %d %v", r.ProtoMajor, r.Header)
				}
				if mode == "redirect" {
					w.Header().Set("Location", "/must-not-follow")
					w.WriteHeader(http.StatusFound)
					return
				}
				if data, err := grpcTestRead(r.Body); err != nil || string(data) != "config" {
					t.Errorf("native config: %s %v", data, err)
					return
				}
				w.Header().Set("Content-Type", "application/grpc")
				w.Header().Set("Trailer", "Grpc-Status")
				w.Write(grpcTestFrame([]byte("native")))
				w.(http.Flusher).Flush()
				if _, err := io.Copy(io.Discard, r.Body); err != nil {
					return
				}
				w.Header().Set("Grpc-Status", "0")
			}))
			server.EnableHTTP2 = mode != "no alpn"
			if mode == "no alpn" {
				server.TLS = &tls.Config{NextProtos: []string{}}
			}
			server.StartTLS()
			directory := t.TempDir()
			certificate := filepath.Join(directory, "ca.pem")
			if mode != "untrusted" {
				if err := os.WriteFile(certificate, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
					t.Fatal(err)
				}
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestGRPCNativeChild$")
			command.Env = append(os.Environ(), "SPEECHSWITCH_TEST_GRPC_URL="+server.URL+"/Speak", "SPEECHSWITCH_TEST_GRPC_CA="+certificate, "SPEECHSWITCH_TEST_GRPC_MODE="+mode, "GODEBUG="+os.Getenv("GODEBUG")+",x509usefallbackroots=1")
			output, err := command.CombinedOutput()
			cancel()
			server.Close()
			if err != nil {
				t.Fatalf("native child: %s %v", output, err)
			}
			want := int32(0)
			if mode == "success" || mode == "redirect" {
				want = 1
			}
			if calls.Load() != want {
				t.Fatalf("request count: %d want %d", calls.Load(), want)
			}
		})
	}
}

func TestGRPCNativeCancellationDuringTLS(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	hello := make(chan error, 1)
	disconnected := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			hello <- err
			return
		}
		defer conn.Close()
		conn.SetDeadline(time.Now().Add(5 * time.Second))
		var first [1]byte
		_, err = io.ReadFull(conn, first[:])
		hello <- err
		// Consume ClientHello without responding, leaving TLS setup pending.
		_, err = io.Copy(io.Discard, conn)
		disconnected <- err
	}()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stream, err := ConnectGRPC(ctx, "https://"+listener.Addr().String()+"/Speak", GRPCOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	writing := make(chan error, 1)
	go func() { writing <- stream.Send(context.Background(), []byte("config")) }()
	if err := <-hello; err != nil {
		t.Fatal(err)
	}
	cancel()
	if _, err := stream.Receive(context.Background()); err != context.Canceled {
		t.Fatalf("receive: %v", err)
	}
	select {
	case err := <-writing:
		if err != context.Canceled {
			t.Fatalf("send: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("send leaked")
	}
	select {
	case err := <-disconnected:
		if err != nil {
			t.Fatalf("TLS connection not released: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("TLS setup leaked")
	}
}

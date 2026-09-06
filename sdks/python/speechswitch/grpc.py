"""One owned, byte-native bidirectional gRPC call over asyncio HTTP/2.

No redirects, connection pool, push, compression or automatic retries. TLS uses
certificate verification and ALPN h2; http URLs use HTTP/2 prior knowledge.
"""

import asyncio
import re
import ssl
import struct
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from typing import Protocol
from urllib.parse import quote, unquote, urlsplit

from speechswitch.hpack import HpackDecoder, encode_headers


class GrpcLike(Protocol):
    async def send(self, message: bytes) -> None: ...
    async def end(self) -> None: ...
    async def receive(self) -> bytes: ...
    async def aclose(self) -> None: ...


class GrpcError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        self.status_code = status_code
        super().__init__(message)


class GrpcProtocolError(Exception):
    pass


def _frame(kind: int, flags: int, stream: int, payload: bytes) -> bytes:
    return len(payload).to_bytes(3, "big") + bytes([kind, flags]) + stream.to_bytes(4, "big") + payload


class GrpcStream:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, message_limit: int, header_limit: int) -> None:
        self._reader, self._writer = reader, writer
        self._message_limit, self._header_limit = message_limit, header_limit
        self._decoder = HpackDecoder(4096, header_limit)
        self._send_lock, self._wire_lock = asyncio.Lock(), asyncio.Lock()
        self._window = asyncio.Event()
        self._connection_window = self._stream_window = self._initial_window = 65535
        self._receive_window = 65535
        self._frame_limit = 16384
        self._queue: asyncio.Queue[tuple[bytes, int] | BaseException | None] = asyncio.Queue()
        self._pending = bytearray()
        self._closed = self._local_end = self._remote_end = self._reading = self._headers = False
        self._failure: BaseException | None = None
        self._task: asyncio.Task[None] | None = None
        self._content_length: int | None = None
        self._body_bytes = 0

    def _abort(self, error: BaseException) -> None:
        if self._failure is None:
            self._failure = error
            self._queue.put_nowait(error)
        self._closed = True
        self._window.set()
        self._writer.transport.abort()

    def _writable(self) -> None:
        if self._failure is not None:
            raise self._failure
        if self._closed or self._local_end or self._remote_end:
            raise GrpcProtocolError("gRPC input is closed")

    async def _write(self, data: bytes) -> None:
        async with self._wire_lock:
            if self._closed:
                raise self._failure or GrpcProtocolError("gRPC stream is closed")
            self._writer.write(data)
            await self._writer.drain()

    async def start(self, fields: list[tuple[bytes, bytes]]) -> None:
        if sum(len(name) + len(value) + 32 for name, value in fields) > self._header_limit:
            raise GrpcProtocolError("gRPC request headers exceed byte limit")
        block = encode_headers(fields)
        if len(block) > self._header_limit:
            raise GrpcProtocolError("gRPC request headers exceed byte limit")
        self._task = asyncio.create_task(self._read_frames())
        preface = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"
        settings = struct.pack("!HIHI", 2, 0, 6, self._header_limit)
        frames = [preface, _frame(4, 0, 0, settings)]
        for offset in range(0, len(block), 16384):
            frames.append(_frame(1 if offset == 0 else 9, 4 if offset + 16384 >= len(block) else 0, 1, block[offset:offset + 16384]))
        await self._write(b"".join(frames))

    async def send(self, message: bytes) -> None:
        if type(message) is not bytes or len(message) > self._message_limit:
            raise GrpcProtocolError("Invalid or oversized gRPC message")
        try:
            async with self._send_lock:
                self._writable()
                framed = b"\x00" + len(message).to_bytes(4, "big") + message
                offset = 0
                while offset < len(framed):
                    self._writable()
                    size = min(self._connection_window, self._stream_window, self._frame_limit, len(framed) - offset)
                    if size <= 0:
                        self._window.clear()
                        await self._window.wait()
                        continue
                    self._connection_window -= size
                    self._stream_window -= size
                    await self._write(_frame(0, 0, 1, framed[offset:offset + size]))
                    offset += size
                    await asyncio.sleep(0)
        except BaseException as error:
            self._abort(error)
            raise

    async def end(self) -> None:
        try:
            async with self._send_lock:
                if self._local_end:
                    return
                self._writable()
                self._local_end = True
                await self._write(_frame(0, 1, 1, b""))
        except BaseException as error:
            self._abort(error)
            raise

    async def receive(self) -> bytes:
        if self._reading:
            raise RuntimeError("gRPC permits one reader at a time")
        self._reading = True
        try:
            while True:
                if len(self._pending) >= 5:
                    if self._pending[0] != 0:
                        raise GrpcProtocolError("Compressed gRPC messages are not supported")
                    size = int.from_bytes(self._pending[1:5], "big")
                    if size > self._message_limit:
                        raise GrpcProtocolError("gRPC message exceeds byte limit")
                    if len(self._pending) >= size + 5:
                        message = bytes(self._pending[5:5 + size])
                        del self._pending[:5 + size]
                        return message
                if self._queue.empty() and self._remote_end:
                    if self._pending:
                        raise GrpcProtocolError("Truncated gRPC message")
                    raise StopAsyncIteration
                if self._queue.empty() and self._failure is not None:
                    raise self._failure
                item = await self._queue.get()
                if isinstance(item, BaseException):
                    raise item
                if item is None:
                    if self._pending:
                        raise GrpcProtocolError("Truncated gRPC message")
                    raise StopAsyncIteration
                data, credit = item
                self._pending.extend(data)
                # Credit is returned on consumption, not arrival: the receive
                # queue cannot grow beyond the advertised 65535-byte window.
                if credit and not self._closed and not self._remote_end:
                    self._receive_window += credit
                    update = credit.to_bytes(4, "big")
                    await self._write(_frame(8, 0, 0, update) + _frame(8, 0, 1, update))
                await asyncio.sleep(0)
        except StopAsyncIteration:
            raise
        except BaseException as error:
            self._abort(error)
            raise
        finally:
            self._reading = False

    def _response_headers(self, block: bytes, end: bool) -> None:
        fields = self._decoder.decode(block)
        headers: dict[bytes, bytes] = {}
        regular = False
        for name, value in fields:
            if not re.fullmatch(rb":?[!#$%&'*+.^_`|~0-9a-z-]+", name) or any(byte < 32 and byte != 9 or byte == 127 for byte in value) or value[:1] in (b" ", b"\t") or value[-1:] in (b" ", b"\t"):
                raise GrpcProtocolError("Invalid HTTP/2 response header")
            if name.startswith(b":"):
                if regular or self._headers or name != b":status" or name in headers:
                    raise GrpcProtocolError("Invalid HTTP/2 response pseudo-header")
            else:
                regular = True
            if name in (b"connection", b"proxy-connection", b"keep-alive", b"transfer-encoding", b"upgrade"):
                raise GrpcProtocolError("Forbidden HTTP/2 connection header")
            if name in headers and name in (b"grpc-status", b"grpc-message", b"content-type", b"content-length"):
                raise GrpcProtocolError("Duplicate gRPC response header")
            headers[name] = value
        if not self._headers:
            status = headers.get(b":status", b"")
            if re.fullmatch(rb"1\d\d", status) and status != b"101" and not end:
                return
            if status != b"200":
                raise GrpcProtocolError("gRPC returned a non-200 HTTP status")
            if not re.fullmatch(rb"application/grpc(?:\+proto)?(?:;.*)?", headers.get(b"content-type", b"")):
                raise GrpcProtocolError("gRPC returned an invalid content type")
            length = headers.get(b"content-length")
            if length is not None:
                if not re.fullmatch(rb"\d+", length) or len(length) > 20:
                    raise GrpcProtocolError("Invalid HTTP/2 content length")
                self._content_length = int(length)
            self._headers = True
        elif not end:
            raise GrpcProtocolError("gRPC trailers must end the stream")
        elif b"content-length" in headers:
            raise GrpcProtocolError("HTTP/2 content length is forbidden in trailers")
        if end:
            if self._content_length is not None and self._content_length != self._body_bytes:
                raise GrpcProtocolError("HTTP/2 content length mismatch")
            status = headers.get(b"grpc-status", b"")
            if not re.fullmatch(rb"\d+", status) or len(status) > 2 or int(status) > 16:
                raise GrpcProtocolError("gRPC response lacks a valid final status")
            if int(status) != 0:
                message = unquote(headers.get(b"grpc-message", b"gRPC request failed").decode("utf-8", "replace"))
                raise GrpcError(int(status), message)
            self._remote_end = True
            self._window.set()
            self._queue.put_nowait(None)
        elif b"grpc-status" in headers:
            raise GrpcProtocolError("gRPC final status precedes stream end")

    async def _read_frames(self) -> None:
        first = True
        block: bytearray | None = None
        end_headers = False
        try:
            while not self._remote_end:
                header = await self._reader.readexactly(9)
                size, kind, flags, stream = int.from_bytes(header[:3], "big"), header[3], header[4], int.from_bytes(header[5:], "big") & 0x7FFFFFFF
                if size > 16384:
                    raise GrpcProtocolError("HTTP/2 frame exceeds advertised size")
                if first and (kind != 4 or flags & 1 or stream != 0):
                    raise GrpcProtocolError("HTTP/2 server preface must be SETTINGS")
                first = False
                if block is not None and (kind != 9 or stream != 1):
                    raise GrpcProtocolError("Interrupted HTTP/2 header block")
                payload = await self._reader.readexactly(size)
                if kind == 4:
                    if stream or (flags & 1 and size) or size % 6:
                        raise GrpcProtocolError("Invalid HTTP/2 SETTINGS frame")
                    if not flags & 1:
                        for offset in range(0, size, 6):
                            setting, value = struct.unpack("!HI", payload[offset:offset + 6])
                            if setting == 2 and value != 0:
                                raise GrpcProtocolError("Server enabled HTTP/2 push")
                            if setting == 4:
                                if value > 0x7FFFFFFF or self._stream_window + value - self._initial_window > 0x7FFFFFFF:
                                    raise GrpcProtocolError("Invalid HTTP/2 initial window")
                                self._stream_window += value - self._initial_window
                                self._initial_window = value
                                self._window.set()
                            if setting == 5:
                                if not 16384 <= value <= 0xFFFFFF:
                                    raise GrpcProtocolError("Invalid HTTP/2 maximum frame size")
                                self._frame_limit = value
                        await self._write(_frame(4, 1, 0, b""))
                elif kind == 6:
                    if stream or size != 8:
                        raise GrpcProtocolError("Invalid HTTP/2 PING frame")
                    if not flags & 1:
                        await self._write(_frame(6, 1, 0, payload))
                elif kind == 8:
                    if size != 4 or stream not in (0, 1):
                        raise GrpcProtocolError("Invalid HTTP/2 WINDOW_UPDATE frame")
                    increment = int.from_bytes(payload, "big") & 0x7FFFFFFF
                    current = self._stream_window if stream else self._connection_window
                    if increment == 0 or current + increment > 0x7FFFFFFF:
                        raise GrpcProtocolError("Invalid HTTP/2 flow-control window")
                    if stream:
                        self._stream_window += increment
                    else:
                        self._connection_window += increment
                    self._window.set()
                elif kind in (1, 9):
                    if stream != 1 or (kind == 9 and block is None):
                        raise GrpcProtocolError("Invalid HTTP/2 header stream")
                    if kind == 1:
                        end_headers = bool(flags & 1)
                        if flags & 8:
                            if not payload or payload[0] >= len(payload):
                                raise GrpcProtocolError("Invalid HTTP/2 header padding")
                            payload = payload[1:len(payload) - payload[0]]
                        if flags & 32:
                            if len(payload) < 5 or int.from_bytes(payload[:4], "big") & 0x7FFFFFFF == 1:
                                raise GrpcProtocolError("Invalid HTTP/2 header priority")
                            payload = payload[5:]
                        block = bytearray()
                    assert block is not None
                    if len(payload) > self._header_limit - len(block):
                        raise GrpcProtocolError("HTTP/2 header block exceeds byte limit")
                    block.extend(payload)
                    if flags & 4:
                        self._response_headers(bytes(block), end_headers)
                        block = None
                elif kind == 0:
                    if stream != 1 or not self._headers:
                        raise GrpcProtocolError("HTTP/2 DATA precedes response headers")
                    self._receive_window -= size
                    if self._receive_window < 0:
                        raise GrpcProtocolError("HTTP/2 peer exceeded receive window")
                    if flags & 8:
                        if not payload or payload[0] >= len(payload):
                            raise GrpcProtocolError("Invalid HTTP/2 data padding")
                        payload = payload[1:len(payload) - payload[0]]
                    if size:
                        self._body_bytes += len(payload)
                        if self._content_length is not None and self._body_bytes > self._content_length:
                            raise GrpcProtocolError("HTTP/2 content length mismatch")
                        self._queue.put_nowait((payload, size))
                    if flags & 1:
                        raise GrpcProtocolError("gRPC response lacks a valid final status")
                elif kind == 3:
                    if stream != 1 or size != 4:
                        raise GrpcProtocolError("Invalid HTTP/2 RST_STREAM frame")
                    raise GrpcProtocolError(f"HTTP/2 stream reset ({int.from_bytes(payload, 'big')})")
                elif kind == 7:
                    if stream or size < 8:
                        raise GrpcProtocolError("Invalid HTTP/2 GOAWAY frame")
                    last, code = struct.unpack("!II", payload[:8])
                    if last & 0x7FFFFFFF < 1 or code:
                        raise GrpcProtocolError(f"HTTP/2 connection closed ({code})")
                elif kind == 2:
                    if not stream or size != 5 or int.from_bytes(payload[:4], "big") & 0x7FFFFFFF == stream:
                        raise GrpcProtocolError("Invalid HTTP/2 PRIORITY frame")
                elif kind == 5:
                    raise GrpcProtocolError("HTTP/2 server push is disabled")
                await asyncio.sleep(0)
        except asyncio.CancelledError:
            raise
        except asyncio.IncompleteReadError:
            self._abort(GrpcProtocolError("HTTP/2 closed before gRPC final status"))
        except Exception as error:
            self._abort(error)

    async def aclose(self) -> None:
        # Abort TCP before awaiting any task: a blocked drain/window must not
        # prevent release, and the caller owns producer cancellation separately.
        if not self._closed:
            self._abort(GrpcProtocolError("gRPC stream is closed"))
        if self._task is not None:
            task, self._task = self._task, None
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self._pending.clear()
        while not self._queue.empty():
            self._queue.get_nowait()
        self._queue.put_nowait(self._failure or GrpcProtocolError("gRPC stream is closed"))


@asynccontextmanager
async def connect_grpc(url: str, *, headers: Mapping[str, str],
                       ssl_context: ssl.SSLContext | None = None,
                       max_message_bytes: int = 64 * 1024 * 1024,
                       max_header_bytes: int = 64 * 1024) -> AsyncIterator[GrpcStream]:
    """Use async with; cancellation and consumer exit release the owned socket.

    An SSLContext is an explicit trust override and must permit ALPN h2. No
    credentials are inferred here: the provider boundary supplies headers.
    """
    if type(max_message_bytes) is not int or not 0 < max_message_bytes <= 0xFFFFFFFF or type(max_header_bytes) is not int or not 0 < max_header_bytes <= 0xFFFFFFFF:
        raise ValueError("gRPC byte limits must be positive uint32 integers")
    try:
        target = urlsplit(url)
        host = target.hostname
        port = target.port if target.port is not None else (443 if target.scheme == "https" else 80)
        if target.scheme not in ("http", "https") or not host or target.username is not None or target.password is not None or target.fragment or any(c.isspace() or ord(c) < 32 or c == "\\" for c in url):
            raise ValueError()
        host = host.encode("idna").decode("ascii")
    except (ValueError, UnicodeError):
        raise ValueError("gRPC URL must be HTTP(S) without credentials or a fragment") from None
    if target.scheme == "http" and ssl_context is not None:
        raise ValueError("SSLContext requires an HTTPS URL")
    authority = f"[{host}]" if ":" in host else host
    if target.port is not None:
        authority += f":{port}"
    path = quote(target.path or "/", safe="/%:@!$&'()*+,;=-._~")
    if target.query:
        path += "?" + quote(target.query, safe="/%?:@!$&'()*+,;=-._~")
    fields = [(b":method", b"POST"), (b":scheme", target.scheme.encode()), (b":authority", authority.encode()), (b":path", path.encode()),
              (b"content-type", b"application/grpc"), (b"te", b"trailers"), (b"grpc-accept-encoding", b"identity")]
    protected = {"connection", "proxy-connection", "keep-alive", "transfer-encoding", "upgrade", "host", "content-length", "content-type", "te", "grpc-encoding", "grpc-accept-encoding"}
    seen: set[str] = set()
    for name, value in headers.items():
        name = name.lower()
        if not re.fullmatch(r"[!#$%&'*+.^_`|~0-9a-z-]+", name) or name in protected or name in seen or any(ord(c) < 32 or ord(c) > 126 for c in value) or value.startswith(" ") or value.endswith(" "):
            raise ValueError("Invalid gRPC request header")
        seen.add(name)
        fields.append((name.encode("ascii"), value.encode("ascii")))
    context = None
    if target.scheme == "https":
        context = ssl_context if ssl_context is not None else ssl.create_default_context()
        context.set_alpn_protocols(["h2"])
    reader, writer = await asyncio.open_connection(host, port, ssl=context, server_hostname=host if context is not None else None)
    stream = GrpcStream(reader, writer, max_message_bytes, max_header_bytes)
    try:
        if context is not None:
            peer: ssl.SSLObject | None = writer.get_extra_info("ssl_object")
            if peer is None or peer.selected_alpn_protocol() != "h2":
                raise GrpcProtocolError("TLS peer did not negotiate HTTP/2")
        await stream.start(fields)
        yield stream
    finally:
        await stream.aclose()

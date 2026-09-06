"""Native asyncio WebSockets without third-party runtime dependencies.

RFC 6455 client framing: no extensions, compression, redirects or proxy discovery.
Providers own authentication, protocol codecs and connection creation.
"""

import asyncio
import base64
import hashlib
import os
import re
import ssl
import struct
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from typing import Protocol
from urllib.parse import quote, urlsplit


class WebSocketLike(Protocol):
    async def send(self, message: str | bytes) -> None:
        """Send one complete message, honoring cancellation and backpressure."""
        ...

    async def receive(self) -> str | bytes:
        """Read one message; normal close raises StopAsyncIteration.

        One reader at a time. Cancellation must release the connection.
        """
        ...

    async def aclose(self) -> None:
        """Release the connection and unblock pending reads/writes promptly."""
        ...


class WebSocketError(Exception):
    pass


class WebSocketClosed(WebSocketError):
    def __init__(self, code: int, reason: str = "") -> None:
        self.code = code
        self.reason = reason
        super().__init__(f"WebSocket closed ({code})")


def _frame(opcode: int, payload: bytes) -> bytes:
    size = len(payload)
    header = bytes([0x80 | opcode])
    if size < 126:
        header += bytes([0x80 | size])
    elif size < 65536:
        header += b"\xfe" + struct.pack("!H", size)
    else:
        header += b"\xff" + struct.pack("!Q", size)
    mask = os.urandom(4)
    return header + mask + bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))


class WebSocket:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, max_message_bytes: int) -> None:
        self._reader = reader
        self._writer = writer
        self._limit = max_message_bytes
        self._send_lock = asyncio.Lock()
        self._reading = False
        self._closed = False

    def _abort(self) -> None:
        self._closed = True
        self._writer.transport.abort()

    async def _send(self, opcode: int, payload: bytes) -> None:
        try:
            async with self._send_lock:
                if self._closed:
                    raise WebSocketClosed(1006)
                self._writer.write(_frame(opcode, payload))
                await self._writer.drain()
        except BaseException:
            self._abort()
            raise

    async def send(self, message: str | bytes) -> None:
        payload = message.encode("utf-8") if isinstance(message, str) else message
        if len(payload) > self._limit:
            raise WebSocketError("WebSocket message exceeds byte limit")
        await self._send(1 if isinstance(message, str) else 2, payload)

    async def receive(self) -> str | bytes:
        if self._reading:
            raise RuntimeError("WebSocket permits one reader at a time")
        if self._closed:
            raise StopAsyncIteration
        self._reading = True
        data = bytearray()
        message_opcode = 0
        try:
            while not self._closed:
                first, second = await self._reader.readexactly(2)
                final, opcode = bool(first & 0x80), first & 15
                if first & 0x70 or second & 0x80 or opcode not in (0, 1, 2, 8, 9, 10):
                    raise WebSocketError("Invalid WebSocket frame header")
                length = second & 127
                if opcode >= 8 and (not final or length > 125):
                    raise WebSocketError("Invalid WebSocket control frame")
                if length == 126:
                    length = struct.unpack("!H", await self._reader.readexactly(2))[0]
                    if length < 126:
                        raise WebSocketError("Nonminimal WebSocket frame length")
                elif length == 127:
                    length = struct.unpack("!Q", await self._reader.readexactly(8))[0]
                    if length < 65536 or length >= 1 << 63:
                        raise WebSocketError("Invalid WebSocket frame length")
                if opcode < 8:
                    if (opcode == 0) != (message_opcode != 0):
                        raise WebSocketError("Invalid WebSocket fragmentation")
                    if length > self._limit - len(data):
                        raise WebSocketError("WebSocket message exceeds byte limit")
                payload = await self._reader.readexactly(length)
                if opcode == 8:
                    if len(payload) == 1:
                        raise WebSocketError("Invalid WebSocket close payload")
                    code = struct.unpack("!H", payload[:2])[0] if payload else 1005
                    if payload and not (code in (1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014) or 3000 <= code <= 4999):
                        raise WebSocketError("Invalid WebSocket close code")
                    reason = payload[2:].decode("utf-8")
                    await self._send(8, payload)
                    self._abort()
                    if code not in (1000, 1005):
                        raise WebSocketClosed(code, reason)
                    raise StopAsyncIteration
                if opcode == 9:
                    await self._send(10, payload)
                    continue
                if opcode == 10:
                    continue
                if opcode:
                    message_opcode = opcode
                data.extend(payload)
                if final:
                    return data.decode("utf-8") if message_opcode == 1 else bytes(data)
            raise StopAsyncIteration
        except asyncio.IncompleteReadError:
            self._abort()
            raise WebSocketClosed(1006) from None
        except UnicodeDecodeError:
            self._abort()
            raise WebSocketError("Invalid WebSocket UTF-8") from None
        except BaseException:
            self._abort()
            raise
        finally:
            self._reading = False

    async def aclose(self) -> None:
        if not self._closed:
            try:
                # Best effort close notification; cleanup never waits for a peer
                # handshake or a stuck transport drain. Cancellation aborts TCP.
                if not self._writer.is_closing():
                    self._writer.write(_frame(8, struct.pack("!H", 1000)))
            finally:
                self._abort()


@asynccontextmanager
async def connect_websocket(
    url: str,
    *,
    headers: Mapping[str, str] | None = None,
    ssl_context: ssl.SSLContext | None = None,
    max_message_bytes: int = 4 * 1024 * 1024,
    max_header_bytes: int = 64 * 1024,
) -> AsyncIterator[WebSocket]:
    """Own a direct ws/wss connection with certificate verification by default.

    Always use async with. A supplied SSLContext is an explicit trust override.
    Native authorization headers are supported; credentials are never redirected.
    """
    if type(max_message_bytes) is not int or max_message_bytes <= 0 or type(max_header_bytes) is not int or max_header_bytes <= 0:
        raise ValueError("WebSocket byte limits must be positive integers")
    try:
        target = urlsplit(url)
        host = target.hostname
        port = target.port if target.port is not None else (443 if target.scheme == "wss" else 80)
        if target.scheme not in ("ws", "wss") or not host or target.username is not None or target.password is not None or target.fragment or any(character.isspace() or ord(character) < 32 or character == "\\" for character in url):
            raise ValueError
        host = host.encode("idna").decode("ascii")
    except (ValueError, UnicodeError):
        raise ValueError("WebSocket URL must be ws/wss without credentials or a fragment") from None
    if target.scheme == "ws" and ssl_context is not None:
        raise ValueError("SSLContext requires a wss URL")
    authority = f"[{host}]" if ":" in host else host
    if target.port is not None:
        authority += f":{port}"
    path = quote(target.path or "/", safe="/%:@!$&'()*+,;=-._~")
    if target.query:
        path += "?" + quote(target.query, safe="/%?:@!$&'()*+,;=-._~")
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request_headers = {"Host": authority, "Upgrade": "websocket", "Connection": "Upgrade", "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": "13"}
    protected = {name.lower() for name in request_headers} | {"sec-websocket-extensions", "sec-websocket-protocol", "content-length", "transfer-encoding"}
    for name, value in (headers or {}).items():
        if not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name) or name.lower() in protected or any(ord(character) < 32 or ord(character) > 126 for character in value):
            raise ValueError("Invalid WebSocket request header")
        request_headers[name] = value
    handshake = (f"GET {path} HTTP/1.1\r\n" + "".join(f"{name}: {value}\r\n" for name, value in request_headers.items()) + "\r\n").encode("ascii")
    tls = (ssl_context or ssl.create_default_context()) if target.scheme == "wss" else None
    reader, writer = await asyncio.open_connection(host, port, ssl=tls, server_hostname=host if tls else None, limit=max_header_bytes)
    try:
        writer.write(handshake)
        await writer.drain()
        try:
            raw = await reader.readuntil(b"\r\n\r\n")
        except (asyncio.LimitOverrunError, asyncio.IncompleteReadError):
            raise WebSocketError("Invalid or oversized WebSocket handshake") from None
        if len(raw) > max_header_bytes:
            raise WebSocketError("Invalid or oversized WebSocket handshake")
        lines = raw[:-4].split(b"\r\n")
        status = lines[0].split(b" ", 2)
        if len(status) < 2 or status[0] != b"HTTP/1.1" or status[1] != b"101":
            raise WebSocketError("WebSocket handshake was not accepted")
        response: dict[bytes, list[bytes]] = {}
        for line in lines[1:]:
            name, separator, value = line.partition(b":")
            if not separator or not re.fullmatch(rb"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name) or any(byte < 32 and byte != 9 or byte == 127 for byte in value):
                raise WebSocketError("Invalid WebSocket response header")
            response.setdefault(name.lower(), []).append(value.strip(b" \t"))
        upgrade = [token.strip().lower() for value in response.get(b"upgrade", []) for token in value.split(b",")]
        connection = [token.strip().lower() for value in response.get(b"connection", []) for token in value.split(b",")]
        expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii"), usedforsecurity=False).digest())
        if upgrade != [b"websocket"] or b"upgrade" not in connection or response.get(b"sec-websocket-accept") != [expected] or b"sec-websocket-extensions" in response or b"sec-websocket-protocol" in response:
            raise WebSocketError("Invalid WebSocket upgrade response")
        socket = WebSocket(reader, writer, max_message_bytes)
        try:
            yield socket
        finally:
            await socket.aclose()
    except BaseException:
        writer.transport.abort()
        raise

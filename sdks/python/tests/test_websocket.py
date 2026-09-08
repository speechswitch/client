import asyncio
import base64
import hashlib
import struct
import unittest
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import cast
from unittest.mock import patch

from speechswitch.websocket import WebSocket, WebSocketClosed, WebSocketError, connect_websocket

type Handler = Callable[[asyncio.StreamReader, asyncio.StreamWriter], Awaitable[None]]


async def upgrade(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> tuple[bytes, dict[bytes, bytes]]:
    lines = (await reader.readuntil(b"\r\n\r\n"))[:-4].split(b"\r\n")
    headers = {name.lower(): value.strip() for name, value in (line.split(b":", 1) for line in lines[1:])}
    accept = base64.b64encode(hashlib.sha1(headers[b"sec-websocket-key"] + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11", usedforsecurity=False).digest())
    writer.write(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: WebSocket\r\nConnection: keep-alive, Upgrade\r\nSec-WebSocket-Accept: " + accept + b"\r\n\r\n")
    await writer.drain()
    return lines[0], headers


async def client_frame(reader: asyncio.StreamReader) -> tuple[int, bytes]:
    first, second = await reader.readexactly(2)
    assert first & 0x80 == 0x80
    assert second & 0x80 == 0x80
    length = second & 127
    if length == 126:
        length = struct.unpack("!H", await reader.readexactly(2))[0]
        assert length >= 126
    elif length == 127:
        length = struct.unpack("!Q", await reader.readexactly(8))[0]
        assert length >= 65536
    mask = await reader.readexactly(4)
    data = await reader.readexactly(length)
    return first & 15, bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))


@asynccontextmanager
async def server(handler: Handler) -> AsyncIterator[str]:
    tasks: set[asyncio.Task[None]] = set()
    errors: list[Exception] = []

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await handler(reader, writer)
        except Exception as error:
            errors.append(error)
        finally:
            writer.transport.abort()

    def connected(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        task = asyncio.create_task(handle(reader, writer))
        tasks.add(task)

    listener = await asyncio.start_server(connected, "127.0.0.1", 0)
    try:
        async with asyncio.timeout(3):
            yield f"ws://127.0.0.1:{listener.sockets[0].getsockname()[1]}"
    finally:
        listener.close()
        await listener.wait_closed()
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if errors:
            raise ExceptionGroup("loopback WebSocket server failed", errors)


class WebSocketTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_auth_and_masked_text_binary_frames(self) -> None:
        received = asyncio.Event()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            path, headers = await upgrade(reader, writer)
            self.assertEqual(path, b"GET /prefix%20path?token=a%2Bb HTTP/1.1")
            self.assertEqual(headers[b"authorization"], b"Bearer native-test")
            self.assertEqual(headers[b"sec-websocket-version"], b"13")
            self.assertEqual(len(base64.b64decode(headers[b"sec-websocket-key"])), 16)
            for expected in [(1, "π🚀".encode()), (2, b"\0\xff"), (2, b"x" * 126), (2, b"y" * 65536)]:
                self.assertEqual(await client_frame(reader), expected)
            received.set()
            await reader.read()
        async with server(handle) as url:
            async with connect_websocket(url + "/prefix%20path?token=a%2Bb", headers={"Authorization": "Bearer native-test"}) as socket:
                await socket.send("π🚀")
                for data in (b"\0\xff", b"x" * 126, b"y" * 65536):
                    await socket.send(data)
                await received.wait()

    async def test_fragmented_utf8_ping_binary_and_normal_close(self) -> None:
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await upgrade(reader, writer)
            for byte in b"\x01\x02\xf0\x9f\x89\x02\0\xff\x80\x02\x9a\x80\x82\x02\0\xff":
                writer.write(bytes([byte]))
                await writer.drain()
            self.assertEqual(await client_frame(reader), (10, b"\0\xff"))
            writer.write(b"\x88\x02\x03\xe8")
            await writer.drain()
            self.assertEqual(await client_frame(reader), (8, b"\x03\xe8"))
        async with server(handle) as url:
            async with connect_websocket(url) as socket:
                self.assertEqual(await socket.receive(), "🚀")
                self.assertEqual(await socket.receive(), b"\0\xff")
                with self.assertRaises(StopAsyncIteration):
                    await socket.receive()

    async def test_invalid_frames_are_terminal_and_bounded(self) -> None:
        cases = [
            (b"\xc1\0", "Invalid WebSocket frame header"),
            (b"\x81\x80", "Invalid WebSocket frame header"),
            (b"\x83\0", "Invalid WebSocket frame header"),
            (b"\x09\0", "Invalid WebSocket control frame"),
            (b"\x89\x7e", "Invalid WebSocket control frame"),
            (b"\x81\x7e\0\x01", "Nonminimal WebSocket frame length"),
            (b"\x81\x7f" + struct.pack("!Q", 1), "Invalid WebSocket frame length"),
            (b"\x81\x7f" + struct.pack("!Q", 1 << 63), "Invalid WebSocket frame length"),
            (b"\x80\0", "Invalid WebSocket fragmentation"),
            (b"\x01\x01a\x81\0", "Invalid WebSocket fragmentation"),
            (b"\x81\x03", "WebSocket message exceeds byte limit"),
            (b"\x01\x02ab\x80\x01", "WebSocket message exceeds byte limit"),
            (b"\x81\x01\xff", "Invalid WebSocket UTF-8"),
            (b"\x88\x01\0", "Invalid WebSocket close payload"),
            (b"\x88\x02\x03\xed", "Invalid WebSocket close code"),
            (b"\x88\x02\x03\xee", "Invalid WebSocket close code"),
            (b"\x88\x03\x03\xe8\xff", "Invalid WebSocket UTF-8"),
        ]
        for frame, expected in cases:
            with self.subTest(frame=frame):
                ended = asyncio.Event()
                async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
                    await upgrade(reader, writer)
                    writer.write(frame)
                    await writer.drain()
                    self.assertEqual(await reader.read(), b"")
                    ended.set()
                async with server(handle) as url:
                    async with connect_websocket(url, max_message_bytes=2) as socket:
                        with self.assertRaises(WebSocketError) as caught:
                            await socket.receive()
                        self.assertEqual(str(caught.exception), expected)
                        await ended.wait()

    async def test_abnormal_close_keeps_reason_separate(self) -> None:
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await upgrade(reader, writer)
            writer.write(b"\x88\x08\x03\xf3opaque")
            await writer.drain()
            self.assertEqual(await client_frame(reader), (8, b"\x03\xf3opaque"))
        async with server(handle) as url:
            async with connect_websocket(url) as socket:
                with self.assertRaises(WebSocketClosed) as caught:
                    await socket.receive()
                self.assertEqual((caught.exception.code, caught.exception.reason, str(caught.exception)), (1011, "opaque", "WebSocket closed (1011)"))

    async def test_handshake_rejection_and_header_bounds(self) -> None:
        for response, expected in [
            (b"HTTP/1.1 302 Found\r\nLocation: ws://other.invalid\r\n\r\n", "WebSocket handshake was not accepted"),
            (b"HTTP/1.1 101 Switching\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: wrong\r\n\r\n", "Invalid WebSocket upgrade response"),
            (b"HTTP/1.1 101 Switching\r\n folded: invalid\r\n\r\n", "Invalid WebSocket response header"),
            (b"HTTP/1.1 101 Switching\r\nX-Long: " + b"x" * 200 + b"\r\n\r\n", "Invalid or oversized WebSocket handshake"),
        ]:
            with self.subTest(expected=expected):
                ended = asyncio.Event()
                async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
                    await reader.readuntil(b"\r\n\r\n")
                    writer.write(response)
                    await writer.drain()
                    self.assertEqual(await reader.read(), b"")
                    ended.set()
                async with server(handle) as url:
                    with self.assertRaises(WebSocketError) as caught:
                        async with connect_websocket(url, max_header_bytes=150):
                            self.fail("bad handshake accepted")
                    self.assertEqual(str(caught.exception), expected)
                    await ended.wait()

    async def test_cancellation_before_headers_and_during_read(self) -> None:
        for established in (False, True):
            entered, ended = asyncio.Event(), asyncio.Event()
            async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
                if established:
                    await upgrade(reader, writer)
                else:
                    await reader.readuntil(b"\r\n\r\n")
                entered.set()
                await reader.read()
                ended.set()
            async with server(handle) as url:
                async def run() -> None:
                    async with connect_websocket(url) as socket:
                        await socket.receive()
                task = asyncio.create_task(run())
                await entered.wait()
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                await ended.wait()

    async def test_close_unblocks_pending_receive(self) -> None:
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await upgrade(reader, writer)
            await reader.read()
        async with server(handle) as url:
            async with connect_websocket(url) as socket:
                task = asyncio.create_task(socket.receive())
                await asyncio.sleep(0)
                await socket.aclose()
                with self.assertRaises(WebSocketClosed) as caught:
                    await task
                self.assertEqual(caught.exception.code, 1006)
                await socket.aclose()

    async def test_send_cancellation_aborts_backpressured_transport(self) -> None:
        entered, aborted = asyncio.Event(), asyncio.Event()
        class Writer:
            transport: "Writer"
            def __init__(self) -> None:
                self.transport = self
            def write(self, data: bytes) -> None:
                pass
            async def drain(self) -> None:
                entered.set()
                await aborted.wait()
                raise ConnectionResetError("aborted")
            def abort(self) -> None:
                aborted.set()
        socket = WebSocket(asyncio.StreamReader(), cast(asyncio.StreamWriter, Writer()), 1024)
        task = asyncio.create_task(socket.send("hello"))
        await entered.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(aborted.is_set(), True)

    async def test_exact_masking_and_pre_network_checks(self) -> None:
        class Writer:
            data: bytes = b""
            def write(self, data: bytes) -> None:
                self.data = data
            async def drain(self) -> None:
                pass
        writer = Writer()
        socket = WebSocket(asyncio.StreamReader(), cast(asyncio.StreamWriter, writer), 1024)
        with patch("speechswitch.websocket.os.urandom", return_value=b"\x37\xfa\x21\x3d"):
            await socket.send("Hello")
        self.assertEqual(writer.data, b"\x81\x85\x37\xfa\x21\x3d\x7f\x9f\x4d\x51\x58")
        for headers in [{"Authorization": "bad\r\nHeader: value"}, {"Host": "override"}, {"Sec-WebSocket-Extensions": "permessage-deflate"}, {"bad name": "x"}]:
            with self.assertRaises(ValueError) as caught:
                async with connect_websocket("ws://127.0.0.1:0", headers=headers):
                    self.fail("invalid header sent")
            self.assertEqual(str(caught.exception), "Invalid WebSocket request header")
        for url in ["http://example.invalid", "wss://user:password@example.invalid", "wss://example.invalid/#fragment", "wss://example.invalid\\@other.invalid"]:
            with self.assertRaises(ValueError) as caught:
                async with connect_websocket(url):
                    self.fail("invalid URL used")
            self.assertEqual(str(caught.exception), "WebSocket URL must be ws/wss without credentials or a fragment")

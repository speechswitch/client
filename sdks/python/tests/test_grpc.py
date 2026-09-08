import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
import json
from pathlib import Path
import ssl
import struct
import tempfile
from typing import cast
import unittest

from speechswitch.grpc import GrpcError, GrpcProtocolError, connect_grpc
from speechswitch.hpack import HpackDecoder, encode_headers


def frame(kind: int, flags: int, stream: int, payload: bytes = b"") -> bytes:
    return len(payload).to_bytes(3, "big") + bytes([kind, flags]) + stream.to_bytes(4, "big") + payload


async def read_frame(reader: asyncio.StreamReader) -> tuple[int, int, int, bytes]:
    header = await reader.readexactly(9)
    return header[3], header[4], int.from_bytes(header[5:], "big"), await reader.readexactly(int.from_bytes(header[:3], "big"))


@asynccontextmanager
async def raw_server(handler: Callable[[asyncio.StreamReader, asyncio.StreamWriter], Awaitable[None]]) -> AsyncIterator[str]:
    tasks: list[asyncio.Task[None]] = []

    async def run(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            if await reader.readexactly(24) != b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n":
                raise AssertionError("Invalid client preface")
            await handler(reader, writer)
        finally:
            writer.transport.abort()

    def connected(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        tasks.append(asyncio.create_task(run(reader, writer)))

    listener = await asyncio.start_server(connected, "127.0.0.1", 0)
    try:
        async with asyncio.timeout(5):
            yield f"http://127.0.0.1:{listener.sockets[0].getsockname()[1]}/speech/Synthesize"
    finally:
        listener.close()
        await listener.wait_closed()
        for task in tasks:
            if not task.done():
                task.cancel()
        errors = await asyncio.gather(*tasks, return_exceptions=True)
        for error in errors:
            if isinstance(error, Exception):
                raise error


@asynccontextmanager
async def node_server(mode: str, cert: str = "", key: str = "") -> AsyncIterator[tuple[str, asyncio.StreamReader]]:
    process = await asyncio.create_subprocess_exec("node", str(Path(__file__).with_name("grpc-server.mjs")), mode, *([cert, key] if cert else []), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    assert process.stdout is not None and process.stderr is not None
    try:
        async with asyncio.timeout(10):
            port = int(await process.stdout.readline())
            yield f"{'https' if cert else 'http'}://127.0.0.1:{port}/prefix/speech/Synthesize?tenant=one", process.stdout
    finally:
        if process.returncode is None:
            process.terminate()
        await process.wait()
        errors = await process.stderr.read()
        if errors:
            raise AssertionError(errors.decode())


class GrpcTests(unittest.IsolatedAsyncioTestCase):
    async def test_wire_input_type_and_size_are_checked_without_sending(self) -> None:
        async with node_server("echo") as (url, _):
            async with connect_grpc(url, headers={}, max_message_bytes=1) as stream:
                for invalid in ("text", bytearray([1]), None, b"too long"):
                    with self.assertRaises(GrpcProtocolError) as caught:
                        await stream.send(cast(bytes, invalid))
                    self.assertEqual(str(caught.exception), "Invalid or oversized gRPC message")
                await stream.send(b"x")
                self.assertEqual(await stream.receive(), b"x")
                await stream.end()
                with self.assertRaises(StopAsyncIteration):
                    await stream.receive()

    async def test_native_node_interop_early_audio_flow_control_and_headers(self) -> None:
        async with node_server("echo") as (url, events):
            async with connect_grpc(url, headers={"Authorization": "Bearer test", "x-goog-api-key": "key", "x-goog-user-project": "quota"}) as stream:
                record = cast(dict[str, dict[str, str]], json.loads(await events.readline()))
                expected = {":method": "POST", ":scheme": "http", ":authority": url.split("/")[2], ":path": "/prefix/speech/Synthesize?tenant=one", "content-type": "application/grpc", "te": "trailers", "grpc-accept-encoding": "identity", "authorization": "Bearer test", "x-goog-api-key": "key", "x-goog-user-project": "quota"}
                self.assertEqual(record, {"headers": expected})
                await stream.send(b"hello")
                self.assertEqual(await stream.receive(), b"hello")
                # Exceeds both connection and stream windows in both directions.
                large = bytes(range(256)) * 513
                await stream.send(large)
                self.assertEqual(await stream.receive(), large)
                await stream.send(b"")
                self.assertEqual(await stream.receive(), b"")
                await stream.end()
                with self.assertRaises(StopAsyncIteration):
                    await stream.receive()
                with self.assertRaises(StopAsyncIteration):
                    await stream.receive()

    async def test_blocked_write_does_not_block_receive_and_close_releases_writer(self) -> None:
        async with node_server("blocked") as (url, events):
            async with connect_grpc(url, headers={}) as stream:
                await events.readline()
                self.assertEqual(await stream.receive(), b"early")
                sending = asyncio.create_task(stream.send(b"pending"))
                await asyncio.sleep(0.01)
                self.assertFalse(sending.done())
                await stream.aclose()
                with self.assertRaises(GrpcProtocolError) as caught:
                    await sending
                self.assertEqual(str(caught.exception), "gRPC stream is closed")
                self.assertEqual(await events.readline(), b'"closed"\n')

    async def test_raw_peer_split_headers_padding_ping_settings_and_trailers(self) -> None:
        observed: list[tuple[int, int, int, bytes]] = []
        async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            settings = await read_frame(reader)
            self.assertEqual(settings, (4, 0, 0, struct.pack("!HIHI", 2, 0, 6, 65536)))
            request = await read_frame(reader)
            fields = HpackDecoder(4096, 65536).decode(request[3])
            self.assertEqual(dict(fields)[b"authorization"], b"Bearer test")
            header = encode_headers([(b":status", b"200"), (b"content-type", b"application/grpc")])
            wire = frame(4, 0, 0) + frame(1, 8, 1, b"\x02" + header[:4] + b"xx") + frame(9, 4, 1, header[4:])
            wire += frame(6, 0, 0, b"pingtest") + frame(0, 8, 1, b"\x01\x00\x00\x00\x00\x03abcx")
            wire += frame(1, 5, 1, encode_headers([(b"grpc-status", b"0")]))
            for byte in wire:
                writer.write(bytes([byte]))
                await writer.drain()
                await asyncio.sleep(0)
            while len(observed) < 2:
                observed.append(await read_frame(reader))
        async with raw_server(handler) as url:
            async with connect_grpc(url, headers={"authorization": "Bearer test"}) as stream:
                self.assertEqual(await stream.receive(), b"abc")
                with self.assertRaises(StopAsyncIteration):
                    await stream.receive()
        self.assertEqual(observed[:2], [(4, 1, 0, b""), (6, 1, 0, b"pingtest")])

    async def test_exact_protocol_errors(self) -> None:
        good = frame(4, 0, 0) + frame(1, 4, 1, encode_headers([(b":status", b"200"), (b"content-type", b"application/grpc")]))
        cases = [
            (frame(6, 0, 0, b"pingtest"), "HTTP/2 server preface must be SETTINGS"),
            (good + frame(8, 0, 1, b"\x00\x00\x00\x00"), "Invalid HTTP/2 flow-control window"),
            (good + frame(0, 0, 1, b"\x01\x00\x00\x00\x00"), "Compressed gRPC messages are not supported"),
            (good + frame(0, 0, 1, b"\x00\xff\xff\xff\xff"), "gRPC message exceeds byte limit"),
            (good + frame(0, 1, 1), "gRPC response lacks a valid final status"),
            (good + frame(3, 0, 1, b"\x00\x00\x00\x08"), "HTTP/2 stream reset (8)"),
            (good + frame(7, 0, 0, bytes(8)), "HTTP/2 connection closed (0)"),
            (frame(4, 0, 0) + frame(1, 0, 1) + frame(6, 0, 0, b"pingtest"), "Interrupted HTTP/2 header block"),
            (good + frame(1, 5, 1, encode_headers([(b"grpc-status", b"17")])), "gRPC response lacks a valid final status"),
            (good + frame(0, 0, 1, b"\x00\x00") + frame(1, 5, 1, encode_headers([(b"grpc-status", b"0")])), "Truncated gRPC message"),
            (frame(4, 0, 0) + frame(1, 4, 1, encode_headers([(b":status", b"200"), (b"content-type", b"application/grpc ")])), "Invalid HTTP/2 response header"),
            (good + frame(1, 5, 1, encode_headers([(b"grpc-status", b"0"), (b"grpc-status", b"0")])), "Duplicate gRPC response header"),
            (good + frame(9, 4, 1), "Invalid HTTP/2 header stream"),
            (good + frame(6, 0, 0, b"short"), "Invalid HTTP/2 PING frame"),
            (good + frame(4, 0, 0, struct.pack("!HI", 4, 0x80000000)), "Invalid HTTP/2 initial window"),
            (good + frame(4, 0, 0, struct.pack("!HI", 5, 1)), "Invalid HTTP/2 maximum frame size"),
            (good + frame(5, 0, 1), "HTTP/2 server push is disabled"),
            (good + frame(0, 8, 1, b"\x01"), "Invalid HTTP/2 data padding"),
            (good + frame(1, 5, 1, encode_headers([(b"grpc-status", b"0"), (b"content-length", b"0")])), "HTTP/2 content length is forbidden in trailers"),
            (frame(4, 0, 0) + frame(1, 5, 1, encode_headers([(b":status", b"200"), (b"content-type", b"application/grpc"), (b"content-length", b"5"), (b"grpc-status", b"0")])), "HTTP/2 content length mismatch"),
        ]
        for wire, message in cases:
            peer_closed = asyncio.Event()
            async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
                writer.write(wire)
                await writer.drain()
                await reader.read()
                peer_closed.set()
            with self.subTest(message=message):
                async with raw_server(handler) as url:
                    async with connect_grpc(url, headers={}) as stream:
                        with self.assertRaises(GrpcProtocolError) as caught:
                            await stream.receive()
                        self.assertEqual(str(caught.exception), message)
                    await peer_closed.wait()

    async def test_receive_window_bounds_unread_data(self) -> None:
        closed = asyncio.Event()
        async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            writer.write(frame(4, 0, 0) + frame(1, 4, 1, encode_headers([(b":status", b"200"), (b"content-type", b"application/grpc")])))
            message = b"\x00" + (100000).to_bytes(4, "big") + b"x" * 81915
            for offset in range(0, len(message), 16384):
                writer.write(frame(0, 0, 1, message[offset:offset + 16384]))
            await writer.drain()
            await reader.read()
            closed.set()
        async with raw_server(handler) as url:
            async with connect_grpc(url, headers={}) as stream:
                # The reader must enforce credit even if the application is idle.
                await closed.wait()
                with self.assertRaises(GrpcProtocolError) as caught:
                    await stream.receive()
                self.assertEqual(str(caught.exception), "HTTP/2 peer exceeded receive window")

    async def test_negative_stream_window_waits_for_positive_credit(self) -> None:
        ready, shrunk, restore_zero, restored_zero, restore_positive = (asyncio.Event() for _ in range(5))
        async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await read_frame(reader)
            await read_frame(reader)
            writer.write(frame(4, 0, 0, struct.pack("!HI", 4, 10)) + frame(1, 4, 1, encode_headers([(b":status", b"200"), (b"content-type", b"application/grpc")])))
            await writer.drain()
            self.assertEqual(await read_frame(reader), (4, 1, 0, b""))
            ready.set()
            self.assertEqual(await read_frame(reader), (0, 0, 1, b"\x00\x00\x00\x00\x01a"))
            writer.write(frame(4, 0, 0, struct.pack("!HI", 4, 0)))
            await writer.drain()
            self.assertEqual(await read_frame(reader), (4, 1, 0, b""))
            shrunk.set()
            await restore_zero.wait()
            writer.write(frame(8, 0, 1, (6).to_bytes(4, "big")) + frame(6, 0, 0, b"barrier!"))
            await writer.drain()
            self.assertEqual(await read_frame(reader), (6, 1, 0, b"barrier!"))
            restored_zero.set()
            await restore_positive.wait()
            writer.write(frame(8, 0, 1, (6).to_bytes(4, "big")))
            await writer.drain()
            self.assertEqual(await read_frame(reader), (0, 0, 1, b"\x00\x00\x00\x00\x01b"))
            writer.write(frame(1, 5, 1, encode_headers([(b"grpc-status", b"0")])))
            await writer.drain()
            await reader.read()
        async with raw_server(handler) as url:
            async with connect_grpc(url, headers={}) as stream:
                await ready.wait()
                await stream.send(b"a")
                await shrunk.wait()
                sending = asyncio.create_task(stream.send(b"b"))
                restore_zero.set()
                await restored_zero.wait()
                self.assertFalse(sending.done())
                restore_positive.set()
                await sending
                with self.assertRaises(StopAsyncIteration):
                    await stream.receive()

    async def test_outbound_continuation_and_validation_before_network(self) -> None:
        async with node_server("echo") as (url, events):
            async with connect_grpc(url, headers={"x-long": "a" * 20000}) as stream:
                record = cast(dict[str, dict[str, str]], json.loads(await events.readline()))
                self.assertEqual(record["headers"]["x-long"], "a" * 20000)
                await stream.end()
                with self.assertRaises(StopAsyncIteration):
                    await stream.receive()
        for headers in ({"connection": "keep-alive"}, {"authorization": " bad"}, {"Authorization": "one", "authorization": "two"}, {":path": "/other"}):
            with self.assertRaises(ValueError) as caught:
                async with connect_grpc("http://127.0.0.1:1/", headers=headers):
                    self.fail("accepted invalid header")
            self.assertEqual(str(caught.exception), "Invalid gRPC request header")

    async def test_cancellation_during_tls_handshake_closes_tcp(self) -> None:
        entered, closed = asyncio.Event(), asyncio.Event()
        tasks: list[asyncio.Task[None]] = []
        async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            try:
                await reader.read(4096)
                entered.set()
                await reader.read()
                closed.set()
            finally:
                writer.transport.abort()
        def connected(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            tasks.append(asyncio.create_task(handler(reader, writer)))
        listener = await asyncio.start_server(connected, "127.0.0.1", 0)
        async def opening() -> None:
            async with connect_grpc(f"https://127.0.0.1:{listener.sockets[0].getsockname()[1]}/", headers={}):
                self.fail("completed a stalled TLS handshake")
        task = asyncio.create_task(opening())
        try:
            async with asyncio.timeout(5):
                await entered.wait()
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                await closed.wait()
        finally:
            listener.close()
            await listener.wait_closed()
            task.cancel()
            for pending in tasks:
                pending.cancel()
            await asyncio.gather(task, *tasks, return_exceptions=True)

    async def test_trailers_only_status_and_canceled_pending_headers(self) -> None:
        async def rejected(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            writer.write(frame(4, 0, 0) + frame(1, 5, 1, encode_headers([(b":status", b"200"), (b"content-type", b"application/grpc"), (b"grpc-status", b"7"), (b"grpc-message", b"not%20allowed%20%E6%97%A5")])) )
            await writer.drain()
            await reader.read()
        async with raw_server(rejected) as url:
            async with connect_grpc(url, headers={}) as stream:
                with self.assertRaises(GrpcError) as caught:
                    await stream.receive()
                self.assertEqual((caught.exception.status_code, str(caught.exception)), (7, "not allowed 日"))
                with self.assertRaises(GrpcError):
                    await stream.receive()
        peer_closed = asyncio.Event()
        async def stalled(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await reader.read()
            peer_closed.set()
        async with raw_server(stalled) as url:
            async with connect_grpc(url, headers={}) as stream:
                reading = asyncio.create_task(stream.receive())
                await asyncio.sleep(0)
                reading.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await reading
                await peer_closed.wait()

    async def test_tls_verification_alpn_and_explicit_trust_override(self) -> None:
        with tempfile.TemporaryDirectory(prefix="speechswitch-grpc-tls-") as directory:
            cert, key = str(Path(directory) / "cert.pem"), str(Path(directory) / "key.pem")
            create = await asyncio.create_subprocess_exec("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1", stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            self.assertEqual(await create.wait(), 0)
            async with node_server("echo", cert, key) as (url, _):
                with self.assertRaises(ssl.SSLCertVerificationError):
                    async with connect_grpc(url, headers={}):
                        self.fail("accepted untrusted certificate")
                context = ssl.create_default_context(cafile=cert)
                async with connect_grpc(url, headers={}, ssl_context=context) as stream:
                    await stream.send(b"TLS")
                    self.assertEqual(await stream.receive(), b"TLS")
                    await stream.end()
                    with self.assertRaises(StopAsyncIteration):
                        await stream.receive()
            async with node_server("no-alpn", cert, key) as (url, _):
                with self.assertRaises(GrpcProtocolError) as caught:
                    async with connect_grpc(url, headers={}, ssl_context=context):
                        self.fail("accepted missing ALPN")
                self.assertEqual(str(caught.exception), "TLS peer did not negotiate HTTP/2")

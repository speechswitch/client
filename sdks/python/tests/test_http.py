import asyncio
import unittest
from collections.abc import AsyncIterator

from speechswitch.http import HttpRequest, HttpResponse, HttpStatusError, open_audio


class Body:
    def __init__(self, chunks: list[bytes | Exception]) -> None:
        self.chunks = iter(chunks)
        self.reads: int = 0
        self.closes: int = 0
        self.close_error: Exception | None = None

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self

    async def __anext__(self) -> bytes:
        self.reads += 1
        value = next(self.chunks, None)
        if value is None:
            raise StopAsyncIteration
        if isinstance(value, Exception):
            raise value
        return value

    async def aclose(self) -> None:
        self.closes += 1
        await asyncio.sleep(0)
        if self.close_error is not None:
            raise self.close_error


class Transport:
    def __init__(self, body: Body, status: int = 200) -> None:
        self.body = body
        self.status = status
        self.requests: list[HttpRequest] = []

    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        return HttpResponse(self.status, {}, self.body)


REQUEST = HttpRequest("POST", "https://example.invalid/tts", {"Authorization": "test credential"}, bytes([0, 255]))


class StreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_audio_is_pulled_and_eof_releases_body_once(self) -> None:
        body = Body([bytes([0, 255]), bytes([1, 2])])
        transport = Transport(body)
        async with open_audio(transport, REQUEST) as audio:
            self.assertEqual(transport.requests, [REQUEST])
            self.assertEqual(body.reads, 0)
            self.assertEqual(await anext(audio), bytes([0, 255]))
            self.assertEqual(body.reads, 1)
            self.assertEqual(body.closes, 0)
            self.assertEqual(await anext(audio), bytes([1, 2]))
            with self.assertRaises(StopAsyncIteration):
                await anext(audio)
            self.assertEqual(body.closes, 1)
            with self.assertRaises(StopAsyncIteration):
                await anext(audio)
            self.assertEqual(body.reads, 3)
        self.assertEqual(body.closes, 1)

    async def test_early_break_and_unread_response(self) -> None:
        for read_first in [False, True]:
            body = Body([b"first", b"unread"])
            async with open_audio(Transport(body), REQUEST) as audio:
                if read_first:
                    async for chunk in audio:
                        self.assertEqual(chunk, b"first")
                        break
            self.assertEqual(body.reads, int(read_first))
            self.assertEqual(body.closes, 1)
            with self.assertRaises(StopAsyncIteration):
                await anext(audio)

    async def test_non_success_status_never_reads_private_error_body(self) -> None:
        for status in [199, 300, 401, 429, 500]:
            body = Body([b"private error body"])
            with self.assertRaises(HttpStatusError) as caught:
                async with open_audio(Transport(body, status), REQUEST):
                    self.fail("An HTTP error must not yield a stream")
            self.assertEqual(caught.exception.status, status)
            self.assertEqual(str(caught.exception), f"HTTP request failed with status {status}")
            self.assertEqual((body.reads, body.closes), (0, 1))

    async def test_read_error_preserved_even_if_close_fails(self) -> None:
        failure = ConnectionResetError("broken stream")
        body = Body([b"", bytes([255]), failure, b"unread"])
        body.close_error = OSError("close failed")
        async with open_audio(Transport(body), REQUEST) as audio:
            self.assertEqual(await anext(audio), bytes([255]))
            with self.assertRaises(ConnectionResetError) as caught:
                await anext(audio)
            self.assertIs(caught.exception, failure)
            self.assertEqual((body.reads, body.closes), (3, 1))
            with self.assertRaises(StopAsyncIteration):
                await anext(audio)

    async def test_close_error_is_observable_without_an_existing_failure(self) -> None:
        body = Body([])
        failure = OSError("close failed")
        body.close_error = failure
        with self.assertRaises(OSError) as caught:
            async with open_audio(Transport(body), REQUEST):
                pass
        self.assertIs(caught.exception, failure)
        self.assertEqual(body.closes, 1)

    async def test_cancellation_during_read_closes_body(self) -> None:
        started = asyncio.Event()

        class PendingBody(Body):
            async def __anext__(self) -> bytes:
                self.reads += 1
                started.set()
                await asyncio.Future[None]()
                raise AssertionError("unreachable")

        body = PendingBody([])

        async def consume() -> None:
            async with open_audio(Transport(body), REQUEST) as audio:
                await anext(audio)

        task = asyncio.create_task(consume())
        await asyncio.wait_for(started.wait(), 1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual((body.reads, body.closes), (1, 1))

    async def test_cancellation_before_headers_reaches_transport(self) -> None:
        started = asyncio.Event()
        released = asyncio.Event()

        class PendingTransport:
            async def send(self, request: HttpRequest) -> HttpResponse:
                started.set()
                try:
                    await asyncio.Future[None]()
                    raise AssertionError("unreachable")
                finally:
                    released.set()

        async def consume() -> None:
            async with open_audio(PendingTransport(), REQUEST):
                self.fail("No response yet")

        task = asyncio.create_task(consume())
        await asyncio.wait_for(started.wait(), 1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(released.is_set())

    async def test_send_failure_is_preserved(self) -> None:
        failure = ConnectionRefusedError("connection failed")

        class FailedTransport:
            async def send(self, request: HttpRequest) -> HttpResponse:
                raise failure

        with self.assertRaises(ConnectionRefusedError) as caught:
            async with open_audio(FailedTransport(), REQUEST):
                self.fail("A failed send must not yield a stream")
        self.assertIs(caught.exception, failure)


if __name__ == "__main__":
    unittest.main()

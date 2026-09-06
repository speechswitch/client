"""Transport contracts and byte-native streaming for handwritten providers."""

import asyncio
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class HttpRequest:
    method: str
    url: str
    headers: Mapping[str, str]
    body: bytes


class HttpBody(Protocol):
    def __aiter__(self) -> AsyncIterator[bytes]: ...

    async def __anext__(self) -> bytes: ...

    async def aclose(self) -> None:
        """Release the response, including after a canceled or failed read."""
        ...


@dataclass(frozen=True, slots=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: HttpBody


class HttpTransport(Protocol):
    async def send(self, request: HttpRequest) -> HttpResponse:
        """Return at headers, without buffering audio or blocking the event loop.

        Cancellation before return must release the request and any response.
        Never forward credentials across origins when following redirects.
        """
        ...


class HttpStatusError(Exception):
    def __init__(self, status: int) -> None:
        self.status = status
        super().__init__(f"HTTP request failed with status {status}")


class AudioStream:
    """Single-reader byte stream. Use open_audio's context for deterministic cleanup."""

    def __init__(self, body: HttpBody) -> None:
        self._body: HttpBody | None = body

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self

    async def __anext__(self) -> bytes:
        try:
            while self._body is not None:
                chunk = await self._body.__anext__()
                if chunk:
                    return chunk
                await asyncio.sleep(0)
        except StopAsyncIteration:
            await self.aclose()
            raise
        except BaseException:
            # Preserve the read error (especially CancelledError), even if
            # the transport also reports an error while releasing its body.
            try:
                await self.aclose()
            except Exception:
                pass
            raise
        raise StopAsyncIteration

    async def aclose(self) -> None:
        # No concurrent reads/closes: cancellation is delivered to the reading
        # task, which releases the body before propagating CancelledError.
        body, self._body = self._body, None
        if body is not None:
            await body.aclose()


@asynccontextmanager
async def open_audio(transport: HttpTransport, request: HttpRequest) -> AsyncIterator[AudioStream]:
    """Open byte-native audio; codecs for framed responses belong to providers.

    Always use ``async with``. Breaking an async for loop alone does not close
    its iterator. Non-2xx bodies are closed without reading or exposing them.
    """
    response = await transport.send(request)
    stream = AudioStream(response.body)
    try:
        if not 200 <= response.status < 300:
            raise HttpStatusError(response.status)
        yield stream
    except BaseException:
        try:
            await stream.aclose()
        except Exception:
            pass
        raise
    finally:
        await stream.aclose()

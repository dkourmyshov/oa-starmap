"""Cached catalogue downloads and mirror failover."""

from __future__ import annotations

from contextlib import contextmanager

import httpx
import pytest

from oastarmap.fetch.base import CatalogSource, fetch_source


def source() -> CatalogSource:
    return CatalogSource(
        key="test",
        url="https://primary.invalid/catalogue",
        fallback_urls=("https://mirror.invalid/catalogue",),
        filename="catalogue.tsv",
        description="Test catalogue",
        citation="Test",
    )


def responses(monkeypatch, statuses: dict[str, tuple[int, bytes]]):
    calls = []

    @contextmanager
    def stream(method: str, url: str, **kwargs):
        del method, kwargs
        calls.append(url)
        status, content = statuses[url]
        request = httpx.Request("GET", url)
        response = httpx.Response(status, content=content, request=request)
        try:
            yield response
        finally:
            response.close()

    monkeypatch.setattr(httpx, "stream", stream)
    return calls


def test_falls_back_to_a_mirror(monkeypatch, tmp_path, capsys):
    dest = tmp_path / "catalogue.tsv"
    monkeypatch.setattr(CatalogSource, "path", property(lambda self: dest))
    calls = responses(monkeypatch, {
        "https://primary.invalid/catalogue": (404, b"missing"),
        "https://mirror.invalid/catalogue": (200, b"catalogue data"),
    })

    assert fetch_source(source(), force=True) == dest
    assert dest.read_bytes() == b"catalogue data"
    assert calls == [
        "https://primary.invalid/catalogue",
        "https://mirror.invalid/catalogue",
    ]
    assert "using mirror https://mirror.invalid/catalogue" in capsys.readouterr().err


def test_reports_all_urls_when_every_request_fails(monkeypatch, tmp_path):
    dest = tmp_path / "catalogue.tsv"
    monkeypatch.setattr(CatalogSource, "path", property(lambda self: dest))
    responses(monkeypatch, {
        "https://primary.invalid/catalogue": (404, b"missing"),
        "https://mirror.invalid/catalogue": (503, b"unavailable"),
    })

    with pytest.raises(RuntimeError, match="all download URLs failed") as error:
        fetch_source(source(), force=True)
    assert "https://primary.invalid/catalogue" in str(error.value)
    assert "https://mirror.invalid/catalogue" in str(error.value)
    assert not dest.exists()
    assert not dest.with_suffix(".tsv.part").exists()

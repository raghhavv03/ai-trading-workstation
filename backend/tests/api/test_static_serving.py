import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app, serve_frontend


@pytest.fixture
def static_root(tmp_path, monkeypatch):
    root = tmp_path / "static"
    (root / "_next").mkdir(parents=True)
    (root / "index.html").write_text("<html>FinAlly</html>")
    (root / "_next" / "app.js").write_text("console.log('hi')")
    monkeypatch.setenv("STATIC_DIR", str(root))
    return root


@pytest.mark.asyncio
async def test_serves_index_html_at_root(static_root):
    response = await serve_frontend("")
    assert response.path == static_root / "index.html"


@pytest.mark.asyncio
async def test_serves_an_existing_asset(static_root):
    response = await serve_frontend("_next/app.js")
    assert response.path == (static_root / "_next" / "app.js").resolve()


@pytest.mark.asyncio
async def test_unknown_path_falls_back_to_index_html(static_root):
    response = await serve_frontend("some/client/route")
    assert response.path == static_root / "index.html"


@pytest.mark.asyncio
async def test_path_traversal_falls_back_to_index_instead_of_escaping(static_root):
    response = await serve_frontend("../../etc/passwd")
    assert response.path == static_root / "index.html"


@pytest.mark.asyncio
async def test_missing_static_dir_404s_instead_of_crashing(monkeypatch, tmp_path):
    monkeypatch.setenv("STATIC_DIR", str(tmp_path / "never-built"))
    with pytest.raises(HTTPException) as exc_info:
        await serve_frontend("")
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_api_paths_are_never_swallowed_by_the_catch_all(static_root):
    with pytest.raises(HTTPException) as exc_info:
        await serve_frontend("api/does-not-exist")
    assert exc_info.value.status_code == 404


def test_real_api_routes_still_win_over_the_catch_all(static_root):
    with TestClient(app) as client:
        assert client.get("/api/portfolio").status_code == 200
        assert client.get("/api/watchlist").status_code == 200
        # An unmatched API path must 404, not silently return the SPA shell.
        unknown = client.get("/api/nope")
        assert unknown.status_code == 404
        assert "FinAlly</html>" not in unknown.text

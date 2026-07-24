import pytest


@pytest.fixture(autouse=True)
def _isolated_db_path(tmp_path, monkeypatch):
    """Any test that boots the real app (TestClient(app)) gets a throwaway
    SQLite file instead of writing into the repo's data/ directory."""
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))

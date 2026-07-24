from app.market_data.tracked_tickers import TrackedTickerRegistry


def test_load_initial_sets_union():
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist={"AAPL"}, positions={"TSLA"})
    assert registry.get() == {"AAPL", "TSLA"}


def test_load_initial_overwrites_prior_state():
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist={"AAPL"}, positions=set())
    registry.load_initial(watchlist={"MSFT"}, positions=set())
    assert registry.get() == {"MSFT"}


def test_add_watchlist_ticker():
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist=set(), positions=set())
    registry.add_watchlist_ticker("PYPL")
    assert registry.get() == {"PYPL"}


def test_remove_watchlist_ticker_with_no_position_drops_it():
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist={"AAPL"}, positions=set())
    registry.remove_watchlist_ticker("AAPL")
    assert registry.get() == set()


def test_removing_from_watchlist_keeps_open_position():
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist={"AAPL"}, positions=set())
    registry.set_position_ticker("AAPL", quantity=5.0)
    registry.remove_watchlist_ticker("AAPL")
    assert registry.get() == {"AAPL"}  # still tracked via the open position


def test_full_sellout_stops_tracking_ticker_not_on_watchlist():
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist=set(), positions={"TSLA"})
    registry.set_position_ticker("TSLA", quantity=0.0)
    assert registry.get() == set()


def test_fresh_buy_starts_tracking_ticker_not_on_watchlist():
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist=set(), positions=set())
    registry.set_position_ticker("NVDA", quantity=3.0)
    assert registry.get() == {"NVDA"}


def test_sellout_of_ticker_still_on_watchlist_keeps_it_tracked():
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist={"AAPL"}, positions={"AAPL"})
    registry.set_position_ticker("AAPL", quantity=0.0)
    assert registry.get() == {"AAPL"}  # watchlist half still holds it


def test_get_returns_a_copy_not_a_live_view():
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist={"AAPL"}, positions=set())
    snapshot = registry.get()
    registry.add_watchlist_ticker("MSFT")
    assert snapshot == {"AAPL"}

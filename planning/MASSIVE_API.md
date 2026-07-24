# Massive API Reference (formerly Polygon.io)

Research notes on the Massive.com Stocks REST API, for use by the Backend/Market Data agent implementing `MASSIVE_CLIENT.md`. Massive is the October 2025 rebrand of Polygon.io — same accounts, same API keys, same data, new base URL and package name.

## 1. Setup

**Package:** `pip install massive` (Python ≥ 3.9). The legacy `polygon-api-client` package still works against `api.polygon.io`, but new code should use `massive`, which defaults to `api.massive.com`.

**Authentication:** API key passed to the client constructor, or read automatically from the `MASSIVE_API_KEY` environment variable — which is exactly the variable name this project already uses (see `PLAN.md` §5). No header/query-param wiring needed.

```python
from massive import RESTClient

client = RESTClient()  # reads MASSIVE_API_KEY from env
# or: client = RESTClient(api_key="...")
```

Raw REST calls (no SDK) authenticate via `apiKey` query param or `Authorization: Bearer <key>` header:

```bash
curl "https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers?tickers=AAPL,TSLA&apiKey=$MASSIVE_API_KEY"
```

## 2. Plan tiers & rate limits

| Plan | Price | Rate limit | Data recency |
|---|---|---|---|
| Basic | Free | 5 calls/minute | End of day only |
| Starter | $29/mo | Unlimited | 15-minute delayed |
| Developer | $79/mo | Unlimited | 15-minute delayed |
| Advanced | $199/mo | Unlimited | Real-time |
| Business | Custom | Unlimited | Real-time |

This drives the polling intervals in `PLAN.md` §6: Basic tier polls every 15s (to stay under 5 calls/min with margin), paid tiers can poll every 2-15s.

## 3. Endpoint: Snapshot — multiple tickers (real-time / delayed quote)

The one that matters most for this project — one call returns current price data for an arbitrary list of tickers, which is how the poller prices the entire watchlist in a single request regardless of watchlist size.

**`GET /v2/snapshot/locale/us/markets/stocks/tickers`**

| Param | Type | Notes |
|---|---|---|
| `tickers` | string | comma-separated, case-sensitive, e.g. `AAPL,TSLA,GOOG` |
| `include_otc` | bool | default `false` |

```bash
curl "https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers?tickers=AAPL,TSLA,GOOG&apiKey=$MASSIVE_API_KEY"
```

```python
snapshot = client.get_snapshot_all("stocks", ["AAPL", "TSLA", "GOOG"])
```

Response (per ticker):

```json
{
  "tickers": [
    {
      "ticker": "AAPL",
      "day": {"o": 119.62, "h": 120.53, "l": 118.81, "c": 120.42, "v": 28727868, "vw": 119.725},
      "prevDay": {"o": 117.19, "h": 119.63, "l": 116.44, "c": 119.49, "v": 110597265, "vw": 118.4998},
      "lastTrade": {"p": 120.47, "s": 236, "t": 1605195918306274000},
      "lastQuote": {"p": 120.46, "P": 120.47, "s": 8, "S": 4, "t": 1605195918507251700},
      "todaysChange": 0.98,
      "todaysChangePerc": 0.82,
      "updated": 1605195918306274000
    }
  ]
}
```

**Field glossary** (Massive/Polygon uses terse single-letter keys everywhere): `o`/`h`/`l`/`c` = open/high/low/close, `v` = volume, `vw` = volume-weighted average price, `t` = Unix timestamp in **nanoseconds**, `p`/`s` = last-trade price/size, `p`/`P`/`s`/`S` on quotes = bid price/ask price/bid size/ask size. `todaysChange` / `todaysChangePerc` are already computed for you — no need to diff `day.c` against `prevDay.c` yourself.

A ticker that doesn't exist is simply omitted from `tickers[]` — no per-ticker error object on this endpoint (contrast with the `/v3/snapshot` unified endpoint below, which does return per-ticker errors).

## 4. Endpoint: Single ticker snapshot

**`GET /v2/snapshot/locale/us/markets/stocks/tickers/{stocksTicker}`** — same shape as above, `results.ticker` singular instead of an array. Useful for on-demand lookups (e.g. validating a ticker the user just typed into the watchlist) but not for the poll loop — the batch endpoint above already covers N tickers in one call, so looping this per-ticker would be strictly worse.

## 5. Endpoint: Previous close (single ticker EOD)

**`GET /v2/aggs/ticker/{stocksTicker}/prev`**

```python
agg = client.get_previous_close_agg("AAPL")
```

```json
{
  "ticker": "AAPL",
  "results": [{"T": "AAPL", "o": 115.55, "h": 117.59, "l": 114.13, "c": 115.97, "v": 131704427, "vw": 116.3058, "t": 1605042000000}],
  "resultsCount": 1
}
```

Single-ticker only — for EOD prices across the whole watchlist, prefer the grouped endpoint below (one call vs. N calls).

## 6. Endpoint: Grouped daily bars (all tickers, one date, EOD)

**`GET /v2/aggs/grouped/locale/us/market/stocks/{date}`**

Returns OHLC for **every** US stock on a given trading date in a single response. This is the batch EOD equivalent of the snapshot endpoint in §3 — fetch once, then filter client-side down to the watchlist.

| Param | Type | Notes |
|---|---|---|
| `date` | string | `YYYY-MM-DD` |
| `adjusted` | bool | split-adjusted, default `true` |
| `include_otc` | bool | default `false` |

```python
grouped = client.get_grouped_daily_aggs("2023-02-16")
```

```json
{
  "results": [
    {"T": "AAPL", "o": 26.07, "h": 26.25, "l": 25.91, "c": 25.9102, "v": 4369, "vw": 26.0407, "n": 74, "t": 1602705600000}
  ],
  "resultsCount": 3
}
```

`n` = number of trades. `t` here is **milliseconds** (contrast with nanoseconds on the snapshot/trade endpoints — timestamp precision is not consistent across Massive endpoints, so client code must not assume a fixed unit).

## 7. Endpoint: Last trade (single ticker, tick-level)

**`GET /v2/last/trade/{stocksTicker}`** — `client.get_last_trade(ticker)`. Not needed for the polling design in `PLAN.md` (the snapshot endpoint already includes `lastTrade`), documented here for completeness since it's the natural "give me the current price" endpoint newcomers reach for first.

## 8. Endpoint: Daily open/close for one ticker/date

**`GET /v1/open-close/{stocksTicker}/{date}`** — includes `preMarket`/`afterHours` fields the aggs endpoints don't have. Single-ticker only.

## 9. Newer unified snapshot (`/v3/snapshot`) — not used by this project

Massive's newer cross-asset-class snapshot endpoint, `GET /v3/snapshot?ticker.any_of=AAPL,TSLA,...` (up to 250 tickers), returns per-ticker error objects for bad symbols instead of silently omitting them:

```json
{"ticker": "TSLAAPL", "error": "NOT_FOUND", "message": "Ticker not found."}
```

Noted here because its error-handling shape is nicer, but the project sticks with the `/v2/snapshot/.../tickers` endpoint (§3) since it's the one demonstrated in the official SDK's `get_snapshot_all` example and is sufficient for stocks-only use.

## 10. Error handling notes

- Bad/unknown ticker on `/v2/snapshot/.../tickers`: silently dropped from the results array — client code must diff the requested ticker list against the returned list to detect misses.
- Rate limit exceeded (Basic tier): HTTP 429.
- Auth failure: HTTP 401.
- The SDK does not raise on a partial-miss (some tickers found, some not) — it only raises on transport/HTTP errors.

Sources:
- [Overview | Stocks REST API - Massive](https://massive.com/docs/rest/stocks/overview)
- [Full Market Snapshot | Stocks REST API - Massive](https://massive.com/docs/rest/stocks/snapshots/full-market-snapshot)
- [Single Ticker Snapshot | Stocks REST API - Massive](https://massive.com/docs/rest/stocks/snapshots/single-ticker-snapshot)
- [Unified Snapshot | Stocks REST API - Massive](https://massive.com/docs/rest/stocks/snapshots/unified-snapshot)
- [Daily Market Summary (grouped daily) | Stocks REST API - Massive](https://massive.com/docs/rest/stocks/aggregates/daily-market-summary)
- [Previous Day Bar | Stocks REST API - Massive](https://massive.com/docs/rest/stocks/aggregates/previous-day-bar)
- [Daily Ticker Summary | Stocks REST API - Massive](https://massive.com/docs/rest/stocks/aggregates/daily-ticker-summary)
- [Last Trade | Stocks REST API - Massive](https://massive.com/docs/rest/stocks/trades-quotes/last-trade)
- [GitHub - massive-com/client-python](https://github.com/massive-com/client-python)
- [massive · PyPI](https://pypi.org/project/massive/)
- [Massive pricing](https://massive.com/pricing)

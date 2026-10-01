# Approach

This note explains how I approached the Hotel Offer Orchestrator assignment: how I read the problem, the design decisions and why I made them, how failures are handled, how the work was verified, and the trade-offs I accepted. Setup and usage instructions are in the [README](README.md).

---

## 1. Understanding the problem

The core task is a small aggregation pipeline:

1. Fetch hotel offers for a city from two suppliers **in parallel**.
2. **De-duplicate** hotels that both suppliers offer, keeping the **cheaper** one.
3. Keep hotels that only one supplier offers.
4. Return the result, **cache it in Redis**, and support **price-range filtering inside Redis**.
5. Orchestrate the comparison with **Temporal**, containerize with Docker, and provide a Postman collection.

The requirements leave some behaviour open. I made these decisions explicitly:

| Open question | Decision | Reason |
|---|---|---|
| How are "the same hotel" across suppliers matched? | By name, case- and whitespace-insensitive (`"The Leela"` = `"the leela "`) | The assignment says "dedupe by name"; suppliers rarely agree on exact casing |
| What if both suppliers have the **same price**? | Higher `commissionPct` wins; if still equal, Supplier A wins | Needs a deterministic answer. Higher commission is the better business outcome, and a fixed fallback makes the result independent of input order |
| What if one supplier is down? | Return the other supplier's offers (200), not an error | A partial list is more useful to a user than no list |
| What if both are down? | `502 All suppliers unavailable` | Nothing meaningful to return; 502 says an upstream failed |
| Unknown city? | `200 []` | An empty search result is not an error |
| When is Redis read vs. the workflow run? | Unfiltered requests always run the workflow (fresh data); filtered requests are served from Redis when the city is cached | Keeps the main listing fresh while making filtering cheap and done in Redis, as required |

## 2. Architecture

```
Client ──► API (Express) ──start workflow──► Temporal server ──task──► Worker
              │                                                        │
              │                                ┌───────────────────────┤
              │                                ▼                       ▼
              │                     Supplier A / B mocks          Redis (cache)
              │                     (HTTP, inside the API)              ▲
              └─────────────── price filter: ZRANGE BYSCORE ────────────┘
```

Four containers, each with one job:

- **api**: HTTP endpoints, input validation, starting workflows, reading filtered results from Redis. It also hosts the mock supplier endpoints.
- **worker**: runs the Temporal workflow and its activities. Kept separate from the API so the two can scale, restart and deploy independently, as Temporal recommends.
- **temporal**: the Temporal server and Web UI. It holds the task queue, enforces timeouts and retries, and records each workflow's event history.
- **redis**: the cache and the filtering engine.

The worker calls the mock suppliers **over HTTP** (`SUPPLIER_BASE_URL`), not by importing their data. The integration therefore behaves like a real one, with real network failures, status codes and timeouts.

## 3. Workflow design (Temporal)

```
hotelOffersWorkflow({ city })
  ├─ fetchSupplierA(city) ┐  activities, in parallel
  ├─ fetchSupplierB(city) ┘
  ├─ selectBestOffers(a, b)       pure function, runs inside the workflow
  └─ saveToRedis(city, offers)    activity
```

Key decisions:

- **All I/O lives in activities; the workflow only orchestrates.** Temporal replays workflow code from its event history to recover state, so workflow code must be deterministic. An ESLint rule blocks network, Redis, logger imports, `Math.random` and `Date.now` in workflow files, so this can't regress silently.
- **Partial failure is a first-class case.** Each supplier call is wrapped so its failure becomes a value instead of rejecting `Promise.all`. One failure gives a partial result and a warning log. Two failures throw a **non-retryable** `ApplicationFailure` of type `AllSuppliersUnavailable`, which the API maps to 502.
- **Retries are tuned to the error type.** Network errors, timeouts and 5xx are retried (3 attempts, 500 ms initial backoff, ×2). A 4xx or an invalid payload means our request or the data is wrong, so it is marked non-retryable and fails immediately.
- **Caching is best-effort.** If `saveToRedis` fails, the workflow logs a warning and still returns the offers. The cache activity has a lighter retry policy than the suppliers so a Redis outage doesn't slow every request.
- **Workflow IDs** (`hotel-offers-<city>-<uuid>`) are generated in the API, never inside the workflow, to keep the workflow deterministic.

## 4. Best-offer selection

`selectBestOffers` is a **pure function**: no I/O, no clock, no randomness. That lets it run safely inside the workflow and makes it trivial to unit-test.

1. Normalize each name (`trim().toLowerCase()`) as the dedupe key.
2. For each key keep the best offer: lower price, then higher commission, then Supplier A.
3. Return the winning supplier's spelling of the name.
4. Sort by price, then name, using plain code-point comparison so ordering is identical on every machine.

The Delhi mock data covers every rule on purpose: B cheaper, A cheaper, a price tie settled by commission (with different capitalisation across suppliers), a full tie, and hotels unique to each supplier.

## 5. Redis design and price filtering

Each city is stored in three keys. All key names come from a single helper so they are never hand-built in more than one place.

| Key | Type | Purpose |
|---|---|---|
| `hotels:{city}:byPrice` | Sorted set (score = price) | Range queries by price |
| `hotels:{city}:data` | Hash (field = hotel) | Full offer JSON |
| `hotels:{city}:meta` | String | `{ count, updatedAt, partial }`; marks the city as cached, even when it has zero hotels |

- **Writes are atomic.** One `MULTI`/`EXEC` transaction deletes the old keys, writes the new ones and sets TTLs. Readers never see a half-updated city, and hotels that disappeared don't linger.
- **Filtering happens in Redis, not in JavaScript.** `ZRANGE hotels:{city}:byPrice <min> <max> BYSCORE` returns the matching hotels already ordered by price (ties by name), then `HMGET` fetches their details. A missing bound becomes `-inf` / `+inf`, and bounds are inclusive.
- **Round trips are minimised.** The cache-existence check and the `ZRANGE` are pipelined into one round trip.
- **Empty results are cached too.** The meta key distinguishes "not cached" (run the workflow) from "cached, no hotels" (return `[]`).
- **Partial results expire sooner.** A list built while a supplier was down is cached for 30 s instead of 300 s, so it is replaced soon after the supplier recovers.

## 6. API and error handling

- Route handlers stay thin: validate → call service → respond.
- Input is validated with `zod`. It rejects missing or blank cities, repeated parameters, non-numeric or negative prices (`abc`, `-5`, `1e3`, `Infinity`), and `minPrice > maxPrice`, always as `400 { "error": "..." }`.
- One central error middleware maps failures to status codes and never leaks stack traces:

| Failure | Response |
|---|---|
| Validation | 400 |
| Body too large / malformed JSON | 413 / 400 |
| Both suppliers down | 502 |
| Temporal unreachable | 503 within ~5 s (gRPC deadline) |
| Redis unreachable on a filtered request | 503 within ~2 s (command timeout) |
| Workflow timed out (e.g. no worker running) | 504 |
| Anything else | 500 |

- **Fail fast.** Every external call has a time limit, so a dependency outage produces a quick, clear error instead of a hanging request.
- **Observability.** Structured `pino` logs carry `requestId`, `city`, `workflowId` and `supplier`. Supplier failures are logged as warnings (partial result) and total failure as an error. Every run is also visible in the Temporal Web UI.
- **Health check.** `/health` probes both suppliers, Redis and Temporal in parallel with a 2 s timeout each, and reports `ok` / `degraded` / `down`. A dev-only admin endpoint toggles a supplier down to demonstrate failure handling. It is disabled when `NODE_ENV=production`.

## 7. How it was verified

| Level | What |
|---|---|
| Unit | `selectBestOffers` (every rule, empty input, ordering, immutability); Redis filtering (inclusive bounds, only-min, only-max, no match, cached-empty, TTLs, partial TTL) |
| Workflow | Real workflow code on Temporal's time-skipping test server with mocked activities: both succeed, one fails (exactly 3 attempts), non-retryable failure (1 attempt), both fail, cache failure tolerated |
| API | `supertest` for validation, cache-hit vs. cache-miss flow, and every error mapping |
| Integration | Real supplier activities and health checker against the running mock API |
| End-to-end | Docker Compose stack plus the Postman collection (12 requests, 32 assertions), automated in CI on every push |
| Edge cases and failures | 51 edge-case requests against the live stack, plus stopping the worker, Temporal and Redis individually to confirm the system degrades as designed and recovers on its own |

The failure testing found real issues: a request hanging while Temporal was down, a 500 instead of 503 while Redis was down, slow cache retries, and a 500 for oversized bodies. Each was fixed and covered by a test.

## 8. Trade-offs and assumptions

- **Temporal runs as the official dev server, in memory.** It starts in seconds and needs no database setup, which suits a demo. Workflow history is lost on restart. That is acceptable here because suppliers are the source of truth and Redis is only a cache.
- **Name-based matching** is what the assignment asks for. Real suppliers would be matched on a shared hotel ID or a curated mapping, because names vary ("Taj Palace" vs "Taj Palace New Delhi").
- **Unfiltered requests always hit the suppliers**, which favours freshness over load. A busier system might serve those from cache as well.
- **The mock suppliers live inside the API container** to keep the setup to one command. They are still called over HTTP, so swapping in real supplier URLs is a configuration change.
- **The Docker image uses Debian slim, not Alpine,** because Temporal's native worker module only ships glibc builds.

## 9. What I would add for production

- Temporal on persistent storage (PostgreSQL/Cassandra) or Temporal Cloud, with TLS.
- Real supplier clients with authentication, rate limits and per-supplier timeouts.
- Hotel matching by supplier IDs or a mapping table instead of names.
- Redis with persistence or a managed service, and cache metrics (hit rate, partial-result rate).
- Metrics and tracing (Prometheus/OpenTelemetry) across API, workflow and activities.
- Remove the admin toggle in favour of real fault injection in staging.

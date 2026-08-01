const assert = require("node:assert/strict");
const { before, test } = require("node:test");

before(async () => {
  await import("../docs/repo-filter.js");
});

function result(name, url, overrides = {}) {
  return { name, url, status_code: 200, elapsed_sec: 1, state: "OK", error: null, ...overrides };
}

function record(checkedAt, results) {
  return { checkedAtDate: new Date(checkedAt), results };
}

test("filterSeriesByRepo passes the full list through for \"all\" or a falsy key", () => {
  const { filterSeriesByRepo } = globalThis.RepoFilter;
  const series = [{ key: "a" }, { key: "b" }];
  assert.deepEqual(filterSeriesByRepo(series, "all"), series);
  assert.deepEqual(filterSeriesByRepo(series, undefined), series);
  assert.deepEqual(filterSeriesByRepo(series, null), series);
});

test("filterSeriesByRepo narrows to the matching key, or an empty list if none match", () => {
  const { filterSeriesByRepo } = globalThis.RepoFilter;
  const series = [{ key: "a" }, { key: "b" }];
  assert.deepEqual(filterSeriesByRepo(series, "b"), [{ key: "b" }]);
  assert.deepEqual(filterSeriesByRepo(series, "missing"), []);
  assert.deepEqual(filterSeriesByRepo(null, "a"), []);
});

test("buildRepoHistoryRows returns nothing for \"all\" and for a falsy key", () => {
  const { buildRepoHistoryRows } = globalThis.RepoFilter;
  const records = [record("2026-08-01T00:00:00Z", [result("A", "https://a.example/")])];
  assert.deepEqual(buildRepoHistoryRows(records, "all"), []);
  assert.deepEqual(buildRepoHistoryRows(records, null), []);
});

test("buildRepoHistoryRows extracts the selected repo's rows, newest first", () => {
  const { buildRepoHistoryRows } = globalThis.RepoFilter;
  const records = [
    record("2026-08-01T00:00:00Z", [result("A", "https://a.example/", { elapsed_sec: 1.5, status_code: 200, state: "OK", error: null })]),
    record("2026-08-01T00:15:00Z", [result("A", "https://a.example/", { elapsed_sec: 2.5, status_code: 500, state: "SERVER_ERROR", error: "boom" })]),
  ];
  const rows = buildRepoHistoryRows(records, "https://a.example/");
  assert.deepEqual(rows, [
    { checkedAt: Date.parse("2026-08-01T00:15:00Z"), statusCode: 500, elapsedSec: 2.5, state: "SERVER_ERROR", error: "boom" },
    { checkedAt: Date.parse("2026-08-01T00:00:00Z"), statusCode: 200, elapsedSec: 1.5, state: "OK", error: null },
  ]);
});

test("buildRepoHistoryRows skips records where the selected repo has no result", () => {
  const { buildRepoHistoryRows } = globalThis.RepoFilter;
  const records = [
    record("2026-08-01T00:00:00Z", [result("A", "https://a.example/")]),
    record("2026-08-01T00:15:00Z", [result("B", "https://b.example/")]),
    { checkedAtDate: new Date("invalid"), results: [result("A", "https://a.example/")] },
  ];
  const rows = buildRepoHistoryRows(records, "https://a.example/");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].checkedAt, Date.parse("2026-08-01T00:00:00Z"));
});

test("resolveCanonicalSites uses latest.json.results order when it is a non-empty success", () => {
  const { resolveCanonicalSites } = globalThis.RepoFilter;
  const sites = resolveCanonicalSites({
    latestStatus: "success",
    latestResults: [result("A", "https://a.example/"), result("B", "https://b.example/")],
    historyRecords: [],
  });
  assert.deepEqual(sites, [
    { key: "https://a.example/", name: "A" },
    { key: "https://b.example/", name: "B" },
  ]);
});

test("resolveCanonicalSites returns null while latest.json is still pending", () => {
  const { resolveCanonicalSites } = globalThis.RepoFilter;
  assert.equal(resolveCanonicalSites({ latestStatus: "pending", latestResults: [], historyRecords: [] }), null);
});

test("resolveCanonicalSites falls back to the newest history record when latest.json failed", () => {
  const { resolveCanonicalSites } = globalThis.RepoFilter;
  const sites = resolveCanonicalSites({
    latestStatus: "failed",
    latestResults: [],
    historyRecords: [
      record("2026-08-01T00:00:00Z", [result("Old-name", "https://a.example/")]),
      record("2026-08-01T00:15:00Z", [result("A", "https://a.example/"), result("B", "https://b.example/")]),
    ],
  });
  assert.deepEqual(sites, [
    { key: "https://a.example/", name: "A" },
    { key: "https://b.example/", name: "B" },
  ]);
});

test("resolveCanonicalSites skips history records that carry no targets", () => {
  const { resolveCanonicalSites } = globalThis.RepoFilter;
  // check_jairo.py appends a `results: []` record whenever a run fails at init,
  // so the newest record is not always the one that knows the targets.
  const sites = resolveCanonicalSites({
    latestStatus: "failed",
    latestResults: [],
    historyRecords: [
      record("2026-08-01T00:00:00Z", [result("A", "https://a.example/")]),
      record("2026-08-01T00:15:00Z", []),
      record("2026-08-01T00:30:00Z", undefined),
    ],
  });
  assert.deepEqual(sites, [{ key: "https://a.example/", name: "A" }]);
});

test("resolveCanonicalSites returns null when every history record is empty", () => {
  const { resolveCanonicalSites } = globalThis.RepoFilter;
  assert.equal(resolveCanonicalSites({
    latestStatus: "failed",
    latestResults: [],
    historyRecords: [record("2026-08-01T00:00:00Z", []), record("2026-08-01T00:15:00Z", [])],
  }), null);
});

test("resolveCanonicalSites dedupes keys and falls back to the key when a name is missing", () => {
  const { resolveCanonicalSites } = globalThis.RepoFilter;
  const sites = resolveCanonicalSites({
    latestStatus: "success",
    latestResults: [
      result("A", "https://a.example/"),
      result("A again", "https://a.example/"),
      { url: "https://b.example/", name: null },
      { status_code: 200 },
    ],
    historyRecords: [],
  });
  assert.deepEqual(sites, [
    { key: "https://a.example/", name: "A" },
    { key: "https://b.example/", name: "https://b.example/" },
  ]);
});

test("siteKeyOf keys off url, falling back to name, matching buildSeries in app.js", () => {
  const { siteKeyOf } = globalThis.RepoFilter;
  assert.equal(siteKeyOf({ url: "https://a.example/", name: "A" }), "https://a.example/");
  assert.equal(siteKeyOf({ name: "name-only" }), "name-only");
  assert.equal(siteKeyOf({}), null);
  assert.equal(siteKeyOf(null), null);
});

test("buildRepoHistoryRows defaults a missing state and leaves a non-numeric elapsed_sec non-finite", () => {
  const { buildRepoHistoryRows } = globalThis.RepoFilter;
  const rows = buildRepoHistoryRows(
    [record("2026-08-01T00:00:00Z", [{ url: "https://a.example/", name: "A", status_code: null, elapsed_sec: null, state: null }])],
    "https://a.example/",
  );
  assert.equal(rows[0].state, "UNKNOWN");
  assert.equal(Number.isFinite(rows[0].elapsedSec), false);
});

test("resolveCanonicalSites treats a success with empty results the same as a failure", () => {
  const { resolveCanonicalSites } = globalThis.RepoFilter;
  const sites = resolveCanonicalSites({
    latestStatus: "success",
    latestResults: [],
    historyRecords: [record("2026-08-01T00:00:00Z", [result("A", "https://a.example/")])],
  });
  assert.deepEqual(sites, [{ key: "https://a.example/", name: "A" }]);
});

test("resolveCanonicalSites returns null when there is no usable source at all", () => {
  const { resolveCanonicalSites } = globalThis.RepoFilter;
  assert.equal(resolveCanonicalSites({ latestStatus: "failed", latestResults: [], historyRecords: [] }), null);
  assert.equal(resolveCanonicalSites({ latestStatus: "success", latestResults: [], historyRecords: [] }), null);
});

test("colorForKey assigns palette colors by fixed canonical position, never cycling past the palette length", () => {
  const { colorForKey } = globalThis.RepoFilter;
  const palette = ["#111111", "#222222", "#333333"];
  const canonicalSites = [
    { key: "a", name: "A" },
    { key: "b", name: "B" },
    { key: "c", name: "C" },
    { key: "d", name: "D" },
  ];
  assert.deepEqual(colorForKey(canonicalSites, "a", palette, "#fallback"), { color: "#111111", paletteIndex: 0 });
  assert.deepEqual(colorForKey(canonicalSites, "c", palette, "#fallback"), { color: "#333333", paletteIndex: 2 });
  // 4th site exceeds the 3-color palette: falls back, does not wrap to slot 0.
  assert.deepEqual(colorForKey(canonicalSites, "d", palette, "#fallback"), { color: "#fallback", paletteIndex: null });
});

test("colorForKey falls back for an unknown key", () => {
  const { colorForKey } = globalThis.RepoFilter;
  const canonicalSites = [{ key: "a", name: "A" }];
  assert.deepEqual(colorForKey(canonicalSites, "missing", ["#111111"], "#fallback"), { color: "#fallback", paletteIndex: null });
  assert.deepEqual(colorForKey(null, "a", ["#111111"], "#fallback"), { color: "#fallback", paletteIndex: null });
});

test("resolveActiveRepoKey normalizes \"all\" and falsy requests", () => {
  const { resolveActiveRepoKey } = globalThis.RepoFilter;
  const canonicalSites = [{ key: "a", name: "A" }];
  assert.equal(resolveActiveRepoKey("all", canonicalSites), "all");
  assert.equal(resolveActiveRepoKey(undefined, canonicalSites), "all");
  assert.equal(resolveActiveRepoKey("", canonicalSites), "all");
});

test("resolveActiveRepoKey keeps a key present in canonicalSites and resets a stale one to \"all\"", () => {
  const { resolveActiveRepoKey } = globalThis.RepoFilter;
  const canonicalSites = [{ key: "a", name: "A" }];
  assert.equal(resolveActiveRepoKey("a", canonicalSites), "a");
  assert.equal(resolveActiveRepoKey("removed-from-targets-yml", canonicalSites), "all");
  assert.equal(resolveActiveRepoKey("a", null), "all");
});

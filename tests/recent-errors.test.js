const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

before(async () => {
  await import("../docs/recent-errors.js");
});

const NOW = Date.parse("2026-07-14T12:00:00Z");

function record(ageMs, results) {
  return { checkedAtDate: new Date(NOW - ageMs), results };
}

test("separately counts HTTP errors and timeouts and sorts by latest event", () => {
  const records = [
    record(60_000, [{ name: "new", url: "https://new.example/", status_code: null, state: "TIMEOUT" }]),
    record(120_000, [{ name: "old", url: "https://old.example/", status_code: 503, state: "SERVER_ERROR" }]),
    record(30_000, [{ name: "old", url: "https://old.example/", status_code: 504, state: "TIMEOUT" }]),
  ];

  const result = globalThis.RecentErrors.aggregateRecentErrors(records, NOW);
  assert.deepEqual(result.map(({ name, errorCount, timeoutCount }) => ({ name, errorCount, timeoutCount })), [
    { name: "old", errorCount: 2, timeoutCount: 1 },
    { name: "new", errorCount: 0, timeoutCount: 1 },
  ]);
});

test("includes the seven-day boundary and excludes older, future, normal, and malformed records", () => {
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const result = globalThis.RecentErrors.aggregateRecentErrors([
    record(sevenDays, [{ name: "boundary", status_code: 500, state: "SERVER_ERROR" }]),
    record(sevenDays + 1, [{ name: "too-old", status_code: 500, state: "SERVER_ERROR" }]),
    record(-1, [{ name: "future", status_code: 500, state: "SERVER_ERROR" }]),
    record(1, [{ name: "normal", status_code: 200, state: "OK" }]),
    { checkedAtDate: new Date("invalid"), results: [] },
    { checkedAtDate: new Date(NOW), results: "invalid" },
  ], NOW);

  assert.deepEqual(result.map(({ name }) => name), ["boundary"]);
});

test("describeRecentErrors hides the panel and clears the count when there are no errors", () => {
  const view = globalThis.RecentErrors.describeRecentErrors([], NOW);
  assert.deepEqual(view, { hidden: true, open: false, countText: "" });
});

test("describeRecentErrors opens when an error occurred within the last 24h (boundary inclusive)", () => {
  const activeMs = globalThis.RecentErrors.RECENT_ERROR_ACTIVE_MS;

  const onBoundary = globalThis.RecentErrors.describeRecentErrors([{ latestAt: NOW - activeMs }], NOW);
  assert.equal(onBoundary.open, true);
  assert.equal(onBoundary.hidden, false);

  const justOutside = globalThis.RecentErrors.describeRecentErrors([{ latestAt: NOW - activeMs - 1 }], NOW);
  assert.equal(justOutside.open, false);
  assert.equal(justOutside.hidden, false);
});

test("describeRecentErrors reports the repository count regardless of open state", () => {
  const activeMs = globalThis.RecentErrors.RECENT_ERROR_ACTIVE_MS;
  const view = globalThis.RecentErrors.describeRecentErrors(
    [{ latestAt: NOW - activeMs - 1 }, { latestAt: NOW - activeMs - 1 }, { latestAt: NOW - 60_000 }],
    NOW,
  );
  assert.equal(view.countText, "3リポジトリで検知");
  assert.equal(view.open, true);
});

test("only accepts HTTPS links", () => {
  const { safeHttpsUrl } = globalThis.RecentErrors;
  assert.equal(safeHttpsUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(safeHttpsUrl("http://example.com"), null);
  assert.equal(safeHttpsUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpsUrl("not a url"), null);
});

test("uses external assets with a CSP that forbids inline code", () => {
  const html = readFileSync(join(__dirname, "..", "docs", "index.html"), "utf8");
  const app = readFileSync(join(__dirname, "..", "docs", "app.js"), "utf8");
  const styles = readFileSync(join(__dirname, "..", "docs", "styles.css"), "utf8");
  assert.match(html, /style-src 'self'/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /unsafe-inline/);
  assert.doesNotMatch(html, /<style[\s>]/i);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(app, /\bstyle\s*=/i);
  assert.match(styles, /Digital Agency Design System inspired service theme/);
  assert.match(styles, /--primary:\s*#0017c1/);
  assert.match(styles, /\.recent-errors\s*\{[^}]*border-left:\s*8px solid var\(--error\)/s);
});

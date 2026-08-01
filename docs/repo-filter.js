(function (root) {
  "use strict";

  function siteKeyOf(result) {
    return (result && (result.url || result.name)) || null;
  }

  function filterSeriesByRepo(series, repoKey) {
    const list = Array.isArray(series) ? series : [];
    if (!repoKey || repoKey === "all") {
      return list;
    }
    return list.filter((site) => site.key === repoKey);
  }

  function buildRepoHistoryRows(records, repoKey) {
    if (!repoKey || repoKey === "all") {
      return [];
    }
    const rows = [];
    for (const record of Array.isArray(records) ? records : []) {
      const results = Array.isArray(record.results) ? record.results : [];
      const match = results.find((result) => siteKeyOf(result) === repoKey);
      if (!match) {
        continue;
      }
      const checkedAt = record?.checkedAtDate?.getTime?.();
      if (!Number.isFinite(checkedAt)) {
        continue;
      }
      // A missing elapsed_sec stays non-finite rather than becoming Number(null)
      // === 0, so the renderer shows "-" like the latest-results table does.
      const elapsed = match.elapsed_sec;
      rows.push({
        checkedAt,
        statusCode: match.status_code,
        elapsedSec: elapsed === null || elapsed === undefined ? null : Number(elapsed),
        state: match.state || "UNKNOWN",
        error: match.error,
      });
    }
    return rows.sort((a, b) => b.checkedAt - a.checkedAt);
  }

  function orderFromResults(results) {
    const order = [];
    const seen = new Set();
    for (const result of Array.isArray(results) ? results : []) {
      const key = siteKeyOf(result);
      if (key && !seen.has(key)) {
        seen.add(key);
        order.push({ key, name: (result && result.name) || key });
      }
    }
    return order;
  }

  // Canonical site order drives both the repo filter's option list and the
  // fixed color assignment (colorForKey). It is resolved once and frozen by
  // the caller: latest.json.results is authoritative when non-empty; history is
  // only a fallback for when latest.json failed or returned no results (e.g. a
  // targets.yml load failure during the check run). Returns null when no source
  // yields any site yet, so the caller knows not to freeze.
  function resolveCanonicalSites(input) {
    const { latestStatus, latestResults, historyRecords } = input || {};
    if (latestStatus === "success") {
      const order = orderFromResults(latestResults);
      if (order.length > 0) {
        return order;
      }
    }
    if (latestStatus === "pending") {
      return null;
    }
    // Newest-first, but skipping records that carry no targets: a check run that
    // fails at init appends a `results: []` record (check_jairo.py main()), and
    // freezing on that would strand the dashboard with no sites and no colors
    // until the next successful run.
    const records = Array.isArray(historyRecords) ? historyRecords : [];
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const order = orderFromResults(records[index]?.results);
      if (order.length > 0) {
        return order;
      }
    }
    return null;
  }

  // Categorical color assignment is identity-based (position in canonicalSites),
  // never cycled: a site beyond the palette's length gets the fallback color
  // rather than reusing an earlier slot's hue.
  function colorForKey(canonicalSites, key, palette, fallbackColor) {
    const order = Array.isArray(canonicalSites) ? canonicalSites : [];
    const colors = Array.isArray(palette) ? palette : [];
    const index = key ? order.findIndex((site) => site.key === key) : -1;
    if (index >= 0 && index < colors.length) {
      return { color: colors[index], paletteIndex: index };
    }
    return { color: fallbackColor, paletteIndex: null };
  }

  function resolveActiveRepoKey(requestedKey, canonicalSites) {
    if (!requestedKey || requestedKey === "all") {
      return "all";
    }
    const order = Array.isArray(canonicalSites) ? canonicalSites : [];
    return order.some((site) => site.key === requestedKey) ? requestedKey : "all";
  }

  root.RepoFilter = Object.freeze({
    siteKeyOf,
    filterSeriesByRepo,
    buildRepoHistoryRows,
    resolveCanonicalSites,
    colorForKey,
    resolveActiveRepoKey,
  });
})(globalThis);

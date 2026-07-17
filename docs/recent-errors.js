(function (root) {
  "use strict";

  const HTTP_ERROR_CODES = new Set([500, 502, 503, 504]);
  const RECENT_ERROR_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
  const RECENT_ERROR_ACTIVE_MS = 24 * 60 * 60 * 1000;

  function safeHttpsUrl(value) {
    try {
      const url = new URL(String(value));
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function aggregateRecentErrors(historyRecords, now = Date.now()) {
    const fromTime = now - RECENT_ERROR_PERIOD_MS;
    const errorsByRepository = new Map();

    for (const record of Array.isArray(historyRecords) ? historyRecords : []) {
      const occurredAt = record?.checkedAtDate?.getTime?.();
      if (!Number.isFinite(occurredAt) || occurredAt < fromTime || occurredAt > now) {
        continue;
      }

      for (const result of Array.isArray(record.results) ? record.results : []) {
        const isHttpError = HTTP_ERROR_CODES.has(Number(result.status_code));
        const isTimeout = String(result.state || "UNKNOWN") === "TIMEOUT";
        if (!isHttpError && !isTimeout) {
          continue;
        }

        const key = result.url || result.name;
        if (!key) {
          continue;
        }

        const current = errorsByRepository.get(key) || {
          name: result.name || key,
          url: safeHttpsUrl(result.url),
          errorCount: 0,
          timeoutCount: 0,
          latestAt: 0,
        };
        current.errorCount += Number(isHttpError);
        current.timeoutCount += Number(isTimeout);
        current.latestAt = Math.max(current.latestAt, occurredAt);
        errorsByRepository.set(key, current);
      }
    }

    return [...errorsByRepository.values()].sort((a, b) => b.latestAt - a.latestAt);
  }

  function describeRecentErrors(errors, now = Date.now()) {
    const list = Array.isArray(errors) ? errors : [];
    const active = list.some((error) => {
      const age = now - error?.latestAt;
      return Number.isFinite(age) && age >= 0 && age <= RECENT_ERROR_ACTIVE_MS;
    });
    return {
      hidden: list.length === 0,
      open: active,
      countText: list.length > 0 ? `${list.length}リポジトリで検知` : "",
    };
  }

  root.RecentErrors = Object.freeze({
    aggregateRecentErrors,
    describeRecentErrors,
    safeHttpsUrl,
    RECENT_ERROR_ACTIVE_MS,
  });
})(globalThis);

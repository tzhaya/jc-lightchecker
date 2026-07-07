# JAIRO Cloud Light Checker

JAIRO Cloud 上の機関リポジトリを対象に、トップページへの軽量な HTTP GET で状態を確認するための小さなチェックツールです。厳密な SLA 監視や負荷試験ではなく、自機関だけの問題か、複数機関でも似た遅延や障害が起きているかを判断する材料を残すことを目的にしています。

## Files

| Path | Role |
| --- | --- |
| `targets.yml` | 監視対象サイトの一覧 |
| `scripts/check_jairo.py` | 軽量チェック処理 |
| `scripts/analyze_history.py` | 履歴の応答時間分析 |
| `.github/workflows/check.yml` | GitHub Actions の定期実行 |
| `docs/latest.json` | 最新チェック結果 |
| `docs/history.jsonl` | チェック履歴 |
| `docs/index.html` | GitHub Pages 向けダッシュボード |

## Usage

```bash
python -m pip install -r requirements.txt
python scripts/check_jairo.py
```

実行すると `docs/latest.json` が更新され、`docs/history.jsonl` に1行追記されます。対象サイトが遅い、落ちている、または通信エラーになる場合でも、チェック処理は原則として `exit 1` しません。

## Targets

初期状態では JIRCAS のみを対象にしています。

```yaml
targets:
  - name: JIRCAS
    url: https://jircas.repo.nii.ac.jp/
    primary: true
```

複数サイトへ拡張する場合は、同じ形式で `targets.yml` に追加します。アクセス負荷を避けるため、各サイトのトップページへ順番に1回だけ GET します。

## States

| State | Condition |
| --- | --- |
| `OK` | HTTP 200-399 and less than 5 seconds |
| `SLOW` | HTTP 200-399 and 5 seconds or more |
| `VERY_SLOW` | HTTP 200-399 and 15 seconds or more |
| `SERVER_ERROR` | HTTP 500, 502, 503, or 504 |
| `TIMEOUT` | No response within 20 seconds |
| `UNKNOWN` | DNS, TLS, connection, or other unexpected errors |

初期閾値は `SLOW = 5秒`, `VERY_SLOW = 15秒`, `TIMEOUT = 20秒` です。実測値を1から2週間程度蓄積したあと、必要に応じて見直します。

## Analyze History

```bash
python scripts/analyze_history.py
```

`docs/history.jsonl` から p50 / p90 / p95 / p99 / 最大値と、`TIMEOUT` / `SERVER_ERROR` を含む状態別件数を Markdown 形式で出力します。

## GitHub Actions

`.github/workflows/check.yml` は以下に対応しています。

- `workflow_dispatch` による手動実行
- 15分間隔の schedule 実行
- `docs/latest.json` と `docs/history.jsonl` の自動コミット

## Dashboard

`docs/index.html` は `docs/latest.json` を読み込み、対象サイト名、URL、HTTP ステータス、応答時間、判定結果、エラー内容を一覧表示します。GitHub Pages では `docs/` を公開対象にしてください。

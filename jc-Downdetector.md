# JAIRO Cloud downdetector 設計案

## 1. 目的

本ツールの目的は、JAIRO Cloudで構築された機関リポジトリに対して、厳密なヘルスチェックを行うことではなく、**機関リポジトリ担当者が「自機関だけの問題か、他機関も同時に遅い・落ちているのか」を判断する材料を提供すること**です。

JAIRO Cloud は、NII開発のWEKOを採用したクラウド型の機関リポジトリ環境提供サービスで、多数の機関が利用しています。そのため、複数の `repo.nii.ac.jp` 系機関リポジトリを横断的に確認することで、広域的な遅延・障害の推測材料になります。 [\[w3tutorials.net\]](https://www.w3tutorials.net/blog/how-to-force-job-to-exit-in-github-actions-step/)

***

## 2. 想定する利用シーン

### 例

JIRCAS機関リポジトリ：

```text
https://jircas.repo.nii.ac.jp/
```

に対して、以下のような事象が発生した場合を想定します。

* 応答が非常に遅い
* HTTP 502 が返る
* HTTP 503 が返る
* タイムアウトする
* 利用者から「リポジトリが開けない」と問い合わせがある

このとき、担当者が以下を確認できるようにします。

```text
自機関だけが異常なのか？
他のJAIRO Cloud利用機関も同時に異常なのか？
```

***

# 3. 基本方針

## 3.1 やること

* 複数の機関リポジトリのトップページへ軽量アクセスする
* HTTPステータスコードを取得する
* 応答時間を測定する
* 結果を一覧化する
* GitHub Pages 等で簡易ダッシュボード表示する
* 必要に応じて Slack / Teams 等へ通知する

## 3.2 やらないこと

* 厳密なSLA監視
* 負荷試験
* ログイン後画面の監視
* 検索処理の実行
* PDFファイルのダウンロード確認
* OAI-PMHの収集確認
* アイテム詳細ページの大量チェック
* 1分未満の高頻度監視

監視自体がJAIRO Cloud側に負荷をかけないよう、**軽量・低頻度・横断比較重視**とします。

***

# 4. 推奨システム構成

## 推奨構成

```text
GitHub Repository
 ├─ .github/
 │   └─ workflows/
 │       └─ check.yml
 ├─ scripts/
 │   └─ check_jairo.py
 ├─ targets.yml
 ├─ docs/
 │   ├─ index.html
 │   ├─ latest.json
 │   └─ history.jsonl
 ├─ requirements.txt
 └─ README.md
```

## 各要素の役割

| ファイル                          | 役割                     |
| ----------------------------- | ---------------------- |
| `.github/workflows/check.yml` | GitHub Actions の定期実行定義 |
| `scripts/check_jairo.py`      | 実際のチェック処理              |
| `targets.yml`                 | 監視対象リポジトリ一覧            |
| `docs/latest.json`            | 最新のチェック結果              |
| `docs/history.jsonl`          | 簡易履歴                   |
| `docs/index.html`             | GitHub Pages 用の表示画面    |
| `requirements.txt`            | Python依存ライブラリ          |
| `README.md`                   | 運用説明                   |

GitHub Actions はスケジュール実行や手動実行に対応しており、実行履歴・ログも確認できます。 [\[jircas.rep....nii.ac.jp\]](https://jircas.repo.nii.ac.jp/), [\[jpcoar.org\]](https://jpcoar.org/support/jairo-cloud/)

***

# 5. 監視対象定義

## `targets.yml` 例

```yaml
targets:
  - name: JIRCAS
    url: https://jircas.repo.nii.ac.jp/
    primary: true

  - name: Sample Institution A
    url: https://sample-a.repo.nii.ac.jp/
    primary: false

  - name: Sample Institution B
    url: https://sample-b.repo.nii.ac.jp/
    primary: false
```

## 設計上の考え方

最初は **10〜30機関程度**で十分です。

対象には以下を含めると判断しやすくなります。

* 自機関
* 同じJAIRO Cloud利用機関
* 規模が近い機関
* 継続的に比較対象としたい機関
* 関係機関・近隣分野の機関

重要なのは網羅性ではなく、\*\*「比較できること」\*\*です。

***

# 6. チェック内容

## 取得する項目

各URLに対して以下を記録します。

```text
機関名
URL
確認日時
HTTPステータスコード
応答時間 秒
判定結果
エラー内容
```

## HTTPステータスの扱い

HTTPレスポンスステータスコードは、リクエストが正常に完了したかを示すものです。200番台は成功、500番台はサーバーエラーに分類されます。 [\[docs.slack.dev\]](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)

今回特に重視するのは以下です。

```text
502 Bad Gateway
503 Service Unavailable
504 Gateway Timeout
500 Internal Server Error
```

***

# 7. 判定ロジック

## 推奨分類

```text
OK
SLOW
VERY_SLOW
SERVER_ERROR
TIMEOUT
UNKNOWN
```

## 判定条件例

| 判定             | 条件                            |
| -------------- | ----------------------------- |
| `OK`           | HTTP 200〜399、かつ応答時間 5秒未満      |
| `SLOW`         | HTTP 200〜399、かつ応答時間 5秒以上15秒未満 |
| `VERY_SLOW`    | HTTP 200〜399、かつ応答時間 15秒以上     |
| `SERVER_ERROR` | HTTP 500, 502, 503, 504       |
| `TIMEOUT`      | 指定秒数以内に応答なし                   |
| `UNKNOWN`      | DNSエラー、TLSエラー、その他例外           |

***

# 8. 「他もダウンしているか」の判断ロジック

## 自機関のみ異常

```text
自機関: SERVER_ERROR または TIMEOUT
他機関: 大半が OK

判定:
自機関固有の問題、または自機関リポジトリへの局所的なアクセス集中の可能性
```

## 複数機関で異常

```text
自機関: SERVER_ERROR または TIMEOUT
他機関: 複数で SERVER_ERROR / TIMEOUT / VERY_SLOW

判定:
JAIRO Cloud基盤、共通ネットワーク、または広域的な負荷の可能性
```

## 複数機関で遅延

```text
自機関: SLOW または VERY_SLOW
他機関: SLOW / VERY_SLOW が多い

判定:
広域的な遅延傾向の可能性
```

## 自機関以外は正常

```text
自機関: SLOW / SERVER_ERROR / TIMEOUT
他機関: ほぼ OK

判定:
自機関固有の要因を優先的に確認
```

***

# 9. 応答時間の測定方法

## curlによる測定

GitHub Actions では以下で測定できます。

```bash
curl -o /dev/null -s -w \
"url=https://jircas.repo.nii.ac.jp/ status=%{http_code} time_total=%{time_total}\n" \
--max-time 20 \
https://jircas.repo.nii.ac.jp/
```

出力例：

```text
url=https://jircas.repo.nii.ac.jp/ status=200 time_total=1.842391
```

意味：

```text
status      HTTPステータスコード
time_total  全体応答時間 秒
```

***

# 10. Python実装例

## `requirements.txt`

```txt
requests
pyyaml
```

## `scripts/check_jairo.py`

```python
import json
import time
import yaml
import requests
from datetime import datetime, timezone, timedelta
from pathlib import Path

JST = timezone(timedelta(hours=9))

TIMEOUT_SEC = 20
SLOW_SEC = 5
VERY_SLOW_SEC = 15

TARGETS_FILE = "targets.yml"
OUTPUT_DIR = Path("docs")
LATEST_FILE = OUTPUT_DIR / "latest.json"
HISTORY_FILE = OUTPUT_DIR / "history.jsonl"

USER_AGENT = "JAIRO-Cloud-Light-Checker/0.1 contact: your-email@example.jp"


def classify(status_code, elapsed_sec, error):
    if error == "timeout":
        return "TIMEOUT"

    if error:
        return "UNKNOWN"

    if status_code in [500, 502, 503, 504]:
        return "SERVER_ERROR"

    if status_code is not None and 200 <= status_code < 400:
        if elapsed_sec is not None and elapsed_sec >= VERY_SLOW_SEC:
            return "VERY_SLOW"
        if elapsed_sec is not None and elapsed_sec >= SLOW_SEC:
            return "SLOW"
        return "OK"

    return "UNKNOWN"


def load_targets():
    with open(TARGETS_FILE, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data["targets"]


def check_target(target):
    name = target["name"]
    url = target["url"]
    primary = target.get("primary", False)

    status_code = None
    elapsed_sec = None
    error = None

    headers = {
        "User-Agent": USER_AGENT
    }

    try:
        start = time.time()
        response = requests.get(
            url,
            timeout=TIMEOUT_SEC,
            headers=headers,
            allow_redirects=True
        )
        elapsed_sec = round(time.time() - start, 3)
        status_code = response.status_code

    except requests.exceptions.Timeout:
        error = "timeout"

    except Exception as e:
        error = str(e)

    state = classify(status_code, elapsed_sec, error)

    return {
        "name": name,
        "url": url,
        "primary": primary,
        "status_code": status_code,
        "elapsed_sec": elapsed_sec,
        "state": state,
        "error": error
    }


def summarize(results):
    counts = {
        "OK": 0,
        "SLOW": 0,
        "VERY_SLOW": 0,
        "SERVER_ERROR": 0,
        "TIMEOUT": 0,
        "UNKNOWN": 0
    }

    for r in results:
        counts[r["state"]] = counts.get(r["state"], 0) + 1

    total = len(results)
    abnormal_count = (
        counts["SLOW"]
        + counts["VERY_SLOW"]
        + counts["SERVER_ERROR"]
        + counts["TIMEOUT"]
    )

    primary_results = [r for r in results if r.get("primary")]
    primary_state = primary_results[0]["state"] if primary_results else None

    if total == 0:
        message = "監視対象がありません。"
    elif counts["SERVER_ERROR"] + counts["TIMEOUT"] >= 3:
        message = "複数機関でサーバーエラーまたはタイムアウトを確認しました。広域的な事象の可能性があります。"
    elif abnormal_count / total >= 0.5:
        message = "複数機関で応答遅延または異常を確認しました。広域的な遅延傾向の可能性があります。"
    elif primary_state in ["SERVER_ERROR", "TIMEOUT", "SLOW", "VERY_SLOW"]:
        message = "自機関に異常または遅延がありますが、他機関への広がりは限定的です。自機関固有の要因も確認してください。"
    else:
        message = "大きな異常は確認されていません。"

    return {
        "counts": counts,
        "message": message
    }


def main():
    OUTPUT_DIR.mkdir(exist_ok=True)

    checked_at = datetime.now(JST).isoformat()
    targets = load_targets()

    results = []
    for target in targets:
        results.append(check_target(target))

    summary = summarize(results)

    latest = {
        "checked_at": checked_at,
        "summary": summary,
        "results": results
    }

    with open(LATEST_FILE, "w", encoding="utf-8") as f:
        json.dump(latest, f, ensure_ascii=False, indent=2)

    history_record = {
        "checked_at": checked_at,
        **summary["counts"]
    }

    with open(HISTORY_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(history_record, ensure_ascii=False) + "\n")

    print(json.dumps(latest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
```

***

# 11. GitHub Actions設定

## `.github/workflows/check.yml`

```yaml
name: JAIRO Cloud Light Check

on:
  schedule:
    - cron: "*/15 * * * *"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: |
          pip install -r requirements.txt

      - name: Run checker
        run: |
          python scripts/check_jairo.py

      - name: Commit result
        run: |
          git config user.name "github-actions"
          git config user.email "github-actions@github.com"
          git add docs/latest.json docs/history.jsonl
          git commit -m "Update JAIRO Cloud status" || echo "No changes"
          git push
```

GitHub Actionsでは、非ゼロの終了コードを返すとワークフローが失敗扱いになります。今回は単なる情報提供を目的とするため、通常は異常があっても `exit 1` しない設計がよいです。必要に応じて、広域異常時のみ失敗扱いにできます。 [\[developer....ozilla.org\]](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status)

***

# 12. GitHub Pages表示イメージ

## `docs/index.html` の役割

`docs/latest.json` を読み込み、以下を表示します。

```text
JAIRO Cloud 簡易横断ステータス

最終確認日時:
2026-07-07 16:30 JST

全体判定:
複数機関でサーバーエラーまたはタイムアウトを確認しました。
広域的な事象の可能性があります。

集計:
OK           18
SLOW          4
VERY_SLOW     1
SERVER_ERROR  3
TIMEOUT       1
UNKNOWN       0

詳細:
JIRCAS                  503    8.2 sec    SERVER_ERROR
Sample Institution A    200    1.2 sec    OK
Sample Institution B    200   12.4 sec    SLOW
Sample Institution C    ---     ---       TIMEOUT
```

担当者はこの画面を見るだけで、\*\*「自機関だけか」「他も同時に遅いか」\*\*を判断できます。

***

# 13. 通知設計

通知は最初から必須ではありません。

入れる場合は、**単一サイトの異常では通知しない**方がよいです。

## 推奨通知条件

```text
SERVER_ERROR または TIMEOUT が3件以上
```

または、

```text
監視対象の30%以上が SERVER_ERROR / TIMEOUT
```

または、

```text
監視対象の50%以上が SLOW / VERY_SLOW / SERVER_ERROR / TIMEOUT
```

Slack Incoming Webhook は、Webhook URLへJSONペイロードを送ることでSlackチャンネルに投稿できます。Webhook URLは秘密情報なので、GitHub Secretsに保存する設計が適切です。 [\[oneuptime.com\]](https://oneuptime.com/blog/post/2025-12-20-scheduled-workflows-cron-github-actions/view), [\[learn.microsoft.com\]](https://learn.microsoft.com/en-us/troubleshoot/developer/webapps/iis/health-diagnostic-performance/http-status-code)

***

# 14. Slack通知例

## GitHub Actions側

```yaml
      - name: Notify Slack on broad issue
        if: always()
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: |
          python scripts/notify_slack.py
```

## 通知メッセージ例

```text
JAIRO Cloud簡易横断チェックで複数機関の異常を確認しました。

SERVER_ERROR: 3
TIMEOUT: 1
SLOW: 4

自機関固有ではなく、広域的な遅延・障害の可能性があります。
詳細はGitHub Pagesを確認してください。
```

***

# 15. アクセス負荷への配慮

このツールでは、以下を実装ルールにします。

```text
1機関につき1回のGETのみ
トップページのみ確認
PDFや詳細ページは取得しない
検索処理は実行しない
OAI-PMHにはアクセスしない
タイムアウトは20秒
実行間隔は通常15分
User-Agentに連絡先を明記
並列実行する場合は3〜5程度に制限
過剰なリトライはしない
```

特に今回の主題が「大規模アクセスによる遅延」であるため、チェッカー自身は極めて軽量に設計すべきです。

***

# 16. 先ほどのJIRCAS確認結果

テストとして、以下にアクセスしました。

```text
https://jircas.repo.nii.ac.jp/
```

その結果、ページ内容は取得でき、タイトルとして `国際農研機関リポジトリ` が確認できました。トップページ、ランキング、検索、インデックスツリー、新着アイテム等の内容も取得できています。 [\[note.com\]](https://note.com/pnk2_tech/n/nf93ae09ab04e)

ただし、こちらの確認方法では、正確なHTTPステータスコードや応答時間は測定できませんでした。

したがって確認結果は以下です。

```text
JIRCAS:
  内容取得: 成功
  HTTPステータス: 未測定
  応答時間: 未測定
  簡易判定: 応答あり
```

実装後は `curl` または Python `requests` により、HTTPステータスと応答時間を取得できます。

***

# 17. 最小実装ステップ

## Step 1: GitHubリポジトリ作成

```text
jairo-cloud-light-checker
```

などの名前で作成します。

## Step 2: ファイルを配置

```text
targets.yml
requirements.txt
scripts/check_jairo.py
.github/workflows/check.yml
docs/index.html
```

## Step 3: 監視対象を登録

まずは自機関を含む10件程度から開始します。

```yaml
targets:
  - name: JIRCAS
    url: https://jircas.repo.nii.ac.jp/
    primary: true
```

## Step 4: GitHub Actionsを手動実行

`workflow_dispatch` で実行します。

## Step 5: `docs/latest.json` を確認

HTTPステータス、応答時間、判定結果が出ることを確認します。

## Step 6: GitHub Pagesを有効化

`docs/` ディレクトリを公開対象にします。

## Step 7: 必要に応じて通知追加

Slack / Teams 通知を追加します。

***

# 18. 運用ルール案

## 通常時

```text
15分ごとに自動実行
GitHub Pagesで結果確認
通知なし、または広域異常時のみ通知
```

## 障害疑い時

```text
GitHub Actionsを手動実行
自機関と他機関の結果を比較
複数機関で異常があれば広域事象として扱う
他機関が正常なら自機関固有の要因を確認
```

## 記録

```text
latest.json:
  最新結果

history.jsonl:
  集計履歴のみ
```

詳細ログを長期間保存するとリポジトリが肥大化するため、履歴は集計値中心で十分です。

***

# 19. READMEに書くべき内容

```markdown
# JAIRO Cloud Light Checker

## 目的

JAIRO Cloud上の複数機関リポジトリを軽量に確認し、
自機関のみの異常か、複数機関にまたがる遅延・障害かを判断する材料を提供する。

## チェック内容

- トップページへのHTTP GET
- HTTPステータスコード
- 応答時間
- 簡易判定

## 判定

- OK
- SLOW
- VERY_SLOW
- SERVER_ERROR
- TIMEOUT
- UNKNOWN

## 注意

- 負荷試験ではない
- 検索やPDFダウンロードは行わない
- 15分間隔を基本とする
- User-Agentに連絡先を含める

## 監視対象の追加

targets.yml に追加する。

## 手動実行

GitHub Actions の workflow_dispatch から実行する。
```

***

# 20. 結論

今回の要件には、以下の構成が最適です。

```text
GitHub Actions
  15分間隔で実行

Python checker
  複数のJAIRO Cloudトップページへ軽量GET

測定項目
  HTTPステータス
  応答時間
  タイムアウト
  例外

判定
  OK / SLOW / VERY_SLOW / SERVER_ERROR / TIMEOUT / UNKNOWN

出力
  latest.json
  history.jsonl
  GitHub Pagesダッシュボード

通知
  複数機関で異常が出た場合のみ
```

狙いは、監視精度ではなく、担当者がすぐに次の判断をできることです。

```text
自機関だけおかしいのか？
JAIRO Cloud上の他機関も同時におかしいのか？
```

この問いに答えるための **軽量な横断確認ツール**として実装するのがよいです。

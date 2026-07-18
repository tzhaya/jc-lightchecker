# JAIRO Cloud Light Checker

JAIRO Cloud 上の機関リポジトリに対して、トップページへの軽量な HTTP GET を行い、応答状況を記録する小さな確認ツールです。

厳密な SLA 監視や負荷試験ではありません。複数サイトで同じような遅延や障害が起きているかを見比べるための、個人運用向けの簡易チェックとして作っています。

## 現在の構成

| Path | Role |
| --- | --- |
| `targets.yml` | 監視対象サイトの一覧 |
| `scripts/check_jairo.py` | HTTP チェック本体 |
| `scripts/analyze_history.py` | `docs/history.jsonl` の簡易集計 |
| `.github/workflows/check.yml` | チェックを実行し、結果をコミットする GitHub Actions workflow |
| `cloudflare-worker/` | GitHub Actions を定期起動する Cloudflare Worker |
| `docs/latest.json` | 最新のチェック結果 |
| `docs/history.jsonl` | チェック履歴 |
| `docs/index.html` | GitHub Pages 向けの静的ダッシュボード |
| [`notes/notification_setup.md`](notes/notification_setup.md) | Slack、Teams、Discord の通知先設定 |

## 使い方

このプロジェクトの Python スクリプトは、現在は標準ライブラリだけで動作します。

```bash
python -m pip install -r requirements.txt
python scripts/check_jairo.py
```

実行すると `docs/latest.json` が更新され、`docs/history.jsonl` に1行追記されます。対象サイトが遅い、落ちている、通信エラーになる場合でも、情報提供用の記録を残すため、チェックスクリプト自体は原則として `exit 1` しません。

## 監視対象

監視対象は `targets.yml` で管理します。
現在は次の4つの機関リポジトリを対象にしています。
あわせて、ResearchMap、IRDB、AgriKnowledge を参考値として取得しています。

| URL | 備考 |
| --- | --- |
| `https://jircas.repo.nii.ac.jp/` | 国際農研機関リポジトリ |
| `https://repository.naro.go.jp/` | 農研機構機関リポジトリ |
| `https://tsukuba.repo.nii.ac.jp/` | つくばリポジトリ |
| `https://ipsj.ixsq.nii.ac.jp/` | 情報学広場（情報処理学会） |
| `https://researchmap.jp/` | ResearchMap（参考値） |
| `https://irdb.nii.ac.jp/` | IRDB（参考値） |
| `https://agriknowledge.affrc.go.jp/` | AgriKnowledge（参考値） |

追加する場合は、同じ形式で `targets.yml` に `name`、`url`、`primary` を追加します。各サイトのトップページに対して、1回だけ軽量な GET を行います。

```yaml
targets:
  - name: example repository
    url: https://example.repo.nii.ac.jp/
    primary: false
```

## 判定ルール

| State | Condition |
| --- | --- |
| `OK` | HTTP 200-399 かつ 5 秒未満 |
| `SLOW` | HTTP 200-399 かつ 5 秒以上 |
| `VERY_SLOW` | HTTP 200-399 かつ 15 秒以上 |
| `SERVER_ERROR` | HTTP 500, 502, 503, 504 |
| `TIMEOUT` | 20 秒以内に応答なし |
| `UNKNOWN` | DNS、TLS、接続エラー、その他の予期しないエラー |

現在のしきい値は `SLOW = 5秒`、`VERY_SLOW = 15秒`、`TIMEOUT = 20秒` です。見直しメモは `notes/threshold_analysis.md` にあります。

## 履歴分析

```bash
python scripts/analyze_history.py
```

`docs/history.jsonl` から、応答時間の p50 / p90 / p95 / p99 / 最大値と、状態別件数を Markdown 形式で出力します。別の履歴ファイルを指定することもできます。

```bash
python scripts/analyze_history.py path/to/history.jsonl
```

## 履歴の保持

`docs/history.jsonl` はチェックのたびに追記され、削除は行われません。放置するとリポジトリと GitHub Pages の配信サイズが増え続けるため、`scripts/check_jairo.py` は書き込みのたびに保持期間より古いレコードを刈り込みます。

このサイトでは**過去14日分**を保持します。保持日数は環境変数 `HISTORY_RETENTION_DAYS` で決まり（未設定時は14日）、`.github/workflows/check.yml` の `Run checker` ステップで GitHub Actions のリポジトリ変数から読み込んでいます。

```yaml
env:
  HISTORY_RETENTION_DAYS: ${{ vars.HISTORY_RETENTION_DAYS || '14' }}
```

フォークして保持日数を変えたい場合は、コードを変更する必要はありません。フォーク先のリポジトリで Settings → Secrets and variables → Actions → Variables を開き、`HISTORY_RETENTION_DAYS` に任意の日数を設定してください。

## ダッシュボード

`docs/index.html` は `docs/latest.json` と `docs/history.jsonl` を読み込み、次の情報を表示します。

- 最新チェック時刻
- 全体サマリーと状態別件数
- 対象サイトごとの HTTP ステータス、応答時間、判定、エラー内容
- 12h / 24h / 7d / all の応答時間グラフ
- 履歴の Records、Samples、p50、p95、Slow+ 件数
- 過去7日間に検知した HTTP 500、502、503、504 と Timeout のリポジトリ別件数、および直近の発生日時

このエラー集計は折りたたみ式のセクションで、`Response Trend` の直後に表示されます。
`summary` には検知したリポジトリ数を表示するため、閉じた状態でも規模を把握できます。
直近24時間以内に発生があれば自動で開き、古い記録だけの場合は閉じたままにします。
過去7日間に対象となるエラーが1件もない場合は、セクション自体を表示しません。
一覧は、直近の発生日時が新しいリポジトリから順に並びます。

ダッシュボードの外観は、[デジタル庁デザインシステム](https://design.digital.go.jp/dads/)を参考にしています。信頼性と公共性を意識したブルーを基調とし、次の点を反映しています。

- 16px を基準とした本文サイズと、`Noto Sans JP` を優先するフォント設定
- ニュートラルカラーを中心とした背景、境界線、本文色
- 成功、警告、エラーを区別するセマンティックカラー
- カード、データテーブル、チップラベルを意識したコンポーネント表現
- キーボード操作時のフォーカス表示とスマートフォン向けレイアウト

GitHub Pages では `docs/` を公開対象にします。ローカルで確認する場合は、`docs/` で簡易サーバーを起動して開きます。

```bash
cd docs
python -m http.server 8000
```

その後、`http://localhost:8000/` をブラウザで開きます。

## GitHub Actions

`.github/workflows/check.yml` は `workflow_dispatch` で手動実行できます。実行内容は次の通りです。

- Python 3.12 をセットアップ
- `python scripts/check_jairo.py` を実行
- `docs/latest.json` と `docs/history.jsonl` をコミット
- 変更がない場合はコミットせず終了

現在、GitHub Actions 側には `schedule` は設定していません。定期実行は Cloudflare Worker から `workflow_dispatch` を呼び出す構成です。

## Cloudflare Worker

`cloudflare-worker/` には、GitHub Actions を定期起動する Worker があります。

- cron: `7,22,37,52 * * * *`
- Worker は Cron 専用で、公開 HTTP エンドポイントは提供しません。

必要な環境変数は `cloudflare-worker/wrangler.jsonc` に定義されています。

| Variable | Meaning |
| --- | --- |
| `GITHUB_OWNER` | GitHub owner |
| `GITHUB_REPO` | GitHub repository |
| `GITHUB_WORKFLOW_FILE` | 起動する workflow ファイル名 |
| `GITHUB_REF` | 実行対象の ref |

`GITHUB_TOKEN` は Worker secret として設定します。初回デプロイ時、または
Secret が存在しない場合は、値をコマンドライン引数に含めず、対話形式で登録してください。

```powershell
cd cloudflare-worker
npx wrangler secret put GITHUB_TOKEN
```

### デプロイ

このリポジトリには、GitHubからCloudflare Workersへ自動デプロイする設定はありません。
Workerのコードや`wrangler.jsonc`を変更した場合、GitHubへのpushやPRのマージだけでは
Cloudflare上のWorkerは更新されないため、手動で再デプロイします。

```powershell
cd cloudflare-worker
npm ci
npm test
npm audit --audit-level=low
npx wrangler deploy --dry-run
npm run deploy
npx wrangler deployments list
```

既存の`GITHUB_TOKEN`はWorker Secretとして保持されるため、通常は再登録不要です。
デプロイ後は、最新デプロイの作成日時が更新されていること、設定済みCronで
GitHub Actionsが正常に起動すること、公開HTTPエンドポイントからWorkflowを
起動できないことを確認してください。

### 2026-07-14のセキュリティ修正

以前のWorkerには、認証なしの`/trigger`からGitHub Actionsを繰り返し起動できる問題が
ありました。Actions実行枠、監視対象への通信、履歴コミットを増加させる可能性が
ありましたが、任意コード実行、任意Workflow入力、`GITHUB_TOKEN`や個人情報の漏えいは
確認されていません。主な影響は可用性とリソース消費で、リスクは低～中程度と評価しています。

この修正以前にリポジトリをcloneしてWorkerをデプロイした利用者は、最新版を取得して
上記手順で再デプロイしてください。詳細は[Issue #9](https://github.com/tzhaya/jc-lightchecker/issues/9)と
[PR #10](https://github.com/tzhaya/jc-lightchecker/pull/10)を参照してください。

## 更新履歴

- 2026-07-18: `docs/history.jsonl` の保持期間を14日に制限し、`HISTORY_RETENTION_DAYS` でフォーク側から設定できるようにした。ダッシュボードの期間選択から `30d` を削除し、`12h`/`24h`/`7d`/`all` の固定4択にした。
- 2026-07-18: 実装メモや依頼プロンプトなどの内部文書を `docs/` から `notes/` へ移動し、GitHub Pages の公開対象と分離した。
- 2026-07-17: 情報学広場を監視対象に追加。過去7日間のエラー集計セクションを折りたたみ式にし、直近24時間に発生があれば自動で開くようにした。
- 2026-07-14: 過去7日間の集計対象に Timeout を追加。参考値に AgriKnowledge を追加。
- 2026-07-14: CI、CodeQL、CSP、HTTPS 検証を追加し、Worker を Cron 専用に変更。
- 2026-07-14: 観測対象に参考値としてResearchMap、IRDBを追加。
- 2026-07-11: デジタル庁デザインシステムを参考にダッシュボードの配色とUIを更新し、過去7日間の HTTP サーバーエラー集計表示を追加。
- 2026-07-09: README を現在の実装内容に合わせて再整理し、構成、実行方法、Cloudflare Worker、ダッシュボードの説明を更新。
- 2026-07-08: Cloudflare Worker から GitHub Actions を定期起動する構成、複数サイトの履歴グラフ表示を追加。
- 2026-07-07: 軽量 HTTP チェック、最新結果 JSON、履歴 JSONL、静的ダッシュボードの初期構成を作成。

## AI の利用

このアプリケーションの作成や更新では、生成 AI によるコーディング支援を利用しています。

## 作者

- Takanori Hayashi

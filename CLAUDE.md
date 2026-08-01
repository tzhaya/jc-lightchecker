# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

JAIRO Cloud 上の機関リポジトリを対象にした軽量な稼働確認ツール（プロダクト名は「jc-lightchecker」。コードや設定が参照する GitHub リポジトリは `tzhaya/jc-lightchecker`）。Python スクリプトが各対象へ 1 回だけ軽量な HTTP GET を行い、応答を分類して静的ダッシュボード用のデータファイルへ追記する。Cloudflare Worker の cron が 15 分おきに GitHub Actions を起動し、workflow がチェッカーを実行して結果をリポジトリへコミット、GitHub Pages がそれを配信する。厳密な SLA 監視ではなく、個人運用の簡易ツールである。

## コマンド

**テストスイートは 3 系統あり**、それぞれ実行ランナーと作業ディレクトリが異なる。CI（`.github/workflows/ci.yml`）はこのすべてを実行する。

```bash
# Python チェッカー/アナライザーのテスト — 必ずリポジトリルートで実行する
# （テストが `from scripts import check_jairo` を行うため、ルートが sys.path に必要）
python -m unittest discover -s tests -p "test_*.py"

# ブラウザ用ダッシュボード JS のテスト（docs/recent-errors.js + CSP アサーション）— ルートで実行
npm test                    # -> node --test tests/*.test.js

# Cloudflare Worker のテスト（vitest）— cloudflare-worker/ で実行
cd cloudflare-worker && npm test

# CI が課す構文チェック
python -m compileall -q scripts tests
node --check docs/recent-errors.js && node --check docs/repo-filter.js && node --check docs/app.js
```

ツールの実行:

```bash
python scripts/check_jairo.py        # docs/latest.json を更新し docs/history.jsonl へ追記、docs/index.html の description を書き換え
python scripts/analyze_history.py [path/to/history.jsonl]   # パーセンタイルの Markdown レポートを出力
python scripts/verify_public_ogp.py [base_url]   # 公開済みの OGP メタデータと ogp.png を検証（手動実行・リリース時のみ）

cd docs && python -m http.server 8000   # http://localhost:8000/ でダッシュボードをプレビュー
```

Worker のデプロイ（**手動のみ** — push やマージではデプロイ済み Worker は更新されない）:

```bash
cd cloudflare-worker
npm ci && npm test && npx wrangler deploy --dry-run
npm run deploy                       # wrangler deploy
npx wrangler secret put GITHUB_TOKEN # secret が無い場合のみ。値は対話形式で入力する
```

Python コードは**標準ライブラリのみ**を使う（`requirements.txt` は意図的に空）。強い理由なくサードパーティ依存を追加しないこと。

## アーキテクチャと不変条件

データフロー: `targets.yml` → `check_jairo.py` → `docs/latest.json`（上書き）+ `docs/history.jsonl`（追記専用・git にコミット）+ `docs/index.html` の description（書き換え・git にコミット）→ `docs/app.js` が JSON 2 つを fetch して静的ダッシュボードを描画。

- **`scripts/check_jairo.py`** が中核。テストと CI が依存する、意図的な挙動に注意:
  - **異常終了しない**。全面的な失敗時でも、有効な `latest.json`/`history.jsonl` レコード（`level: UNKNOWN`）を書き出し、ダッシュボードが常にデータを持てるようにしている。
  - `targets.yml` は PyYAML ではなく**自前の最小パーサ**（`load_targets`）で解析する。理解できるのは `name`/`url`/`primary` のフラットなリスト構造だけで、複雑な YAML は壊れる。各対象 URL は HTTPS であることを検証し、そうでなければ拒否する。
  - **ファイル出力はすべて `write_text_atomic`（一時ファイル + `os.replace`）を通す。** `open(path, "w")` は開いた時点で truncate するため、途中で失敗すると例外を捕捉しても公開ファイルが壊れる。特に `docs/index.html` は手で保守しているソースであり、再生成する元がない。
  - `write_outputs` は追記のたびに `prune_history` を呼び、`HISTORY_RETENTION_DAYS`（環境変数、デフォルト14日。`check.yml` では `vars.HISTORY_RETENTION_DAYS` で上書き可能）より古い `history.jsonl` の行を刈り込む。刈り込み中の例外はすべて捕捉し、失敗時は当該回をスキップする（異常終了しない不変条件を優先する）。
  - `write_outputs` は続けて `update_index_metadata` を呼び、`docs/index.html` の `og:description` と `twitter:description` の `content` 属性**だけ**を現在の状態で書き換える。title 系は静的で、書き換えない。`prune_history` と同様に例外はすべて捕捉し、失敗時は当該回をスキップする。該当タグがちょうど1つ見つからなければ書き込まず `ValueError` を投げる（片方だけ更新された HTML を出さないため）。
  - 状態分類（`classify`）と、サイト横断の総合判定ロジック（`summarize`）が最も慎重を要する部分。しきい値は `SLOW=5秒`、`VERY_SLOW=15秒`、`TIMEOUT=20秒`。タイムスタンプは JST。

- **`scripts/verify_public_ogp.py`** は公開済み URL に対するリリース時のゲート。**`check_jairo.py` とは失敗時の意味論が逆で、問題を見つけたら理由を出力して非 0 で終了する。** 既存コードの「異常終了しない」パターンをここへ持ち込まないこと。`check.yml` からも `ci.yml` からも呼ばない（検証対象は Pages デプロイの性質であって毎回のチェック結果ではなく、Pages の公開は非同期で最大10分かかるため）。リクエスト単位の timeout と全体の deadline / 試行回数上限を両方定数で持つ。`DISCLAIMER` は `check_jairo` と重複定義しており、`tests/test_verify_public_ogp.py` が両者の一致を固定している。

- **`docs/` ダッシュボード**は静的で**ビルド工程なし**。厳格な CSP（`index.html` の meta タグ）がインラインの script と style を禁止しており、`tests/recent-errors.test.js` がこれをアサートする。よって JS はすべて `.js`、CSS はすべて `styles.css` に置き、`<style>`・インライン `<script>`・`style=` 属性は使わないこと。同テストはデザイントークン（例: `--primary: #0017c1`、デジタル庁デザインシステム由来のテーマ）やレイアウト規則も固定しているため、テーマ変更前に必ず確認する。デザインの参照は `~/.claude/skills/dads/`（Skill としてインストール済みの場合、自動的に参照される）または https://design.digital.go.jp/dads/ を直接参照する。モデルの事前学習知識だけで配色・トークン値を断定しないこと。
  - `docs/recent-errors.js` と `docs/repo-filter.js` はいずれも IIFE で `globalThis.RecentErrors` / `globalThis.RepoFilter` を公開し、ブラウザと Node のテストランナーの両方で同一ファイルが無改変で動くようにしている。HTTPS 限定のリンク検証（`safeHttpsUrl`）は Python 側の HTTPS チェックと対応している。
  - `docs/` に新しいブラウザ JS ファイルを追加したら、`.github/workflows/ci.yml` の `node --check` 行（ファイルを個別列挙しておりグロブではない）にも追加すること。追加を忘れると構文チェックがCIをサイレントに素通りする。
  - 複数対象を色分けして表示する UI（例: `docs/app.js` のグラフ/凡例）では、描画色とラベル色を同じ不変の識別子（例: `paletteIndex`）から導出すること。表示順や絞り込みなど、その時点で画面に出ている件数・順序から個別に色を算出すると、同じ対象の色がビューによって食い違う。

- **`cloudflare-worker/`** は cron 専用の Worker（`scheduled` ハンドラのみ。`fetch`/公開 HTTP エンドポイントは持たない — 意図的なセキュリティ特性。README の 2026-07-14 の記述を参照）。`GITHUB_TOKEN`（Worker secret。その他の設定は `wrangler.jsonc` の `vars`）を用いて GitHub Actions へ `workflow_dispatch` を POST する。cron スケジュールは GitHub workflow 側ではなく `wrangler.jsonc` にある。

- **GitHub Actions**: `check.yml` は `workflow_dispatch` 専用（`schedule` なし — 実行間隔は Worker cron が制御）で、`docs/latest.json`・`docs/history.jsonl`・`docs/index.html` の変更をリポジトリへコミットする。`ci.yml` は PR と main への push で 3 系統のテストに加え `wrangler deploy --dry-run` を実行する。

- **GitHub Pages** は `main` ブランチの `/docs` から配信する branch デプロイ（`build_type: legacy`）。`docs/` に置いたものがそのまま公開される。Actions デプロイには**していない** — 可変な画像を配信する必要がなくなったため（判断の経緯は issue #36）。`docs/ogp.png` は静的で、一度コミットしたあとは書き換えない。書き換えるとコミットのたびに blob が git 履歴へ蓄積し、到達可能であるため `git gc` では回収できない。

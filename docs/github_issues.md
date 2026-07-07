# GitHub Issue 起票内容案

## Issue 1: 1サイト向けの軽量チェック処理を実装する

```markdown
## 概要

JAIRO Cloud 上の機関リポジトリについて、まずは1サイトを対象に軽量な応答確認を行う仕組みを実装する。

当面の対象:

- JIRCAS: https://jircas.repo.nii.ac.jp/

## 目的

厳密な監視ではなく、トップページへの軽量な HTTP GET により、以下を記録できるようにする。

- 確認日時
- HTTPステータスコード
- 応答時間
- エラー種別
- 判定結果

## 実装内容

- `targets.yml` を作成する
- `scripts/check_jairo.py` を作成する
- `docs/latest.json` に最新結果を出力する
- `docs/history.jsonl` に履歴を追記する
- `requirements.txt` を作成する

## 初期判定ルール

- `OK`: HTTP 200-399 かつ 5秒未満
- `SLOW`: HTTP 200-399 かつ 5秒以上15秒未満
- `VERY_SLOW`: HTTP 200-399 かつ 15秒以上20秒未満
- `SERVER_ERROR`: HTTP 500, 502, 503, 504
- `TIMEOUT`: 20秒以内に応答なし
- `UNKNOWN`: DNSエラー、TLSエラー、その他例外

## 制約

- トップページのみ取得する
- 検索、PDF取得、OAI-PMH取得は行わない
- リトライは行わない
- User-Agent を明示する
- 異常があってもスクリプトは原則 `exit 1` しない

## 受け入れ条件

- `python scripts/check_jairo.py` で実行できる
- `docs/latest.json` が生成される
- `docs/history.jsonl` に1行追記される
- JIRCAS の HTTPステータスと応答時間が記録される
- タイムアウトや例外時も JSON 出力が壊れない
```

## Issue 2: GitHub Actionsで定期実行できるようにする

```markdown
## 概要

軽量チェック処理を GitHub Actions で定期実行できるようにする。

## 実装内容

- `.github/workflows/check.yml` を作成する
- `workflow_dispatch` による手動実行に対応する
- 15分間隔の schedule 実行に対応する
- 実行結果として `docs/latest.json` と `docs/history.jsonl` を更新する

## 方針

このチェックは情報提供を目的とするため、対象サイトが遅い・落ちている場合でも、原則として workflow は失敗扱いにしない。

## 受け入れ条件

- GitHub Actions から手動実行できる
- 実行後に `docs/latest.json` が更新される
- 実行後に `docs/history.jsonl` に履歴が追記される
- 異常判定時も workflow が不要に失敗しない
```

## Issue 3: 最新状態を表示する簡易ダッシュボードを作成する

```markdown
## 概要

`docs/latest.json` を読み込み、現在の状態を確認できる簡易ダッシュボードを作成する。

## 実装内容

- `docs/index.html` を作成する
- `docs/latest.json` を fetch して表示する
- 現在状態、最終確認日時、HTTPステータス、応答時間、判定結果を表示する
- `docs/history.jsonl` の扱いは任意。まずは latest の表示を優先する

## 表示項目

- 対象サイト名
- URL
- 最終確認日時
- HTTPステータス
- 応答時間
- 判定結果
- エラー内容

## 受け入れ条件

- ブラウザで `docs/index.html` を開くと最新状態が表示される
- `OK / SLOW / VERY_SLOW / SERVER_ERROR / TIMEOUT / UNKNOWN` が視覚的に区別できる
- `latest.json` が存在しない場合も画面が破綻しない
```

## Issue 4: 実測値を分析し、閾値を見直す

```markdown
## 概要

1から2週間程度蓄積した `docs/history.jsonl` をもとに、応答時間の閾値を見直す。

## 確認する指標

- p50
- p90
- p95
- p99
- 最大値
- TIMEOUT / SERVER_ERROR の発生回数

## 検討内容

初期閾値:

- SLOW: 5秒以上
- VERY_SLOW: 15秒以上
- TIMEOUT: 20秒

実測値を見て、JIRCAS の通常時応答に合う値へ調整する。

## 受け入れ条件

- 実測値の要約が README または docs に記録されている
- 閾値を変更する場合、その理由が記録されている
```

## Issue 5: 複数サイト比較に拡張する

```markdown
## 概要

1サイトでの測定と表示が安定した後、複数の JAIRO Cloud 利用機関を対象に追加し、横断比較できるようにする。

## 実装内容

- `targets.yml` に複数サイトを登録できる構成を維持する
- 各サイトのチェック結果を一覧表示する
- primary サイトと他サイトの状態を比較する
- 全体サマリを出力する

## 判定例

- 自機関のみ異常
- 複数機関で SERVER_ERROR / TIMEOUT
- 複数機関で SLOW / VERY_SLOW
- 全体的には正常

## 受け入れ条件

- 複数サイトを順次チェックできる
- 各サイトの結果が `latest.json` に保存される
- ダッシュボードで複数サイトの状態を一覧できる
- primary サイトと他サイトの比較メッセージが表示される
```

## Issue 6: 必要に応じて通知を追加する

```markdown
## 概要

複数サイト運用後、必要に応じて Slack / Teams 等への通知を追加する。

## 方針

初期段階では通知しない。誤通知を避けるため、単発の SLOW では通知しない。

## 通知条件案

- SERVER_ERROR または TIMEOUT が複数サイトで発生
- primary サイトが2から3回連続で SERVER_ERROR / TIMEOUT
- 監視対象の一定割合以上が SLOW / VERY_SLOW / SERVER_ERROR / TIMEOUT

## 受け入れ条件

- Webhook URL は GitHub Secrets で管理する
- 通知条件を満たした場合のみ通知される
- 通知しない場合も workflow は正常終了する
```

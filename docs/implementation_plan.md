# JAIRO Cloud Downdetector 実装計画

## 方針

最初から横断監視を完成させるのではなく、まず1サイトで測定と表示を安定させ、その後に複数サイト比較へ拡張する。

当面の対象サイト:

```text
https://jircas.repo.nii.ac.jp/
```

## Phase 1: 1サイトで測定基盤を作る

JIRCAS のトップページに対して軽量な HTTP GET を行い、最低限の測定結果を保存する。

取得項目:

- 確認日時
- 対象サイト名
- URL
- HTTPステータスコード
- 応答時間
- エラー種別
- 判定結果

初期閾値:

```text
OK         : HTTP 200-399 かつ 5秒未満
SLOW       : HTTP 200-399 かつ 5秒以上15秒未満
VERY_SLOW  : HTTP 200-399 かつ 15秒以上20秒未満
SERVER_ERROR: HTTP 500, 502, 503, 504
TIMEOUT    : 20秒以内に応答なし
UNKNOWN    : DNSエラー、TLSエラー、その他例外
```

実装対象:

- `targets.yml`
- `requirements.txt`
- `scripts/check_jairo.py`
- `docs/latest.json`
- `docs/history.jsonl`

## Phase 2: 閾値を用いた状態表示を作る

`docs/latest.json` を読み込み、GitHub Pages またはローカルHTMLで現在状態を確認できるようにする。

表示項目:

- 現在状態
- 最終確認日時
- HTTPステータス
- 応答時間
- 判定結果
- エラー内容

この段階では障害判定よりも、担当者が見て納得できる表示かを重視する。

## Phase 3: 実測値をもとに閾値を見直す

1から2週間程度の実測データを蓄積した後、応答時間の分布を確認して閾値を補正する。

確認する指標:

- p50
- p90
- p95
- p99
- 最大値
- TIMEOUT / SERVER_ERROR の発生回数

判断例:

```text
通常時の p95 が 3秒未満なら、SLOW を 5秒から3秒へ下げる余地がある。
通常時の p99 が 10秒前後なら、VERY_SLOW を15秒から10秒へ下げる余地がある。
```

ただし、最初の実装では複雑にしすぎず、固定閾値と履歴保存を優先する。

## Phase 4: 複数サイト比較へ拡張する

1サイトでの測定と表示が安定した後、比較対象サイトを追加する。

この段階で、以下のような横断判定を有効にする。

```text
自機関のみ異常
複数機関で SERVER_ERROR / TIMEOUT
複数機関で SLOW / VERY_SLOW
全体的には正常
```

最初は3から5サイト程度、その後10サイト程度へ広げる。

## Phase 5: 必要に応じて通知を追加する

通知は最初から入れない。誤通知を避けるため、実測値と運用感が固まってから追加する。

通知条件案:

- 複数サイトで SERVER_ERROR または TIMEOUT が発生
- primary サイトが2から3回連続で SERVER_ERROR または TIMEOUT
- 監視対象の一定割合以上が SLOW / VERY_SLOW / SERVER_ERROR / TIMEOUT

Webhook URL は GitHub Secrets で管理する。

## 推奨実装順

まず起票するなら Issue 1 から Issue 3 までで十分。

```text
1. 1サイト向けの軽量チェック処理を実装する
2. GitHub Actionsで定期実行できるようにする
3. 最新状態を表示する簡易ダッシュボードを作成する
```

Issue 4 以降は、1から2週間ほど実データを取ってから進める。

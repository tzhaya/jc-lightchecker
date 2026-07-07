# 実装依頼プロンプト案

## Issue 1 用プロンプト

```text
このリポジトリに、JAIRO Cloud 機関リポジトリの軽量チェック処理を実装してください。

当面は1サイトのみを対象にします。

対象:
- name: JIRCAS
- url: https://jircas.repo.nii.ac.jp/
- primary: true

作成するファイル:
- targets.yml
- requirements.txt
- scripts/check_jairo.py
- docs/latest.json は実行時生成
- docs/history.jsonl は実行時追記

要件:
- トップページへ HTTP GET する
- HTTPステータスコード、応答時間、確認日時、エラー内容を記録する
- 判定は OK / SLOW / VERY_SLOW / SERVER_ERROR / TIMEOUT / UNKNOWN
- SLOW は5秒以上、VERY_SLOW は15秒以上、TIMEOUT は20秒
- User-Agent を明示する
- 検索、PDF取得、OAI-PMH取得は行わない
- 異常があっても原則 exit 1 しない
- JSON出力が壊れないようにする

実装後、ローカルでスクリプトを実行して生成結果を確認してください。
```

## Issue 2 用プロンプト

```text
既存の `scripts/check_jairo.py` を GitHub Actions で実行できるようにしてください。

作成するファイル:
- .github/workflows/check.yml

要件:
- workflow_dispatch で手動実行できる
- 15分間隔で schedule 実行できる
- Python 3.12 を使用する
- requirements.txt の依存関係をインストールする
- `python scripts/check_jairo.py` を実行する
- `docs/latest.json` と `docs/history.jsonl` をコミット対象にする
- 対象サイトが異常でも workflow を不要に失敗させない

実装後、workflow の構文として不自然な点がないか確認してください。
```

## Issue 3 用プロンプト

```text
`docs/latest.json` を読み込んで現在状態を表示する簡易ダッシュボードを `docs/index.html` として実装してください。

要件:
- GitHub Pages でそのまま表示できる静的HTMLにする
- latest.json を fetch して表示する
- 対象サイト名、URL、最終確認日時、HTTPステータス、応答時間、判定結果、エラー内容を表示する
- 判定結果ごとに見た目を区別する
- latest.json が存在しない、または読み込めない場合も画面が破綻しない
- 過度な装飾は不要。担当者がすばやく状態を確認できる画面にする

実装後、ローカルでHTMLを開いて表示を確認してください。
```

## Issue 4 用プロンプト

```text
蓄積された `docs/history.jsonl` から応答時間の傾向を確認し、閾値見直し用の分析を追加してください。

要件:
- p50 / p90 / p95 / p99 / 最大値を確認できるようにする
- TIMEOUT / SERVER_ERROR の発生回数を確認できるようにする
- 分析用スクリプトを追加する場合は `scripts/analyze_history.py` とする
- 閾値を変更する場合は、その理由を README または docs に記録する

まずは実装を複雑にしすぎず、履歴から判断材料を得られる状態を優先してください。
```

## Issue 5 用プロンプト

```text
現在の1サイト向けチェックを、複数サイト比較に拡張してください。

要件:
- targets.yml に複数サイトを登録できる
- 各サイトを順番に軽量チェックする
- primary サイトと他サイトを区別する
- latest.json に全サイトの結果を保存する
- summary に全体判定メッセージを追加する
- ダッシュボードで複数サイトを一覧表示する

判定方針:
- primary のみ異常なら、自機関固有の可能性として表示
- 複数サイトで SERVER_ERROR / TIMEOUT があれば、広域的事象の可能性として表示
- 複数サイトで SLOW / VERY_SLOW が多ければ、広域的遅延の可能性として表示

アクセス負荷を避けるため、トップページへの1回GETのみとし、過剰なリトライや高並列化は避けてください。
```

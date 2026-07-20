# 通知先の設定

この文書では、監視結果を Slack、Microsoft Teams、Discord に送るための一般的な準備手順を説明します。

通知先が発行する **Webhook URL** は、通知を投稿できる認証情報です。

URL をソースコード、Issue、Pull Request、チャットに貼り付けてはいけません。

GitHub Actions から使う URL は、リポジトリの Actions secrets に保存します。

このリポジトリの通知実装では、異常の判定と送信条件を別途定めます。

## 共通の準備

1. 通知専用のチャンネルを作成します。
2. チャンネル名は `#agriknowledge-alert` のように、用途が分かる名前にします。
3. 通知先で Webhook を作成して URL をコピーします。
4. GitHub の `Settings`、`Secrets and variables`、`Actions` を開きます。
5. `New repository secret` を選び、サービスごとに指定された名前で URL を保存します。

Webhook URL を失効させるときは、通知先で Webhook を削除してから GitHub Secrets の値も削除または更新します。

## Slack

Slack では **Incoming Webhook** を使います。

1. Slack ワークスペースで、通知を投稿するチャンネルを作成するか選びます。
2. [Slack API のアプリ管理画面](https://api.slack.com/apps)を開き、`Create New App`、`From scratch` の順に選びます。
3. アプリ名を入力し、通知先のワークスペースを選んでアプリを作成します。
4. 左側の `Incoming Webhooks` を開き、`Activate Incoming Webhooks` を有効にします。
5. `Add New Webhook to Workspace` を選び、通知先チャンネルを選択して許可します。
6. 表示された `https://hooks.slack.com/services/...` の URL をコピーします。
7. 共通の準備の手順4から5に従い、URL を GitHub Secret `SLACK_WEBHOOK_URL` として保存します。

非公開チャンネルを選ぶときは、Webhook を作成する利用者がそのチャンネルのメンバーである必要があります。

Incoming Webhook は手順5で選んだチャンネルに投稿します。

投稿先を変えるには、別のチャンネル用に Webhook を作成します。

詳細は [Slack の Incoming Webhooks ガイド](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks)を参照してください。

## Microsoft Teams

Teams では、組織向け Microsoft 365 の **Workflows**（Power Automate）で受信 Webhook を作成する方法を使います。

1. 通知先のチームにある標準チャネルを開き、チャネル名の `…` から `Workflows` を選びます。
2. `webhook` で検索し、Webhook 要求を受信してチャネルに投稿するテンプレートを選びます。
3. 通知先のチームとチャネルを確認します。
4. GitHub Actions のような外部サービスから呼び出す場合は、呼び出し元の設定で外部からの POST を許可します。
5. Workflow を保存し、表示された Webhook URL をコピーします。
6. 共通の準備の手順4から5に従い、URL を GitHub Secret `TEAMS_WEBHOOK_URL` として保存します。
7. Workflow の共同所有者を追加します。

Workflow は作成者のアカウントに紐付くため、共同所有者を追加しないと作成者が利用できなくなったときに通知が停止するおそれがあります。

Microsoft 365 Family の Teams では、Workflows が表示されない場合があります。

日本の Family アカウントで外部 Webhook を受ける構成は安定して利用できないため、組織向け Microsoft 365 テナントを通知先にするか、Slack または Discord を選びます。

従来の Microsoft 365 Connector は廃止に向かっているため、新規の通知先には使いません。

詳細は [Microsoft Learn の Incoming Webhooks ガイド](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook)を参照してください。

## Discord

Discord では、サーバーのテキストチャンネルに **Webhook** を作成します。

1. 通知先の Discord サーバーで `Server Settings` を開き、`Integrations` を選びます。
2. `Webhooks` の `Create Webhook` を選びます。
3. Webhook の名前と通知先テキストチャンネルを設定します。
4. `Copy Webhook URL` を選び、URL をコピーします。
5. 共通の準備の手順4から5に従い、URL を GitHub Secret `DISCORD_WEBHOOK_URL` として保存します。

Webhook を作成するには、そのチャンネルで `Manage Webhooks` 権限が必要です。

Webhook URL を知る利用者は投稿できるため、漏えいした場合は Webhook を削除して作り直します。

詳細は [Discord の Webhook 解説](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks)を参照してください。

## GitHub Secrets の確認

1. GitHub の Secrets 一覧で、登録した Secret 名が表示されることを確認します。
2. 実装後は GitHub Actions を手動実行し、想定した通知先だけにテスト通知が届くことを確認します。

通知テストの結果や Webhook URL は、公開ログに出力しません。

GitHub の Secrets 一覧には値ではなく Secret 名だけが表示され、値を画面から読み戻すことはできません。

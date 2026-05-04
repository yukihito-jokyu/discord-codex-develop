# discord-codex

![Coverage](https://img.shields.io/badge/dynamic/json?color=brightgreen&label=coverage&query=%24.total.lines.pct&url=https%3A%2F%2Fyukihito-jokyu.github.io%2Fdiscord-codex%2Fcoverage-summary.json)

## 環境構築

### 前提条件

以下がインストールされていること：

- [Nix](https://nixos.org/download/) (2.4以上)
- [direnv](https://direnv.net/)

### 1. Nix Flakesの有効化

`~/.config/nix/nix.conf`を作成（または編集）し、以下を追加します：

```
experimental-features = nix-command flakes
```

すでに設定済みの場合は不要です。以下のコマンドで確認できます：

```bash
nix flake --help
```

### 2. シェルフックの設定

`~/.zshrc`に以下を追加します：

```zsh
eval "$(direnv hook zsh)"
```

追加後、ターミナルを開き直すか `source ~/.zshrc` を実行してください。

### 3. リポジトリのクローン

```bash
git clone https://github.com/yukihito-jokyu/discord-codex.git
cd discord-codex
```

### 4. direnvの許可

```bash
direnv allow
```

`use flake` と `dotenv` が実行され、開発環境が自動で構築されます。
初回はNixのパッケージダウンロードが行われるため時間がかかります。

### 5. 環境変数の設定

```bash
cp .env.example .env
```

`.env`に必要な環境変数を記述してください。

### 動作確認

```bash
node --version   # v22.x.x
pnpm --version   # 10.x.x
task --version   # 3.x.x
```

## Discord Botの設定

### 1. Discordアプリケーションの作成

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセスし、「New Application」をクリック
2. アプリケーション名を入力して作成

### 2. 認証情報の取得

**General Information** ページで以下を取得し、`.env`に設定:

| 項目 | 取得先 | 環境変数 |
| --- | --- | --- |
| APPLICATION ID | General Information | `DISCORD_APPLICATION_ID` |
| PUBLIC KEY | General Information | `DISCORD_PUBLIC_KEY` |

**Bot** ページで「Reset Token」をクリックし、Bot Tokenを取得:

| 項目 | 取得先 | 環境変数 |
| --- | --- | --- |
| Bot Token | Bot ページ | `DISCORD_BOT_TOKEN` |

### 3. Gateway Intentsの有効化

**Bot** ページの Privileged Gateway Intents で **Message Content Intent** のみ有効にする。
Presence Intent と Server Members Intent は不要。

### 4. Botをサーバーに追加

**Installation** ページ（または **OAuth2** ページ）でURL生成を行う:

- スコープ: `bot`, `applications.commands`
- Bot Permissions:
  - View Channels
  - Send Messages
  - Send Messages in Threads
  - Create Public Threads
  - Read Message History

生成されたURLからBotをサーバーに追加する。

### 5. サーバーIDの取得

Discordのユーザー設定で「開発者モード」を有効にし、Botを追加したサーバーを右クリックしてIDをコピー。
`DISCORD_GUILD_ID` に設定する。

### 6. Interactions Endpoint URLの設定

**General Information** ページの `INTERACTIONS ENDPOINT URL` にトンネルURLを設定:

```
https://your-tunnel-domain.com/api/webhooks/discord
```

保存時にDiscordが署名検証リクエストを送信するため、事前にサーバーとトンネルを起動しておく必要がある。

### 環境変数一覧

| 環境変数 | 説明 | 必須 |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | Bot認証トークン | ✅ |
| `DISCORD_APPLICATION_ID` | アプリケーションID | ✅ |
| `DISCORD_PUBLIC_KEY` | Ed25519公開鍵（Webhook署名検証用） | ✅ |
| `DISCORD_GUILD_ID` | サーバーID（スラッシュコマンド登録先） | ✅ |
| `OPENAI_API_KEY` | OpenAI APIキー（`CODEX_API_KEY`未設定時のフォールバック） | ✅ |
| `CODEX_API_KEY` | Codex APIキー（`OPENAI_API_KEY`より優先） | - |
| `CODEX_BASE_URL` | Codex APIのエンドポイント（デフォルト: OpenAI） | - |
| `CODEX_MODEL` | 使用モデル名（デフォルト: `codex-mini`） | - |
| `TUNNEL_TOKEN` | Cloudflare Tunnelトークン（ローカル開発時） | - |
| `REDIS_URL` | Redis接続URL（デフォルト: `redis://localhost:6379`） | - |

## 起動方法

### 開発（Taskfile）

```bash
# 全サービス起動（Redis + Cloudflared + Bot）
task services:up

# 全サービス停止
task services:down

# 個別起動
task start          # Bot（ビルド付き）
task redis:start    # Redis
task tunnel:start   # Cloudflared

# 個別停止
task stop
task redis:stop
task tunnel:stop

# ログ確認
task logs           # 全サービス
task logs:bot       # Botのみ
```

### 本番（launchd）

```bash
# サービスのインストール（自動起動有効）
task services:install

# サービスのアンインストール
task services:uninstall

# ステータス確認
launchctl list | grep com.discord-codex
```

### Docker

```bash
task docker:up      # コンテナ起動
task docker:down    # コンテナ停止
task docker:logs    # ログ確認
```

## PR Agent

PRのコメント欄で以下のコマンドを入力すると、AIが自動で処理します。

| コマンド      | 説明                                                                     |
| ------------- | ------------------------------------------------------------------------ |
| `/review`     | コードレビューを実施し、バグ・セキュリティ・パフォーマンス等の問題を指摘 |
| `/describe`   | PRのタイトル・サマリー・変更内容を自動生成                               |
| `/improve`    | コードの改善提案（可読性・効率・ベストプラクティスの観点）               |
| `/ask "質問"` | PRのコードに対して自由に質問                                             |

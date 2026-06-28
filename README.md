<a href="https://livekit.io/">
  <img src="./.github/assets/livekit-mark.png" alt="LiveKit logo" width="100" height="100">
</a>

<h1> demo link : https://drive.google.com/drive/folders/12WOloYC8y_OeGMI23n-JC70lgMU1C3N8?usp=drive_link</h1>
#Guide To Start Livekit agents for Talk To Founder Application
## the agents in this work flow are
Husain- Represents the founder himself
Sara- Represents the Scheduling agent of Maneuver
System- Represents the Default system of Maneuver

#OUTPUT PROVIDDED
leads.json
email to Client and Founder himself containing:
  1) Summary of Conversation
  2) Details of client like company name, budget, timeline etc
  3) details of scheduled follow-up call



# LiveKit Agents Starter - Python

A complete starter project for building voice AI apps with [LiveKit Agents for Python](https://github.com/livekit/agents) and [LiveKit Cloud](https://cloud.livekit.io/).

The starter project includes:

- A simple voice AI assistant, ready for extension and customization
- A voice AI pipeline built on [LiveKit Inference](https://docs.livekit.io/agents/models/inference)
  with [models](https://docs.livekit.io/agents/models) from OpenAI, Cartesia, and Deepgram. More than 50 other model providers are supported, including [Realtime models](https://docs.livekit.io/agents/models/realtime)
- Eval suite based on the LiveKit Agents [testing & evaluation framework](https://docs.livekit.io/agents/start/testing/)
- [LiveKit Turn Detector](https://docs.livekit.io/agents/logic/turns/turn-detector/) for contextually-aware speaker detection, with multilingual support
- [Background voice cancellation](https://docs.livekit.io/transport/media/noise-cancellation/)
- Deep session insights from LiveKit [Agent Observability](https://docs.livekit.io/deploy/observability/)
- A Dockerfile ready for [production deployment to LiveKit Cloud](https://docs.livekit.io/deploy/agents/)

This starter app is compatible with any [custom web/mobile frontend](https://docs.livekit.io/frontends/) or [telephony](https://docs.livekit.io/telephony/).

## Talk-to-Founder LiveKit (Maneuver) — Clone & Run

Repository: [`talk-to-founder-livekit`](https://github.com/CRAFTYPROGRAMMER826/talk-to-founder-livekit)

Clone (choose one):

- HTTPS: `git clone https://github.com/CRAFTYPROGRAMMER826/talk-to-founder-livekit.git`
- SSH: `git clone git@github.com:CRAFTYPROGRAMMER826/talk-to-founder-livekit.git`
- GitHub CLI: `gh repo clone CRAFTYPROGRAMMER826/talk-to-founder-livekit`

### Backend prerequisites

- Ollama running locally (for Qwen models)
- Deepgram API key (STT/TTS)
- Gmail credentials (Gmail App Password)
- LiveKit credentials

### Environment variables

1. `maneuver/.env.local` (copy from `maneuver/.env.example`)
   - `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
   - `DEEPGRAM_API_KEY`
   - `GMAIL_USER`, `GMAIL_APP_PASSWORD`
   - `OLLAMA_BASE_URL`, `OLLAMA_MODEL_HUSAIN`, `OLLAMA_MODEL_SARA`

### Install dependencies

Backend:

```bash
cd maneuver
uv sync
```

Frontend:

```bash
cd my-agent-app
pnpm install
```

### Start everything (local-only)

1. Start Ollama (separate terminal):

```bash
ollama serve
```

2. Start LiveKit agent backend:

```bash
cd maneuver
uv run python src/agent.py dev
```

3. Start React UI:

```bash
cd my-agent-app
pnpm dev
```

Open the frontend, speak into the microphone, and the flow should go:
Husain (discovery) → Sara (scheduling) → System (wrap-up + email if the form was submitted).

## Using coding agents

This project is designed to work with coding agents like [Claude Code](https://claude.com/product/claude-code), [Cursor](https://www.cursor.com/), and [Codex](https://openai.com/codex/).

For your convenience, LiveKit offers both a CLI and an [MCP server](https://docs.livekit.io/reference/developer-tools/docs-mcp/) that can be used to browse and search its documentation. The [LiveKit CLI](https://docs.livekit.io/intro/basics/cli/) (`lk docs`) works with any coding agent that can run shell commands. Install it for your platform:

**macOS:**

```console
brew install livekit-cli
```

**Linux:**

```console
curl -sSL https://get.livekit.io/cli | bash
```

**Windows:**

```console
winget install LiveKit.LiveKitCLI
```

The `lk docs` subcommand requires version 2.15.0 or higher. Check your version with `lk --version` and update if needed. Once installed, your coding agent can search and browse LiveKit documentation directly from the terminal:

```console
lk docs search "voice agents"
lk docs get-page /agents/start/voice-ai-quickstart
```

See the [Using coding agents](https://docs.livekit.io/intro/coding-agents/) guide for more details, including MCP server setup.

The project includes a complete [AGENTS.md](AGENTS.md) file for these assistants. You can modify this file to suit your needs. To learn more about this file, see [https://agents.md](https://agents.md).

## Dev Setup

Create a project from this template with the LiveKit CLI (recommended):

```bash
lk cloud auth
lk agent init my-agent --template agent-starter-python
```

The CLI clones the template and configures your environment. Then follow the rest of this guide from [Run the agent](#run-the-agent).

<details>
<summary>Alternative: Manual setup without the CLI</summary>

Clone the repository and install dependencies to a virtual environment:

### Building the React Frontend using pnpm

```console
pnpm create vite@latest my-agent-app --template react-ts
cd my-agent-app
```

###install packages
```
pnpm add @livekit/components-react @livekit/components-styles livekit-client
```


### Building the agentic workflow
```console
cd agent-starter-python
uv sync
```

Sign up for [LiveKit Cloud](https://cloud.livekit.io/) then set up the environment by copying `.env.example` to `.env.local` and filling in the required keys:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

You can load the LiveKit environment automatically using the [LiveKit CLI](https://docs.livekit.io/intro/basics/cli/):

```bash
lk cloud auth
lk app env -w -d .env.local
```

</details>

## Run the agent

Before your first run, you must download certain models such as [Silero VAD](https://docs.livekit.io/agents/logic/turns/vad/) and the [LiveKit turn detector](https://docs.livekit.io/agents/logic/turns/turn-detector/):

```console
uv run python src/agent.py download-files
```

Next, run this command to speak to your agent directly in your terminal:

```console
uv run python src/agent.py console
```

To run the agent for use with a frontend or telephony, use the `dev` command:

```console
uv run python src/agent.py dev
```
Agent Can be interacted with on the frontend server, when using the `dev` command:
simply open another terminal window and run 

```console
cd livekit/my-agent-app
pnpm run dev 
```
or
if using npm
```console
npm run dev
```

```console
 run python src/agent.py dev
```

In production, use the `start` command:

```console
uv run python src/agent.py start
```


## Build the Frontend

### with npm
```console
cd livekit
npm create vite@latest my-agent-app -- --template react-ts
cd my-agent-app
```

### with pnpm
```console
cd livekit
pnpm create vite@latest my-agent-app --template react-ts
cd my-agent-app
```

### Install packages
## with npm
```console
npm install @livekit/components-react @livekit/components-styles livekit-client --save
```

## with pnpm
```console
pnpm add @livekit/components-react @livekit/components-styles livekit-client
```
## Frontend & Telephony

Get started quickly with our pre-built frontend starter apps, or add telephony support:

| Platform | Link | Description |
|----------|----------|-------------|
| **Web** | [`livekit-examples/agent-starter-react`](https://github.com/livekit-examples/agent-starter-react) | Web voice AI assistant with React & Next.js |
| **iOS/macOS** | [`livekit-examples/agent-starter-swift`](https://github.com/livekit-examples/agent-starter-swift) | Native iOS, macOS, and visionOS voice AI assistant |
| **Flutter** | [`livekit-examples/agent-starter-flutter`](https://github.com/livekit-examples/agent-starter-flutter) | Cross-platform voice AI assistant app |
| **React Native** | [`livekit-examples/voice-assistant-react-native`](https://github.com/livekit-examples/voice-assistant-react-native) | Native mobile app with React Native & Expo |
| **Android** | [`livekit-examples/agent-starter-android`](https://github.com/livekit-examples/agent-starter-android) | Native Android app with Kotlin & Jetpack Compose |
| **Web Embed** | [`livekit-examples/agent-starter-embed`](https://github.com/livekit-examples/agent-starter-embed) | Voice AI widget for any website |
| **Telephony** | [Documentation](https://docs.livekit.io/telephony/) | Add inbound or outbound calling to your agent |

For advanced customization, see the [complete frontend guide](https://docs.livekit.io/frontends/).

## Tests and evals

This project includes a complete suite of evals, based on the LiveKit Agents [testing & evaluation framework](https://docs.livekit.io/agents/start/testing/). To run them, use `pytest`.

```console
uv run pytest
```

## Using this template repo for your own project

Once you've started your own project based on this repo, you should:

1. **Check in your `uv.lock`**: This file is currently untracked for the template, but you should commit it to your repository for reproducible builds and proper configuration management. (The same applies to `livekit.toml`, if you run your agents in LiveKit Cloud)

2. **Remove the git tracking test**: Delete the "Check files not tracked in git" step from `.github/workflows/tests.yml` since you'll now want this file to be tracked. These are just there for development purposes in the template repo itself.

3. **Add your own repository secrets**: You must [add secrets](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-what-your-workflow-does/using-secrets-in-github-actions) for `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` so that the tests can run in CI.

## Deploying to production

This project is production-ready and includes a working `Dockerfile`. To deploy it to LiveKit Cloud or another environment, see the [deploying to production](https://docs.livekit.io/deploy/agents/) guide.

## Self-hosted LiveKit

You can also self-host LiveKit instead of using LiveKit Cloud. See the [self-hosting](https://docs.livekit.io/transport/self-hosting/local/) guide for more information. If you choose to self-host, you'll need to also use [model plugins](https://docs.livekit.io/agents/models/#plugins) instead of LiveKit Inference and will need to remove the [LiveKit Cloud noise cancellation](https://docs.livekit.io/transport/media/noise-cancellation/) plugin.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

export interface AssistantBuildSource {
  repository: string;
  docs?: string;
  website?: string;
  license?: string;
  installReference: string;
}

export interface AssistantBuildSetup {
  prerequisites: string[];
  installCommands: string[];
  configureCommands: string[];
  startCommands: string[];
  configFiles: string[];
  ports: number[];
  healthCheckPath: string;
}

export interface AssistantBuildDefaults {
  model: string;
  tools: string[];
  runtimeImage: string;
  requiredSecrets: string[];
}

export interface AssistantBuildDefinition {
  slug: string;
  name: string;
  description: string;
  defaultVersion: string;
  language: string;
  maturity: "stable" | "active" | "experimental";
  source: AssistantBuildSource;
  setup: AssistantBuildSetup;
  defaults: AssistantBuildDefaults;
  recommendedWrapper: string;
  supportedWrappers: string[];
  tags: string[];
}

export interface SecurityWrapperDefinition {
  slug: string;
  name: string;
  description: string;
  source: {
    repository?: string;
    docs?: string;
    website?: string;
    license?: string;
  };
  isolation: string[];
  defaults: {
    runtimeProvider: "docker-local" | "managed-sandbox";
    networkPolicy: "deny-by-default" | "restricted-egress" | "developer-egress";
    filesystem: "read-only-root" | "workspace-read-write" | "host-limited";
    secrets: "brokered" | "environment" | "none";
    audit: "full" | "basic";
  };
}

export const CATALOG_VERIFIED_AT = "2026-05-27";

const STANDARD_WRAPPERS = [
  "nemoclaw",
  "nono",
  "rootless-docker",
  "gvisor",
  "bubblewrap",
];

export const SECURITY_WRAPPERS: SecurityWrapperDefinition[] = [
  {
    slug: "nemoclaw",
    name: "NemoClaw",
    description:
      "Security wrapper for OpenClaw-style assistants with sandboxed execution, policy-driven egress, brokered secrets, and runtime audit evidence.",
    source: {
      repository: "https://github.com/NVIDIA/NemoClaw",
      docs: "https://docs.nvidia.com/nemoclaw/0.0.15/about/overview.html",
      website: "https://www.nvidia.com/en-au/ai/nemoclaw/",
      license: "Open source",
    },
    isolation: [
      "OpenShell sandbox",
      "policy-based network egress",
      "brokered secrets",
      "runtime audit stream",
    ],
    defaults: {
      runtimeProvider: "managed-sandbox",
      networkPolicy: "deny-by-default",
      filesystem: "workspace-read-write",
      secrets: "brokered",
      audit: "full",
    },
  },
  {
    slug: "nono",
    name: "nono",
    description:
      "Open source secure shell wrapper for agents that uses OS isolation primitives to reduce host access.",
    source: {
      website: "https://nono.sh/",
      docs: "https://www.nono.sh/",
      license: "Open source",
    },
    isolation: [
      "kernel-backed process isolation",
      "scoped shell execution",
      "explicit workspace mounts",
    ],
    defaults: {
      runtimeProvider: "docker-local",
      networkPolicy: "restricted-egress",
      filesystem: "workspace-read-write",
      secrets: "brokered",
      audit: "full",
    },
  },
  {
    slug: "rootless-docker",
    name: "Rootless Docker",
    description:
      "Docker runtime profile that avoids root daemon privileges for agent containers.",
    source: {
      docs: "https://docs.docker.com/engine/security/rootless/",
      license: "Apache-2.0",
    },
    isolation: [
      "rootless container runtime",
      "container network namespace",
      "container filesystem boundary",
    ],
    defaults: {
      runtimeProvider: "docker-local",
      networkPolicy: "developer-egress",
      filesystem: "workspace-read-write",
      secrets: "environment",
      audit: "basic",
    },
  },
  {
    slug: "gvisor",
    name: "gVisor",
    description:
      "Application kernel sandbox profile for containers that need stronger syscall isolation.",
    source: {
      repository: "https://github.com/google/gvisor",
      docs: "https://gvisor.dev/docs/",
      license: "Apache-2.0",
    },
    isolation: [
      "userspace kernel boundary",
      "container syscall filtering",
      "runtime network controls",
    ],
    defaults: {
      runtimeProvider: "docker-local",
      networkPolicy: "restricted-egress",
      filesystem: "read-only-root",
      secrets: "brokered",
      audit: "full",
    },
  },
  {
    slug: "bubblewrap",
    name: "Bubblewrap",
    description:
      "Minimal Linux sandbox profile for command-line assistants and lightweight local builds.",
    source: {
      repository: "https://github.com/containers/bubblewrap",
      license: "LGPL-2.0-or-later",
    },
    isolation: [
      "Linux namespace sandbox",
      "explicit bind mounts",
      "limited process view",
    ],
    defaults: {
      runtimeProvider: "docker-local",
      networkPolicy: "restricted-egress",
      filesystem: "workspace-read-write",
      secrets: "environment",
      audit: "basic",
    },
  },
];

export const ASSISTANT_BUILDS: AssistantBuildDefinition[] = [
  {
    slug: "hermes",
    name: "Hermes Agent",
    description:
      "Nous Research self-improving CLI assistant with voice and tool workflow support.",
    defaultVersion: "source-main",
    language: "TypeScript/Python",
    maturity: "active",
    source: {
      repository: "https://github.com/NousResearch/hermes-agent",
      docs: "https://hermes-agent.nousresearch.com/docs/ko/",
      website: "https://nousresearch.com/hermes-agent/",
      license: "Open source",
      installReference:
        "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash",
    },
    setup: {
      prerequisites: ["git", "Python 3.11+", "Node.js 22+", "ffmpeg"],
      installCommands: [
        "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash",
      ],
      configureCommands: ["hermes setup"],
      startCommands: ["hermes daemon --host 0.0.0.0 --port 8080"],
      configFiles: [".env", "AGENTS.md", "TOOLS.md", "SOUL.md"],
      ports: [8080],
      healthCheckPath: "/healthz",
    },
    defaults: {
      model: "hermes-default",
      tools: ["shell", "files", "web", "voice"],
      runtimeImage: "node:22-bookworm",
      requiredSecrets: ["LLM_API_KEY"],
    },
    recommendedWrapper: "nemoclaw",
    supportedWrappers: STANDARD_WRAPPERS,
    tags: ["cli", "voice", "self-improving"],
  },
  {
    slug: "qwenpaw",
    name: "QwenPaw",
    description:
      "Qwen ecosystem personal assistant for local or cloud deployment with chat-app channels.",
    defaultVersion: "source-main",
    language: "Python",
    maturity: "active",
    source: {
      repository: "https://github.com/agentscope-ai/QwenPaw",
      license: "Open source",
      installReference:
        "git clone https://github.com/agentscope-ai/QwenPaw.git",
    },
    setup: {
      prerequisites: ["git", "Python 3.11+", "uv or pip", "Qwen provider credentials"],
      installCommands: [
        "git clone https://github.com/agentscope-ai/QwenPaw.git",
        "cd QwenPaw && ./install.sh",
      ],
      configureCommands: ["qwenpaw onboard --provider qwen"],
      startCommands: ["qwenpaw serve --host 0.0.0.0 --port 8080"],
      configFiles: [".env", "config/providers.yaml", "config/channels.yaml"],
      ports: [8080],
      healthCheckPath: "/healthz",
    },
    defaults: {
      model: "qwen-plus",
      tools: ["chat-apps", "files", "web", "workflow"],
      runtimeImage: "python:3.12-slim",
      requiredSecrets: ["QWEN_API_KEY"],
    },
    recommendedWrapper: "nemoclaw",
    supportedWrappers: STANDARD_WRAPPERS,
    tags: ["qwen", "channels", "local"],
  },
  {
    slug: "openclaw",
    name: "OpenClaw",
    description:
      "Open source personal assistant platform for messaging, tools, skills, local execution, and memory.",
    defaultVersion: "source-main",
    language: "TypeScript",
    maturity: "stable",
    source: {
      repository: "https://github.com/openclaw/openclaw",
      docs: "https://openclawdoc.com/",
      website: "https://openclaw.ai/",
      license: "MIT",
      installReference:
        "npm install -g openclaw@latest && openclaw onboard --install-daemon",
    },
    setup: {
      prerequisites: ["git", "Node.js 22+", "pnpm", "LLM provider credentials"],
      installCommands: [
        "npm install -g openclaw@latest",
        "openclaw onboard --install-daemon",
      ],
      configureCommands: ["openclaw config set gateway.host 0.0.0.0"],
      startCommands: ["openclaw gateway --host 0.0.0.0 --port 18789"],
      configFiles: [".env", "SOUL.md", "AGENTS.md", "TOOLS.md", "memory/"],
      ports: [18789],
      healthCheckPath: "/healthz",
    },
    defaults: {
      model: "gpt-5.2",
      tools: ["messaging", "shell", "files", "browser", "calendar"],
      runtimeImage: "node:22-bookworm",
      requiredSecrets: ["LLM_API_KEY"],
    },
    recommendedWrapper: "nemoclaw",
    supportedWrappers: STANDARD_WRAPPERS,
    tags: ["messaging", "skills", "memory"],
  },
  {
    slug: "leon",
    name: "Leon",
    description:
      "Open source personal assistant focused on tools, context, memory, and agentic execution.",
    defaultVersion: "source-main",
    language: "TypeScript/Python",
    maturity: "stable",
    source: {
      repository: "https://github.com/leon-ai/leon",
      license: "MIT",
      installReference: "git clone https://github.com/leon-ai/leon.git",
    },
    setup: {
      prerequisites: ["git", "Node.js 22+", "Python 3.11+", "pnpm"],
      installCommands: [
        "git clone https://github.com/leon-ai/leon.git",
        "cd leon && pnpm install",
      ],
      configureCommands: ["pnpm run setup"],
      startCommands: ["pnpm run start --host 0.0.0.0 --port 8080"],
      configFiles: [".env", "server/src/core/config", "skills/"],
      ports: [8080],
      healthCheckPath: "/healthz",
    },
    defaults: {
      model: "local-or-provider",
      tools: ["voice", "skills", "memory", "automation"],
      runtimeImage: "node:22-bookworm",
      requiredSecrets: ["LLM_API_KEY"],
    },
    recommendedWrapper: "rootless-docker",
    supportedWrappers: STANDARD_WRAPPERS,
    tags: ["voice", "offline", "skills"],
  },
  {
    slug: "openhuman",
    name: "OpenHuman",
    description:
      "Personal AI assistant with memory, voice, third-party integrations, and coder tools.",
    defaultVersion: "source-main",
    language: "TypeScript",
    maturity: "active",
    source: {
      repository: "https://github.com/tinyhumansai/openhuman",
      docs: "https://www.openhuman.dev/",
      license: "Open source",
      installReference: "git clone https://github.com/tinyhumansai/openhuman.git",
    },
    setup: {
      prerequisites: ["git", "Node.js 22+", "pnpm", "OAuth app credentials"],
      installCommands: [
        "git clone https://github.com/tinyhumansai/openhuman.git",
        "cd openhuman && pnpm install",
      ],
      configureCommands: ["pnpm run setup"],
      startCommands: ["pnpm run start -- --host 0.0.0.0 --port 8080"],
      configFiles: [".env", "config/integrations.json", "memory/"],
      ports: [8080],
      healthCheckPath: "/healthz",
    },
    defaults: {
      model: "gpt-5.2",
      tools: ["gmail", "notion", "github", "slack", "calendar", "coder"],
      runtimeImage: "node:22-bookworm",
      requiredSecrets: ["LLM_API_KEY", "OAUTH_CLIENT_SECRET"],
    },
    recommendedWrapper: "nemoclaw",
    supportedWrappers: STANDARD_WRAPPERS,
    tags: ["memory", "voice", "integrations"],
  },
  {
    slug: "trustclaw",
    name: "TrustClaw",
    description:
      "Composio-oriented personal assistant with OAuth-backed tool access and sandboxed execution.",
    defaultVersion: "source-main",
    language: "TypeScript",
    maturity: "active",
    source: {
      repository: "https://github.com/ComposioHQ/trustclaw",
      website: "https://www.trustclaw.app/",
      license: "Open source",
      installReference: "git clone https://github.com/ComposioHQ/trustclaw.git",
    },
    setup: {
      prerequisites: ["git", "Node.js 22+", "pnpm", "Composio credentials"],
      installCommands: [
        "git clone https://github.com/ComposioHQ/trustclaw.git",
        "cd trustclaw && pnpm install",
      ],
      configureCommands: ["pnpm run setup"],
      startCommands: ["pnpm run start -- --host 0.0.0.0 --port 8080"],
      configFiles: [".env", "config/tools.json", "config/oauth.json"],
      ports: [8080],
      healthCheckPath: "/healthz",
    },
    defaults: {
      model: "gpt-5.2",
      tools: ["composio", "oauth", "files", "web", "messaging"],
      runtimeImage: "node:22-bookworm",
      requiredSecrets: ["COMPOSIO_API_KEY", "LLM_API_KEY"],
    },
    recommendedWrapper: "nemoclaw",
    supportedWrappers: STANDARD_WRAPPERS,
    tags: ["oauth", "tools", "security"],
  },
  {
    slug: "picoclaw",
    name: "PicoClaw",
    description:
      "Lightweight Go assistant for edge, Raspberry Pi, CLI, and chat-app deployments.",
    defaultVersion: "source-main",
    language: "Go",
    maturity: "active",
    source: {
      repository: "https://github.com/sipeed/picoclaw",
      website: "https://picoclawai.com/",
      license: "Open source",
      installReference: "git clone https://github.com/sipeed/picoclaw",
    },
    setup: {
      prerequisites: ["git", "Go 1.23+", "LLM provider credentials"],
      installCommands: [
        "git clone https://github.com/sipeed/picoclaw",
        "cd picoclaw && go build ./cmd/picoclaw",
      ],
      configureCommands: ["./picoclaw onboard --provider openrouter"],
      startCommands: ["./picoclaw gateway --host 0.0.0.0 --port 8080"],
      configFiles: [".env", "picoclaw.yaml", "providers.yaml"],
      ports: [8080],
      healthCheckPath: "/healthz",
    },
    defaults: {
      model: "qwen-plus",
      tools: ["cli", "discord", "telegram", "files"],
      runtimeImage: "golang:1.24-alpine",
      requiredSecrets: ["LLM_API_KEY"],
    },
    recommendedWrapper: "bubblewrap",
    supportedWrappers: STANDARD_WRAPPERS,
    tags: ["go", "edge", "lightweight"],
  },
  {
    slug: "nanobot",
    name: "NanoBot",
    description:
      "Ultra-lightweight personal AI agent for market analysis, routines, knowledge, and coding workflows.",
    defaultVersion: "source-main",
    language: "Python",
    maturity: "active",
    source: {
      repository: "https://github.com/HKUDS/nanobot",
      license: "Open source",
      installReference: "git clone https://github.com/HKUDS/nanobot",
    },
    setup: {
      prerequisites: ["git", "Python 3.11+", "pip or uv", "LLM provider credentials"],
      installCommands: [
        "git clone https://github.com/HKUDS/nanobot",
        "cd nanobot && pip install -e .",
      ],
      configureCommands: ["nanobot configure --provider openrouter"],
      startCommands: ["nanobot serve --host 0.0.0.0 --port 8080"],
      configFiles: [".env", "nanobot.yaml", "memory/"],
      ports: [8080],
      healthCheckPath: "/healthz",
    },
    defaults: {
      model: "gpt-5.2-mini",
      tools: ["knowledge", "market", "calendar", "coder"],
      runtimeImage: "python:3.12-slim",
      requiredSecrets: ["LLM_API_KEY"],
    },
    recommendedWrapper: "bubblewrap",
    supportedWrappers: STANDARD_WRAPPERS,
    tags: ["python", "lightweight", "knowledge"],
  },
  {
    slug: "memu-bot",
    name: "memU Bot",
    description:
      "Memory-first proactive assistant built around the memU open source memory layer.",
    defaultVersion: "source-main",
    language: "Python/TypeScript",
    maturity: "active",
    source: {
      repository: "https://github.com/NevaMind-AI/memUBot",
      docs: "https://memu.help/",
      license: "Open source",
      installReference: "git clone https://github.com/NevaMind-AI/memUBot",
    },
    setup: {
      prerequisites: ["git", "Docker", "LLM provider credentials"],
      installCommands: [
        "git clone https://github.com/NevaMind-AI/memUBot",
        "cd memUBot && docker compose pull",
      ],
      configureCommands: ["cp .env.example .env"],
      startCommands: ["docker compose up -d"],
      configFiles: [".env", "config/memory.yaml", "config/channels.yaml"],
      ports: [8080],
      healthCheckPath: "/healthz",
    },
    defaults: {
      model: "gpt-5.2",
      tools: ["memory", "telegram", "discord", "slack", "feishu"],
      runtimeImage: "python:3.12-slim",
      requiredSecrets: ["LLM_API_KEY", "MEMU_STORE_KEY"],
    },
    recommendedWrapper: "nemoclaw",
    supportedWrappers: STANDARD_WRAPPERS,
    tags: ["memory", "proactive", "team"],
  },
  {
    slug: "9router",
    name: "9Router",
    description:
      "OpenAI-compatible local routing gateway for Codex, Claude Code, Cursor, and multi-provider fallback.",
    defaultVersion: "source-main",
    language: "TypeScript",
    maturity: "active",
    source: {
      repository: "https://github.com/decolua/9router",
      docs: "https://github.com/decolua/9router/blob/master/docs/ARCHITECTURE.md",
      website: "https://9router.com/",
      license: "MIT",
      installReference: "git clone https://github.com/decolua/9router",
    },
    setup: {
      prerequisites: ["git", "Node.js 22+", "pnpm", "provider credentials"],
      installCommands: [
        "git clone https://github.com/decolua/9router",
        "cd 9router && pnpm install",
      ],
      configureCommands: ["pnpm run setup"],
      startCommands: ["pnpm run start -- --host 0.0.0.0 --port 20128"],
      configFiles: [".env", "data/routes.json", "data/providers.json"],
      ports: [20128],
      healthCheckPath: "/v1/models",
    },
    defaults: {
      model: "auto-router",
      tools: ["openai-compatible-api", "fallback-routing", "provider-oauth"],
      runtimeImage: "node:22-bookworm",
      requiredSecrets: ["ROUTER_ADMIN_KEY"],
    },
    recommendedWrapper: "gvisor",
    supportedWrappers: STANDARD_WRAPPERS,
    tags: ["router", "gateway", "fallback"],
  },
  {
    slug: "cheetahclaws",
    name: "CheetahClaws",
    description:
      "Python-native personal assistant harness inspired by OpenClaw and Claude Code.",
    defaultVersion: "source-main",
    language: "Python",
    maturity: "active",
    source: {
      repository: "https://github.com/SafeRL-Lab/cheetahclaws",
      license: "Open source",
      installReference: "git clone https://github.com/SafeRL-Lab/cheetahclaws",
    },
    setup: {
      prerequisites: ["git", "Python 3.11+", "pip or uv", "LLM provider credentials"],
      installCommands: [
        "git clone https://github.com/SafeRL-Lab/cheetahclaws",
        "cd cheetahclaws && pip install -e .",
      ],
      configureCommands: ["cheetahclaws configure --provider openrouter"],
      startCommands: ["cheetahclaws serve --host 0.0.0.0 --port 8080"],
      configFiles: [".env", "cheetahclaws.yaml", "workspaces/"],
      ports: [8080],
      healthCheckPath: "/healthz",
    },
    defaults: {
      model: "gpt-5.2",
      tools: ["coder", "trading", "monitoring", "notifications"],
      runtimeImage: "python:3.12-slim",
      requiredSecrets: ["LLM_API_KEY"],
    },
    recommendedWrapper: "gvisor",
    supportedWrappers: STANDARD_WRAPPERS,
    tags: ["python", "harness", "automation"],
  },
  {
    slug: "zeroclaw",
    name: "ZeroClaw",
    description:
      "Rust-native lightweight autonomous personal assistant infrastructure.",
    defaultVersion: "source-main",
    language: "Rust",
    maturity: "active",
    source: {
      repository: "https://github.com/zeroclaw-labs/zeroclaw",
      docs: "https://github.com/zeroclaw-labs/zeroclaw/wiki/01-Overview",
      website: "https://www.zeroclaw.tech/",
      license: "Open source",
      installReference:
        "git clone https://github.com/zeroclaw-labs/zeroclaw.git",
    },
    setup: {
      prerequisites: ["git", "Rust stable", "LLM provider credentials"],
      installCommands: [
        "git clone https://github.com/zeroclaw-labs/zeroclaw.git",
        "cd zeroclaw && ./install.sh --source --features agent-runtime",
      ],
      configureCommands: ["zeroclaw onboard --provider openrouter"],
      startCommands: ["zeroclaw serve --host 0.0.0.0 --port 8080"],
      configFiles: [".env", "zeroclaw.toml", "policies/"],
      ports: [8080],
      healthCheckPath: "/healthz",
    },
    defaults: {
      model: "gpt-5.2-mini",
      tools: ["webhook", "discord", "files", "hardware"],
      runtimeImage: "rust:1.86-bookworm",
      requiredSecrets: ["LLM_API_KEY"],
    },
    recommendedWrapper: "gvisor",
    supportedWrappers: STANDARD_WRAPPERS,
    tags: ["rust", "lightweight", "webhooks"],
  },
];

export function findAssistantBuild(slug: string) {
  return ASSISTANT_BUILDS.find((build) => build.slug === slug);
}

export function findSecurityWrapper(slug: string) {
  return SECURITY_WRAPPERS.find((wrapper) => wrapper.slug === slug);
}

export function createAssistantBuildManifest({
  build,
  wrapper,
}: {
  build: AssistantBuildDefinition;
  wrapper: SecurityWrapperDefinition;
}) {
  return {
    type: "personal-assistant-agent",
    configSchemaVersion: "assistant-build/v1",
    catalogVerifiedAt: CATALOG_VERIFIED_AT,
    source: build.source,
    setup: build.setup,
    runtime: {
      image: build.defaults.runtimeImage,
      model: build.defaults.model,
      tools: build.defaults.tools,
      requiredSecrets: build.defaults.requiredSecrets,
      ports: build.setup.ports,
      healthCheckPath: build.setup.healthCheckPath,
      installCommands: build.setup.installCommands,
      configureCommands: build.setup.configureCommands,
      startCommands: build.setup.startCommands,
    },
    wrapper: {
      slug: wrapper.slug,
      name: wrapper.name,
      description: wrapper.description,
      defaults: wrapper.defaults,
      isolation: wrapper.isolation,
      source: wrapper.source,
    },
    supportedWrappers: build.supportedWrappers,
    remoteEditable: {
      configFiles: build.setup.configFiles,
      wrapper: true,
      environment: true,
      reProvisionRequired: true,
    },
    labels: {
      assistantBuildSlug: build.slug,
      assistantBuildName: build.name,
      recommendedWrapper: build.recommendedWrapper,
      language: build.language,
      maturity: build.maturity,
    },
  };
}

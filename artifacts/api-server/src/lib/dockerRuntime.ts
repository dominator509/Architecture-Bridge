import http from "node:http";

const DEFAULT_DOCKER_SOCKET = "/var/run/docker.sock";
const DEFAULT_RUNTIME_IMAGE = "node:22-alpine";
const RUNTIME_PORT = "8080/tcp";

interface DockerRequestError extends Error {
  statusCode?: number;
  responseBody?: string;
}

interface DockerContainerCreateResponse {
  Id: string;
}

interface DockerContainerInspectResponse {
  Id: string;
  State?: {
    Status?: string;
    Running?: boolean;
    Health?: {
      Status?: string;
      FailingStreak?: number;
      Log?: Array<{
        Start?: string;
        End?: string;
        ExitCode?: number;
        Output?: string;
      }>;
    };
  };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
  };
}

export interface DockerRuntimeInput {
  runtimeId: string;
  tenantId: string;
  deploymentId: string;
  image?: string;
  model?: string;
  tools?: string[];
  clientName?: string;
  objective?: string;
}

export interface DockerRuntimeResult {
  endpoint?: string;
  readiness: DockerRuntimeReadiness;
  docker: {
    containerId: string;
    containerName: string;
    image: string;
    internalPort: number;
    hostPort?: string;
    state?: string;
    health?: string;
  };
}

export interface DockerRuntimeReadiness {
  ready: boolean;
  checkedAt: string;
  attempts: number;
  timeoutMs: number;
  health?: string;
  error?: string;
}

export interface DockerRuntimeMetadata {
  id?: string;
  provider?: string;
  endpoint?: string;
  status?: string;
  lastHealthCheckAt?: string;
  health?: {
    state?: string;
    checks?: Record<string, unknown>;
  };
  readiness?: DockerRuntimeReadiness;
  events?: unknown[];
  docker?: {
    containerId?: string;
    containerName?: string;
    image?: string;
    internalPort?: number;
    hostPort?: string;
    state?: string;
    health?: string;
  };
  [key: string]: unknown;
}

export type DockerRuntimeAction = "start" | "stop" | "restart";

function dockerSocketPath() {
  return process.env["DOCKER_SOCKET_PATH"] ?? DEFAULT_DOCKER_SOCKET;
}

function readinessTimeoutMs() {
  const parsed = Number(process.env["DOCKER_RUNTIME_READINESS_TIMEOUT_MS"]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15_000;
}

function readinessIntervalMs() {
  const parsed = Number(process.env["DOCKER_RUNTIME_READINESS_INTERVAL_MS"]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isExpected(statusCode: number, expected: number[]) {
  return expected.includes(statusCode);
}

async function dockerRequest<T = unknown>({
  method,
  path,
  body,
  expected = [200],
}: {
  method: string;
  path: string;
  body?: unknown;
  expected?: number[];
}): Promise<T> {
  const payload = body === undefined ? undefined : JSON.stringify(body);

  return new Promise<T>((resolve, reject) => {
    const req = http.request(
      {
        socketPath: dockerSocketPath(),
        method,
        path,
        headers:
          payload === undefined
            ? undefined
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const statusCode = res.statusCode ?? 0;

          if (!isExpected(statusCode, expected)) {
            const err = new Error(
              `Docker API ${method} ${path} failed with ${statusCode}`,
            ) as DockerRequestError;
            err.statusCode = statusCode;
            err.responseBody = text;
            reject(err);
            return;
          }

          if (!text.trim()) {
            resolve(undefined as T);
            return;
          }

          try {
            resolve(JSON.parse(text) as T);
          } catch {
            resolve(text as T);
          }
        });
      },
    );

    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function splitImage(image: string) {
  const slashIndex = image.lastIndexOf("/");
  const colonIndex = image.lastIndexOf(":");

  if (colonIndex > slashIndex) {
    return {
      repository: image.slice(0, colonIndex),
      tag: image.slice(colonIndex + 1),
    };
  }

  return { repository: image, tag: "latest" };
}

async function ensureImage(image: string) {
  const { repository, tag } = splitImage(image);
  await dockerRequest<string>({
    method: "POST",
    path: `/images/create?fromImage=${encodeURIComponent(
      repository,
    )}&tag=${encodeURIComponent(tag)}`,
    expected: [200],
  });
}

function sanitizeContainerName(tenantId: string, deploymentId: string) {
  return `ab-${tenantId}-${deploymentId}`
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .slice(0, 120);
}

function runtimeCommand() {
  return [
    "node",
    "-e",
    [
      "const http=require('http')",
      "const body=()=>JSON.stringify({status:'ok',runtimeId:process.env.RUNTIME_ID,deploymentId:process.env.DEPLOYMENT_ID,clientName:process.env.CLIENT_NAME,model:process.env.MODEL,tools:(process.env.TOOLS||'').split(',').filter(Boolean)})",
      "http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(body())}).listen(8080,'0.0.0.0')",
    ].join(";"),
  ];
}

function healthcheckCommand() {
  return [
    "CMD-SHELL",
    [
      "node -e",
      `"fetch('http://127.0.0.1:8080').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`,
    ].join(" "),
  ];
}

function dockerHealthStatus(inspected: DockerContainerInspectResponse) {
  return inspected.State?.Health?.Status;
}

function latestHealthOutput(inspected: DockerContainerInspectResponse) {
  const logs = inspected.State?.Health?.Log ?? [];
  return logs[logs.length - 1]?.Output?.trim();
}

function dockerStateToRuntimeStatus(
  inspected: DockerContainerInspectResponse,
): "healthy" | "starting" | "unhealthy" | "stopped" {
  if (!inspected.State?.Running) return "stopped";

  const health = dockerHealthStatus(inspected);
  if (health === "healthy") return "healthy";
  if (health === "unhealthy") return "unhealthy";
  if (health === "starting") return "starting";

  return "healthy";
}

function readinessError(inspected: DockerContainerInspectResponse) {
  if (!inspected.State?.Running) {
    return `Container is ${inspected.State?.Status ?? "not running"}`;
  }

  if (dockerHealthStatus(inspected) === "unhealthy") {
    return latestHealthOutput(inspected) ?? "Container healthcheck is unhealthy";
  }

  return "Runtime did not become ready before the timeout";
}

async function inspectContainer(container: string) {
  return dockerRequest<DockerContainerInspectResponse>({
    method: "GET",
    path: `/containers/${encodeURIComponent(container)}/json`,
    expected: [200],
  });
}

async function waitForContainerReadiness(container: string): Promise<{
  inspected: DockerContainerInspectResponse;
  readiness: DockerRuntimeReadiness;
}> {
  const timeoutMs = readinessTimeoutMs();
  const intervalMs = readinessIntervalMs();
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let inspected = await inspectContainer(container);

  while (Date.now() <= deadline) {
    attempts += 1;
    inspected = await inspectContainer(container);
    const status = dockerStateToRuntimeStatus(inspected);
    const health = dockerHealthStatus(inspected);

    if (status === "healthy") {
      return {
        inspected,
        readiness: {
          ready: true,
          checkedAt: new Date().toISOString(),
          attempts,
          timeoutMs,
          health,
        },
      };
    }

    await sleep(intervalMs);
  }

  return {
    inspected,
    readiness: {
      ready: false,
      checkedAt: new Date().toISOString(),
      attempts,
      timeoutMs,
      health: dockerHealthStatus(inspected),
      error: readinessError(inspected),
    },
  };
}

export async function provisionDockerRuntime(
  input: DockerRuntimeInput,
): Promise<DockerRuntimeResult> {
  const image =
    input.image ??
    process.env["AGENT_RUNTIME_IMAGE"] ??
    DEFAULT_RUNTIME_IMAGE;
  const containerName = sanitizeContainerName(input.tenantId, input.deploymentId);

  await dockerRequest({
    method: "POST",
    path: `/containers/${encodeURIComponent(containerName)}/stop?t=3`,
    expected: [204, 304, 404],
  });
  await dockerRequest({
    method: "DELETE",
    path: `/containers/${encodeURIComponent(containerName)}?force=true`,
    expected: [204, 404],
  });

  const createBody = {
    Image: image,
    Cmd: runtimeCommand(),
    Env: [
      `RUNTIME_ID=${input.runtimeId}`,
      `TENANT_ID=${input.tenantId}`,
      `DEPLOYMENT_ID=${input.deploymentId}`,
      `CLIENT_NAME=${input.clientName ?? ""}`,
      `OBJECTIVE=${input.objective ?? ""}`,
      `MODEL=${input.model ?? ""}`,
      `TOOLS=${(input.tools ?? []).join(",")}`,
    ],
    Labels: {
      "architecture-bridge.runtime-id": input.runtimeId,
      "architecture-bridge.tenant-id": input.tenantId,
      "architecture-bridge.deployment-id": input.deploymentId,
    },
    ExposedPorts: {
      [RUNTIME_PORT]: {},
    },
    Healthcheck: {
      Test: healthcheckCommand(),
      Interval: 1_000_000_000,
      Timeout: 1_000_000_000,
      Retries: 10,
      StartPeriod: 1_000_000_000,
    },
    HostConfig: {
      PortBindings: {
        [RUNTIME_PORT]: [{ HostPort: "" }],
      },
      RestartPolicy: {
        Name: "unless-stopped",
      },
    },
  };

  let created: DockerContainerCreateResponse;
  try {
    created = await dockerRequest<DockerContainerCreateResponse>({
      method: "POST",
      path: `/containers/create?name=${encodeURIComponent(containerName)}`,
      body: createBody,
      expected: [201],
    });
  } catch (err) {
    const dockerErr = err as DockerRequestError;
    if (dockerErr.statusCode !== 404) throw err;
    await ensureImage(image);
    created = await dockerRequest<DockerContainerCreateResponse>({
      method: "POST",
      path: `/containers/create?name=${encodeURIComponent(containerName)}`,
      body: createBody,
      expected: [201],
    });
  }

  await dockerRequest({
    method: "POST",
    path: `/containers/${created.Id}/start`,
    expected: [204, 304],
  });

  const { inspected, readiness } = await waitForContainerReadiness(created.Id);
  if (!readiness.ready) {
    throw new Error(readiness.error ?? "Docker runtime failed readiness checks");
  }

  const port = inspected.NetworkSettings?.Ports?.[RUNTIME_PORT]?.[0]?.HostPort;

  return {
    endpoint: port ? `http://localhost:${port}` : undefined,
    readiness,
    docker: {
      containerId: inspected.Id,
      containerName,
      image,
      internalPort: 8080,
      hostPort: port,
      state: inspected.State?.Status,
      health: dockerHealthStatus(inspected),
    },
  };
}

function dockerContainerRef(runtime: DockerRuntimeMetadata) {
  return runtime.docker?.containerId ?? runtime.docker?.containerName;
}

function dockerPort(inspected: DockerContainerInspectResponse) {
  return inspected.NetworkSettings?.Ports?.[RUNTIME_PORT]?.[0]?.HostPort;
}

export async function applyDockerRuntimeAction(
  runtime: DockerRuntimeMetadata,
  action: DockerRuntimeAction,
): Promise<DockerRuntimeMetadata> {
  const container = dockerContainerRef(runtime);
  if (!container) {
    throw new Error("Docker runtime is missing a container reference");
  }

  const encodedContainer = encodeURIComponent(container);
  if (action === "stop") {
    await dockerRequest({
      method: "POST",
      path: `/containers/${encodedContainer}/stop?t=3`,
      expected: [204, 304],
    });
  } else if (action === "start") {
    await dockerRequest({
      method: "POST",
      path: `/containers/${encodedContainer}/start`,
      expected: [204, 304],
    });
  } else {
    await dockerRequest({
      method: "POST",
      path: `/containers/${encodedContainer}/restart?t=3`,
      expected: [204],
    });
  }

  const readiness =
    action === "stop"
      ? undefined
      : await waitForContainerReadiness(container);
  const inspected = readiness?.inspected ?? (await inspectContainer(container));
  if (readiness && !readiness.readiness.ready) {
    throw new Error(
      readiness.readiness.error ?? "Docker runtime failed readiness checks",
    );
  }

  const port = dockerPort(inspected);
  const status = dockerStateToRuntimeStatus(inspected);
  const now = new Date().toISOString();
  const runtimeReadiness =
    readiness?.readiness ??
    (action === "stop"
      ? {
          ready: false,
          checkedAt: now,
          attempts: 0,
          timeoutMs: 0,
          health: dockerHealthStatus(inspected),
        }
      : runtime.readiness);

  return {
    ...runtime,
    endpoint: port ? `http://localhost:${port}` : runtime.endpoint,
    status,
    lastHealthCheckAt: now,
    readiness: runtimeReadiness,
    docker: {
      containerId: inspected.Id,
      containerName: runtime.docker?.containerName ?? container,
      image: runtime.docker?.image ?? "unknown",
      internalPort: runtime.docker?.internalPort ?? 8080,
      hostPort: port,
      state: inspected.State?.Status,
      health: dockerHealthStatus(inspected),
    },
    health: {
      ...runtime.health,
      state: status,
      checks: {
        ...(runtime.health?.checks ?? {}),
        dockerContainerStarted: inspected.State?.Running === true,
        dockerHealthStatus: dockerHealthStatus(inspected),
        runtimeReady: runtimeReadiness?.ready ?? false,
        runtimeReadinessAttempts: runtimeReadiness?.attempts,
        runtimeReadinessTimeoutMs: runtimeReadiness?.timeoutMs,
      },
    },
    events: [
      ...(Array.isArray(runtime.events) ? runtime.events : []),
      {
        at: now,
        level: "info",
        message: `Docker runtime ${action} completed`,
      },
    ],
  };
}

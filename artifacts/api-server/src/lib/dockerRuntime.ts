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
  docker: {
    containerId: string;
    containerName: string;
    image: string;
    internalPort: number;
    hostPort?: string;
    state?: string;
  };
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
  events?: unknown[];
  docker?: {
    containerId?: string;
    containerName?: string;
    image?: string;
    internalPort?: number;
    hostPort?: string;
    state?: string;
  };
  [key: string]: unknown;
}

export type DockerRuntimeAction = "start" | "stop" | "restart";

function dockerSocketPath() {
  return process.env["DOCKER_SOCKET_PATH"] ?? DEFAULT_DOCKER_SOCKET;
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

  const inspected = await dockerRequest<DockerContainerInspectResponse>({
    method: "GET",
    path: `/containers/${created.Id}/json`,
    expected: [200],
  });
  const port = inspected.NetworkSettings?.Ports?.[RUNTIME_PORT]?.[0]?.HostPort;

  return {
    endpoint: port ? `http://localhost:${port}` : undefined,
    docker: {
      containerId: inspected.Id,
      containerName,
      image,
      internalPort: 8080,
      hostPort: port,
      state: inspected.State?.Status,
    },
  };
}

function dockerContainerRef(runtime: DockerRuntimeMetadata) {
  return runtime.docker?.containerId ?? runtime.docker?.containerName;
}

function dockerStateToRuntimeStatus(
  inspected: DockerContainerInspectResponse,
): "healthy" | "stopped" {
  return inspected.State?.Running ? "healthy" : "stopped";
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

  const inspected = await dockerRequest<DockerContainerInspectResponse>({
    method: "GET",
    path: `/containers/${encodedContainer}/json`,
    expected: [200],
  });
  const port = dockerPort(inspected);
  const status = dockerStateToRuntimeStatus(inspected);
  const now = new Date().toISOString();

  return {
    ...runtime,
    endpoint: port ? `http://localhost:${port}` : runtime.endpoint,
    status,
    lastHealthCheckAt: now,
    docker: {
      containerId: inspected.Id,
      containerName: runtime.docker?.containerName ?? container,
      image: runtime.docker?.image ?? "unknown",
      internalPort: runtime.docker?.internalPort ?? 8080,
      hostPort: port,
      state: inspected.State?.Status,
    },
    health: {
      ...runtime.health,
      state: status,
      checks: {
        ...(runtime.health?.checks ?? {}),
        dockerContainerStarted: inspected.State?.Running === true,
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

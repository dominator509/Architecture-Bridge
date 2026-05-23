import {
  applyDockerRuntimeAction,
  type DockerRuntimeAction,
  type DockerRuntimeMetadata,
} from "./dockerRuntime";

export type DeploymentStatus = "pending" | "active" | "failed" | "stopped";

interface ApplyRuntimeLifecycleInput {
  metadata: unknown;
  status: DeploymentStatus;
  now?: Date;
}

interface ApplyRuntimeLifecycleResult {
  metadata: Record<string, unknown>;
  runtimeChanged: boolean;
  runtime?: Record<string, unknown>;
  action?: DockerRuntimeAction;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function runtimeActionForStatus(
  status: DeploymentStatus,
): DockerRuntimeAction | undefined {
  if (status === "active") return "start";
  if (status === "stopped" || status === "failed") return "stop";
  return undefined;
}

function hasDockerContainer(runtime: Record<string, unknown>) {
  const docker = asRecord(runtime["docker"]);
  return (
    typeof docker["containerId"] === "string" ||
    typeof docker["containerName"] === "string"
  );
}

export async function applyRuntimeLifecycleForStatus({
  metadata,
  status,
  now = new Date(),
}: ApplyRuntimeLifecycleInput): Promise<ApplyRuntimeLifecycleResult> {
  const currentMetadata = asRecord(metadata);
  const runtime = asRecord(currentMetadata["runtime"]);
  const action = runtimeActionForStatus(status);

  if (
    !action ||
    runtime["provider"] !== "docker-local" ||
    !hasDockerContainer(runtime) ||
    process.env["DOCKER_RUNTIME_ENABLED"] !== "true"
  ) {
    return { metadata: currentMetadata, runtimeChanged: false };
  }

  const updatedRuntime = await applyDockerRuntimeAction(
    runtime as DockerRuntimeMetadata,
    action,
  );
  const timestamp = now.toISOString();
  const previousHistory = Array.isArray(currentMetadata["runtimeHistory"])
    ? currentMetadata["runtimeHistory"]
    : [];
  const runtimeHistory = [
    ...previousHistory,
    {
      runtimeId: updatedRuntime.id,
      provider: updatedRuntime.provider,
      status: updatedRuntime.status,
      action,
      at: timestamp,
    },
  ].slice(-10);

  return {
    metadata: {
      ...currentMetadata,
      runtime: updatedRuntime,
      runtimeHistory,
      runtimeStatus: updatedRuntime.status,
      lastRuntimeActionAt: timestamp,
    },
    runtimeChanged: true,
    runtime: updatedRuntime,
    action,
  };
}

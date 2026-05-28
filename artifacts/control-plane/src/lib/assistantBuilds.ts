export interface AssistantBuildDefinition {
  slug: string;
  name: string;
  description: string;
  defaultVersion: string;
  language: string;
  maturity: "stable" | "active" | "experimental";
  source: {
    repository: string;
    docs?: string;
    website?: string;
    license?: string;
    installReference: string;
  };
  setup: {
    prerequisites: string[];
    installCommands: string[];
    configureCommands: string[];
    startCommands: string[];
    configFiles: string[];
    ports: number[];
    healthCheckPath: string;
  };
  defaults: {
    model: string;
    tools: string[];
    runtimeImage: string;
    requiredSecrets: string[];
  };
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

export interface AssistantCatalogResponse {
  verifiedAt: string;
  items: AssistantBuildDefinition[];
  wrappers: SecurityWrapperDefinition[];
}

export interface ImportedAssistantBuild {
  imported: boolean;
  packageCreated: boolean;
  package: {
    id: string;
    name: string;
    slug: string;
    description?: string;
    metadata?: Record<string, unknown>;
  };
  packageVersion: {
    id: string;
    packageId: string;
    version: string;
    manifest: Record<string, unknown>;
    status: string;
  };
  manifest: Record<string, unknown>;
  wrapper: SecurityWrapperDefinition;
}

export const assistantCatalogQueryKey = (tenantId: string) => [
  "assistant-build-catalog",
  tenantId,
];

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `HTTP ${response.status}`;
    throw Object.assign(new Error(message), { data, response });
  }

  return data as T;
}

export async function fetchAssistantCatalog(
  tenantId: string,
): Promise<AssistantCatalogResponse> {
  const response = await fetch(
    `/api/tenants/${encodeURIComponent(tenantId)}/assistant-builds/catalog`,
  );
  return parseJsonResponse<AssistantCatalogResponse>(response);
}

export async function importAssistantBuild({
  tenantId,
  buildSlug,
  wrapperSlug,
}: {
  tenantId: string;
  buildSlug: string;
  wrapperSlug?: string;
}): Promise<ImportedAssistantBuild> {
  const response = await fetch(
    `/api/tenants/${encodeURIComponent(
      tenantId,
    )}/assistant-builds/${encodeURIComponent(buildSlug)}/import`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wrapperSlug ? { wrapperSlug } : {}),
    },
  );
  return parseJsonResponse<ImportedAssistantBuild>(response);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

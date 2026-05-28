import { useMemo, useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getListAllDeploymentsQueryKey,
  getListEnvironmentsQueryKey,
  getListWorkspacesQueryKey,
  listEnvironments,
  useCreateDeployment,
  useCreateEnvironment,
  useCreateWorkspace,
  useListWorkspaces,
  useProvisionDeploymentRuntime,
  useUpdateEnvironment,
  type Environment,
  type Workspace,
} from "@workspace/api-client-react";
import {
  ExternalLink,
  PackagePlus,
  Rocket,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  assistantCatalogQueryKey,
  asRecord,
  fetchAssistantCatalog,
  importAssistantBuild,
  type AssistantBuildDefinition,
  type SecurityWrapperDefinition,
} from "@/lib/assistantBuilds";

type RuntimeProvider = "docker-local" | "managed-sandbox";

type DeploymentResult = {
  id: string;
  approvalRequestId?: string;
};

function getErrorMessage(err: unknown) {
  const body = asRecord((err as { data?: unknown })?.data);
  if (typeof body?.error === "string") return body.error;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

function slugSuffix() {
  return Date.now().toString(36);
}

function metadataForWrapper(wrapper: SecurityWrapperDefinition) {
  return {
    wrapper: {
      slug: wrapper.slug,
      name: wrapper.name,
      defaults: wrapper.defaults,
      isolation: wrapper.isolation,
      source: wrapper.source,
      updatedAt: new Date().toISOString(),
    },
  };
}

export default function AssistantBuildCatalog() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState("");
  const [provider, setProvider] = useState<RuntimeProvider>("managed-sandbox");
  const [wrapperByBuild, setWrapperByBuild] = useState<Record<string, string>>({});
  const [deployingSlug, setDeployingSlug] = useState<string | null>(null);

  const { data: catalog, isLoading: catalogLoading } = useQuery({
    queryKey: assistantCatalogQueryKey(tenantId),
    queryFn: () => fetchAssistantCatalog(tenantId),
    enabled: !!tenantId,
  });

  const { data: workspacesData } = useListWorkspaces(
    tenantId,
    { limit: 200 },
    {
      query: {
        enabled: !!tenantId,
        queryKey: getListWorkspacesQueryKey(tenantId, { limit: 200 }),
      },
    },
  );

  const workspaces = useMemo(
    () => workspacesData?.items ?? [],
    [workspacesData?.items],
  );

  const environmentQueries = useQueries({
    queries: workspaces.map((workspace: Workspace) => ({
      queryKey: getListEnvironmentsQueryKey(tenantId, workspace.id, {
        limit: 200,
      }),
      queryFn: () => listEnvironments(tenantId, workspace.id, { limit: 200 }),
      enabled: !!tenantId,
    })),
  });

  const environments = useMemo(
    () =>
      environmentQueries.flatMap(
        (query) => query.data?.items ?? [],
      ) as Environment[],
    [environmentQueries],
  );

  const workspacesById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaces],
  );

  const wrappersBySlug = useMemo(
    () => new Map((catalog?.wrappers ?? []).map((wrapper) => [wrapper.slug, wrapper])),
    [catalog?.wrappers],
  );

  const filteredBuilds = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return catalog?.items ?? [];
    return (catalog?.items ?? []).filter((build) => {
      const haystack = [
        build.name,
        build.slug,
        build.description,
        build.language,
        ...build.tags,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [catalog?.items, search]);

  const createWorkspaceMutation = useCreateWorkspace();
  const createEnvironmentMutation = useCreateEnvironment();
  const updateEnvironmentMutation = useUpdateEnvironment();
  const createDeploymentMutation = useCreateDeployment();
  const provisionMutation = useProvisionDeploymentRuntime();
  const importMutation = useMutation({
    mutationFn: importAssistantBuild,
  });

  const getWrapperForBuild = (build: AssistantBuildDefinition) => {
    const slug = wrapperByBuild[build.slug] ?? build.recommendedWrapper;
    return wrappersBySlug.get(slug) ?? wrappersBySlug.get(build.recommendedWrapper);
  };

  const invalidateTargets = async (workspaceId?: string) => {
    await queryClient.invalidateQueries({
      queryKey: getListWorkspacesQueryKey(tenantId, { limit: 200 }),
    });
    if (workspaceId) {
      await queryClient.invalidateQueries({
        queryKey: getListEnvironmentsQueryKey(tenantId, workspaceId, {
          limit: 200,
        }),
      });
    }
  };

  const ensureDeploymentTarget = async (wrapper: SecurityWrapperDefinition) => {
    const existingEnvironment = environments.find(
      (env) => env.id === selectedEnvironmentId,
    );

    if (existingEnvironment) {
      const workspace = workspacesById.get(existingEnvironment.workspaceId);
      await updateEnvironmentMutation.mutateAsync({
        tenantId,
        workspaceId: existingEnvironment.workspaceId,
        environmentId: existingEnvironment.id,
        data: {
          metadata: {
            ...(asRecord(existingEnvironment.metadata) ?? {}),
            ...metadataForWrapper(wrapper),
          },
        },
      });
      await invalidateTargets(existingEnvironment.workspaceId);
      return {
        environmentId: existingEnvironment.id,
        workspaceName: workspace?.name ?? "Selected workspace",
        environmentName: existingEnvironment.name,
      };
    }

    const existingWorkspace = workspaces.find(
      (workspace) => workspace.slug === "assistant-builds",
    );
    const workspace =
      existingWorkspace ??
      (await createWorkspaceMutation.mutateAsync({
        tenantId,
        data: {
          name: "Assistant Builds",
          slug: "assistant-builds",
          metadata: {
            createdBy: "assistant-build-catalog",
          },
        },
      }));

    const environment = await createEnvironmentMutation.mutateAsync({
      tenantId,
      workspaceId: workspace.id,
      data: {
        name: `${wrapper.name} Sandbox`,
        slug: `${wrapper.slug}-sandbox-${slugSuffix()}`,
        type: "development",
        metadata: {
          createdBy: "assistant-build-catalog",
          ...metadataForWrapper(wrapper),
        },
      },
    });

    setSelectedEnvironmentId(environment.id);
    await invalidateTargets(workspace.id);
    return {
      environmentId: environment.id,
      workspaceName: workspace.name,
      environmentName: environment.name,
    };
  };

  const handleDeploy = async (build: AssistantBuildDefinition) => {
    const wrapper = getWrapperForBuild(build);
    if (!wrapper) {
      toast({
        title: "Wrapper unavailable",
        description: "Choose a supported wrapper before deploying.",
        variant: "destructive",
      });
      return;
    }

    setDeployingSlug(build.slug);
    try {
      const target = await ensureDeploymentTarget(wrapper);
      const imported = await importMutation.mutateAsync({
        tenantId,
        buildSlug: build.slug,
        wrapperSlug: wrapper.slug,
      });

      const deploymentMetadata = {
        clientName: build.name,
        objective: `Run ${build.name} from ${build.source.repository}`,
        agentPackageId: imported.package.id,
        agentPackageName: build.name,
        agentVersion: imported.packageVersion.version,
        assistantBuildSlug: build.slug,
        wrapperSlug: wrapper.slug,
        wrapperName: wrapper.name,
        sourceRepository: build.source.repository,
        configuredBy: "assistant-build-catalog",
      };

      const created = (await createDeploymentMutation.mutateAsync({
        tenantId,
        environmentId: target.environmentId,
        data: {
          packageVersionId: imported.packageVersion.id,
          metadata: deploymentMetadata,
        },
      })) as DeploymentResult;

      if (created.approvalRequestId) {
        toast({
          title: "Approval requested",
          description: `Request ${created.approvalRequestId} is ready for review.`,
        });
        return;
      }

      await provisionMutation.mutateAsync({
        tenantId,
        deploymentId: created.id,
        data: {
          provider,
          activate: true,
          configOverrides: {
            assistantBuild: {
              slug: build.slug,
              name: build.name,
              source: build.source,
              setup: build.setup,
            },
            runtime: {
              model: build.defaults.model,
              image: build.defaults.runtimeImage,
              tools: build.defaults.tools,
              requiredSecrets: build.defaults.requiredSecrets,
              installCommands: build.setup.installCommands,
              configureCommands: build.setup.configureCommands,
              startCommands: build.setup.startCommands,
              healthCheckPath: build.setup.healthCheckPath,
            },
            wrapper,
            tools: build.defaults.tools,
            deployment: {
              metadata: deploymentMetadata,
              target,
            },
          },
        },
      });

      await queryClient.invalidateQueries({
        queryKey: getListAllDeploymentsQueryKey(tenantId, {}),
      });
      toast({
        title: "Assistant build deployed",
        description: `${build.name} is running in ${target.environmentName}.`,
      });
    } catch (err) {
      toast({
        title: "Failed to deploy assistant build",
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setDeployingSlug(null);
    }
  };

  const isBusy =
    Boolean(deployingSlug) ||
    createWorkspaceMutation.isPending ||
    createEnvironmentMutation.isPending ||
    updateEnvironmentMutation.isPending ||
    createDeploymentMutation.isPending ||
    provisionMutation.isPending ||
    importMutation.isPending;

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Assistant Builds</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Import, wrap, deploy, and reconfigure open source personal assistant builds.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_180px_260px]">
          <div className="space-y-2">
            <Label>Runtime</Label>
            <Select
              value={provider}
              onValueChange={(value) => setProvider(value as RuntimeProvider)}
            >
              <SelectTrigger data-testid="select-build-runtime-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="managed-sandbox">Managed Sandbox</SelectItem>
                <SelectItem value="docker-local">Docker Local</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Target</Label>
            <Select
              value={selectedEnvironmentId || "auto"}
              onValueChange={(value) =>
                setSelectedEnvironmentId(value === "auto" ? "" : value)
              }
            >
              <SelectTrigger data-testid="select-build-target-environment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-create sandbox</SelectItem>
                {environments.map((env) => {
                  const workspace = workspacesById.get(env.workspaceId);
                  return (
                    <SelectItem key={env.id} value={env.id}>
                      {workspace?.name ?? "Workspace"} / {env.name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
                placeholder="Search builds"
                data-testid="input-search-assistant-builds"
              />
            </div>
          </div>
        </div>
      </div>

      {catalogLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-6 py-3 font-medium text-muted-foreground">Build</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Source</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Setup</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Wrapper</th>
                <th className="px-6 py-3 text-right font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredBuilds.map((build) => {
                const wrapper = getWrapperForBuild(build);
                const isDeploying = deployingSlug === build.slug;

                return (
                  <tr key={build.slug} className="align-top transition-colors hover:bg-muted/40">
                    <td className="px-6 py-4">
                      <div className="font-medium text-foreground">{build.name}</div>
                      <p className="mt-1 max-w-md text-xs text-muted-foreground">
                        {build.description}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge variant="outline">{build.language}</Badge>
                        <Badge variant="secondary">{build.maturity}</Badge>
                        {build.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="outline">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <a
                        href={build.source.repository}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex max-w-56 items-center gap-1 truncate text-primary hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="truncate">{build.source.repository}</span>
                      </a>
                      <p className="mt-2 max-w-xs font-mono text-xs text-muted-foreground">
                        {build.source.installReference}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1 text-xs">
                        <div>
                          <span className="text-muted-foreground">Model </span>
                          <span className="font-medium">{build.defaults.model}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Image </span>
                          <span className="font-mono">{build.defaults.runtimeImage}</span>
                        </div>
                        <div className="max-w-xs truncate text-muted-foreground">
                          {build.defaults.tools.join(", ")}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Select
                        value={wrapper?.slug ?? build.recommendedWrapper}
                        onValueChange={(value) =>
                          setWrapperByBuild((current) => ({
                            ...current,
                            [build.slug]: value,
                          }))
                        }
                      >
                        <SelectTrigger className="w-48" data-testid={`select-wrapper-${build.slug}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(catalog?.wrappers ?? [])
                            .filter((candidate) =>
                              build.supportedWrappers.includes(candidate.slug),
                            )
                            .map((candidate) => (
                              <SelectItem key={candidate.slug} value={candidate.slug}>
                                {candidate.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      {wrapper && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          {wrapper.defaults.networkPolicy}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button
                        onClick={() => handleDeploy(build)}
                        disabled={isBusy}
                        data-testid={`button-deploy-build-${build.slug}`}
                      >
                        {isDeploying ? (
                          <PackagePlus className="mr-2 h-4 w-4 animate-pulse" />
                        ) : (
                          <Rocket className="mr-2 h-4 w-4" />
                        )}
                        {isDeploying ? "Deploying" : "Deploy"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

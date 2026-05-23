import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import {
  getListAllDeploymentsQueryKey,
  getDeploymentRuntime,
  getGetDeploymentRuntimeQueryKey,
  getListEnvironmentsQueryKey,
  getListPackagesQueryKey,
  getListPackageVersionsQueryKey,
  getListWorkspacesQueryKey,
  listEnvironments,
  listPackageVersions,
  useCreateDeployment,
  useListAllDeployments,
  useListPackages,
  useListWorkspaces,
  useProvisionDeploymentRuntime,
  useUpdateDeployment,
  type Deployment,
  type DeploymentRuntimeResponse,
  type Environment,
  type Package,
  type PackageVersion,
  type Workspace,
} from "@workspace/api-client-react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  Play,
  Plus,
  RefreshCcw,
  Rocket,
  Settings2,
  Square,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type DeploymentResult = Deployment & {
  outcome?: string;
  approvalRequestId?: string;
  reason?: string;
  code?: string;
};

function getErrorBody(err: unknown): Record<string, unknown> {
  const error = err as {
    data?: Record<string, unknown>;
    response?: { data?: Record<string, unknown> };
    message?: string;
  };
  return error.data ?? error.response?.data ?? {};
}

function getErrorMessage(err: unknown): string {
  const body = getErrorBody(err);
  if (typeof body.error === "string") return body.error;
  if (typeof body.reason === "string") return body.reason;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

function splitTools(value: string): string[] {
  return value
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
}

function statusVariant(status: string) {
  if (status === "active" || status === "published") return "default";
  if (status === "failed" || status === "deprecated") return "destructive";
  return "secondary";
}

function getRuntimeMetadata(deployment: Deployment): Record<string, unknown> | null {
  const metadata = deployment.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const runtime = (metadata as Record<string, unknown>)["runtime"];
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    return null;
  }
  return runtime as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function runtimeVariant(status: string) {
  if (status === "healthy") return "default";
  if (status === "failed" || status === "unhealthy") return "destructive";
  return "secondary";
}

function formatRuntimeTime(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DeploymentList() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [selectedPackageVersionId, setSelectedPackageVersionId] = useState("");
  const [clientName, setClientName] = useState("");
  const [objective, setObjective] = useState("");
  const [model, setModel] = useState("gpt-5.2");
  const [tools, setTools] = useState("web, files, email");
  const [escalationContact, setEscalationContact] = useState("");
  const [provisionError, setProvisionError] = useState<Error | null>(null);
  const [runtimeActionId, setRuntimeActionId] = useState<string | null>(null);
  const deployIntentApplied = useRef(false);

  const { data, isLoading } = useListAllDeployments(
    tenantId,
    {},
    {
      query: {
        enabled: !!tenantId,
        queryKey: getListAllDeploymentsQueryKey(tenantId, {}),
      },
    },
  );

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

  const { data: packagesData } = useListPackages(
    tenantId,
    { limit: 200 },
    {
      query: {
        enabled: !!tenantId,
        queryKey: getListPackagesQueryKey(tenantId, { limit: 200 }),
      },
    },
  );

  const workspaces = useMemo(
    () => workspacesData?.items ?? [],
    [workspacesData?.items],
  );
  const packages = useMemo(
    () => packagesData?.items ?? [],
    [packagesData?.items],
  );
  const deployments = useMemo(() => data?.items ?? [], [data?.items]);

  const environmentQueries = useQueries({
    queries: workspaces.map((workspace: Workspace) => ({
      queryKey: getListEnvironmentsQueryKey(tenantId, workspace.id, {
        limit: 200,
      }),
      queryFn: () =>
        listEnvironments(tenantId, workspace.id, { limit: 200 }),
      enabled: !!tenantId,
    })),
  });

  const versionQueries = useQueries({
    queries: packages.map((pkg: Package) => ({
      queryKey: getListPackageVersionsQueryKey(tenantId, pkg.id, {
        limit: 200,
      }),
      queryFn: () =>
        listPackageVersions(tenantId, pkg.id, { limit: 200 }),
      enabled: !!tenantId,
    })),
  });

  const runtimeQueries = useQueries({
    queries: deployments.map((deployment: Deployment) => ({
      queryKey: getGetDeploymentRuntimeQueryKey(tenantId, deployment.id),
      queryFn: () => getDeploymentRuntime(tenantId, deployment.id),
      enabled: !!tenantId,
      refetchInterval: 5000,
    })),
  });

  const environments = useMemo(
    () =>
      environmentQueries.flatMap(
        (query) => query.data?.items ?? [],
      ) as Environment[],
    [environmentQueries],
  );

  const packageVersions = useMemo(
    () =>
      versionQueries.flatMap(
        (query) => query.data?.items ?? [],
      ) as PackageVersion[],
    [versionQueries],
  );

  const environmentsById = useMemo(
    () => new Map(environments.map((env) => [env.id, env])),
    [environments],
  );
  const workspacesById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaces],
  );
  const packagesById = useMemo(
    () => new Map(packages.map((pkg) => [pkg.id, pkg])),
    [packages],
  );
  const versionsById = useMemo(
    () => new Map(packageVersions.map((version) => [version.id, version])),
    [packageVersions],
  );
  const runtimeByDeploymentId = useMemo(() => {
    const entries = runtimeQueries
      .map((query) => query.data as DeploymentRuntimeResponse | undefined)
      .filter((runtime): runtime is DeploymentRuntimeResponse =>
        Boolean(runtime?.deploymentId),
      )
      .map((runtime) => [runtime.deploymentId, runtime] as const);
    return new Map(entries);
  }, [runtimeQueries]);

  const selectedEnvironmentOptions = useMemo(
    () =>
      environments.filter((env) => env.workspaceId === selectedWorkspaceId),
    [environments, selectedWorkspaceId],
  );

  const selectedVersionOptions = useMemo(
    () =>
      packageVersions.filter(
        (version) => version.packageId === selectedPackageId,
      ),
    [packageVersions, selectedPackageId],
  );

  const selectedAgent = packagesById.get(selectedPackageId);
  const selectedVersion = versionsById.get(selectedPackageVersionId);
  const selectedEnvironment = environmentsById.get(selectedEnvironmentId);
  const selectedWorkspace = selectedEnvironment
    ? workspacesById.get(selectedEnvironment.workspaceId)
    : undefined;

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces.length > 0) {
      setSelectedWorkspaceId(workspaces[0]!.id);
    }
  }, [selectedWorkspaceId, workspaces]);

  useEffect(() => {
    if (
      selectedEnvironmentId &&
      selectedEnvironmentOptions.some((env) => env.id === selectedEnvironmentId)
    ) {
      return;
    }
    setSelectedEnvironmentId(selectedEnvironmentOptions[0]?.id ?? "");
  }, [selectedEnvironmentId, selectedEnvironmentOptions]);

  useEffect(() => {
    if (!selectedPackageId && packages.length > 0) {
      setSelectedPackageId(packages[0]!.id);
    }
  }, [selectedPackageId, packages]);

  useEffect(() => {
    if (deployIntentApplied.current || packages.length === 0) return;
    const query = new URLSearchParams(window.location.search);
    const agentId = query.get("agent");
    if (!agentId) return;

    const agent = packages.find((pkg) => pkg.id === agentId);
    if (!agent) return;

    deployIntentApplied.current = true;
    setSelectedPackageId(agent.id);
    setIsCreateOpen(true);
  }, [packages]);

  useEffect(() => {
    if (
      selectedPackageVersionId &&
      selectedVersionOptions.some(
        (version) => version.id === selectedPackageVersionId,
      )
    ) {
      return;
    }
    const published =
      selectedVersionOptions.find((version) => version.status === "published") ??
      selectedVersionOptions[0];
    setSelectedPackageVersionId(published?.id ?? "");
  }, [selectedPackageVersionId, selectedVersionOptions]);

  useEffect(() => {
    if (!isCreateOpen || !selectedAgent || clientName.trim()) return;
    setClientName(selectedAgent.name);
  }, [clientName, isCreateOpen, selectedAgent]);

  const createMutation = useCreateDeployment();
  const updateMutation = useUpdateDeployment();
  const provisionMutation = useProvisionDeploymentRuntime();

  const resetWizard = () => {
    setClientName("");
    setObjective("");
    setModel("gpt-5.2");
    setTools("web, files, email");
    setEscalationContact("");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setProvisionError(null);
    provisionMutation.reset();

    if (!selectedEnvironmentId || !selectedPackageVersionId) {
      toast({
        title: "Deployment needs a target",
        description: "Choose an environment and agent version.",
        variant: "destructive",
      });
      return;
    }

    const toolList = splitTools(tools);
    const deploymentMetadata = {
      clientName: clientName.trim(),
      objective: objective.trim(),
      agentPackageId: selectedPackageId,
      agentPackageName: selectedAgent?.name,
      agentVersion: selectedVersion?.version,
      configuredBy: "control-plane",
      escalationContact: escalationContact.trim(),
      model,
      tools: toolList,
    };

    const configOverrides = {
      client: {
        name: clientName.trim(),
        escalationContact: escalationContact.trim(),
      },
      objective: objective.trim(),
      runtime: { model },
      tools: toolList,
    };

    try {
      const result = (await createMutation.mutateAsync({
        tenantId,
        environmentId: selectedEnvironmentId,
        data: {
          packageVersionId: selectedPackageVersionId,
          metadata: deploymentMetadata,
        },
      })) as DeploymentResult;

      if (result?.approvalRequestId) {
        toast({
          title: "Approval requested",
          description: `Request ${result.approvalRequestId} is ready for review.`,
        });
        setIsCreateOpen(false);
        resetWizard();
        return;
      }

      const provisioned = await provisionMutation.mutateAsync({
        tenantId,
        deploymentId: result.id,
        data: {
          provider: "docker-local",
          activate: true,
          configOverrides: {
            ...configOverrides,
            deployment: {
              metadata: deploymentMetadata,
            },
          },
        },
      });

      toast({
        title: "Agent runtime provisioned",
        description: `${selectedAgent?.name ?? "Agent"} is active for ${
          clientName.trim() || "this client"
        } on ${String(provisioned.runtime.provider ?? "managed runtime")}.`,
      });

      setIsCreateOpen(false);
      resetWizard();
      queryClient.invalidateQueries({
        queryKey: getListAllDeploymentsQueryKey(tenantId, {}),
      });
    } catch (err) {
      setProvisionError(
        err instanceof Error ? err : new Error(getErrorMessage(err)),
      );
      const body = getErrorBody(err);
      if (body.code === "POLICY_DENIED") {
        toast({
          title: "Deployment blocked by policy",
          description: getErrorMessage(err),
          variant: "destructive",
        });
      } else {
        toast({
          title: "Failed to deploy agent",
          description: getErrorMessage(err),
          variant: "destructive",
        });
      }
    }
  };

  const handleUpdateStatus = (
    id: string,
    status: "active" | "stopped" | "failed" | "pending",
  ) => {
    setRuntimeActionId(id);
    updateMutation.mutate(
      { tenantId, deploymentId: id, data: { status } },
      {
        onSuccess: (result: any) => {
          if (result?.outcome === "require_approval") {
            toast({
              title: "Approval required",
              description: `Status change to "${status}" requires approval. Request: ${result.approvalRequestId}`,
            });
          } else {
            toast({
              title: "Status updated",
              description: `Deployment set to "${status}".`,
            });
          }
          queryClient.invalidateQueries({
            queryKey: getListAllDeploymentsQueryKey(tenantId, {}),
          });
          queryClient.invalidateQueries({
            queryKey: getGetDeploymentRuntimeQueryKey(tenantId, id),
          });
        },
        onError: (err: unknown) => {
          const body = getErrorBody(err);
          if (body.code === "POLICY_DENIED") {
            toast({
              title: "Status change blocked by policy",
              description: getErrorMessage(err),
              variant: "destructive",
            });
          } else {
            toast({
              title: "Failed to update status",
              description: getErrorMessage(err),
              variant: "destructive",
            });
          }
        },
        onSettled: () => setRuntimeActionId(null),
      },
    );
  };

  const handleRestart = async (id: string) => {
    setRuntimeActionId(id);
    try {
      await updateMutation.mutateAsync({
        tenantId,
        deploymentId: id,
        data: { status: "stopped" },
      });
      const result = (await updateMutation.mutateAsync({
        tenantId,
        deploymentId: id,
        data: { status: "active" },
      })) as DeploymentResult;

      if (result?.approvalRequestId) {
        toast({
          title: "Approval required",
          description: `Restart requires approval. Request: ${result.approvalRequestId}`,
        });
      } else {
        toast({
          title: "Runtime restarted",
          description: "The agent runtime was stopped and started again.",
        });
      }
      queryClient.invalidateQueries({
        queryKey: getListAllDeploymentsQueryKey(tenantId, {}),
      });
      queryClient.invalidateQueries({
        queryKey: getGetDeploymentRuntimeQueryKey(tenantId, id),
      });
    } catch (err) {
      toast({
        title: "Failed to restart runtime",
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setRuntimeActionId(null);
    }
  };

  const handleProvisionExisting = async (deployment: Deployment) => {
    setProvisionError(null);
    provisionMutation.reset();
    setRuntimeActionId(deployment.id);
    try {
      const provisioned = await provisionMutation.mutateAsync({
        tenantId,
        deploymentId: deployment.id,
        data: {
          provider: "docker-local",
          activate: true,
        },
      });
      toast({
        title: "Runtime provisioned",
        description: `Runtime ${String(provisioned.runtime.id)} is healthy.`,
      });
      queryClient.invalidateQueries({
        queryKey: getListAllDeploymentsQueryKey(tenantId, {}),
      });
      queryClient.invalidateQueries({
        queryKey: getGetDeploymentRuntimeQueryKey(tenantId, deployment.id),
      });
    } catch (err) {
      setProvisionError(
        err instanceof Error ? err : new Error(getErrorMessage(err)),
      );
      toast({
        title: "Failed to provision runtime",
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setRuntimeActionId(null);
    }
  };

  const isDeploying =
    createMutation.isPending ||
    provisionMutation.isPending ||
    updateMutation.isPending;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agent Deployments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure, launch, and operate agents for this tenant.
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-deployment">
              <Rocket className="mr-2 h-4 w-4" /> Deploy Agent
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Deploy Agent</DialogTitle>
              <DialogDescription>
                Select the agent, target environment, and client configuration.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Workspace</Label>
                  <Select
                    value={selectedWorkspaceId}
                    onValueChange={setSelectedWorkspaceId}
                  >
                    <SelectTrigger data-testid="select-workspace">
                      <SelectValue placeholder="Choose workspace" />
                    </SelectTrigger>
                    <SelectContent>
                      {workspaces.map((workspace) => (
                        <SelectItem key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Environment</Label>
                  <Select
                    value={selectedEnvironmentId}
                    onValueChange={setSelectedEnvironmentId}
                  >
                    <SelectTrigger data-testid="select-environment">
                      <SelectValue placeholder="Choose environment" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedEnvironmentOptions.map((env) => (
                        <SelectItem key={env.id} value={env.id}>
                          {env.name} ({env.type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Agent</Label>
                  <Select
                    value={selectedPackageId}
                    onValueChange={setSelectedPackageId}
                  >
                    <SelectTrigger data-testid="select-agent">
                      <SelectValue placeholder="Choose agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {packages.map((pkg) => (
                        <SelectItem key={pkg.id} value={pkg.id}>
                          {pkg.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Version</Label>
                  <Select
                    value={selectedPackageVersionId}
                    onValueChange={setSelectedPackageVersionId}
                  >
                    <SelectTrigger data-testid="select-agent-version">
                      <SelectValue placeholder="Choose version" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedVersionOptions.map((version) => (
                        <SelectItem key={version.id} value={version.id}>
                          {version.version} ({version.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="clientName">Client Name</Label>
                  <Input
                    id="clientName"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Acme Corp"
                    required
                    data-testid="input-client-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model">Model</Label>
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger id="model" data-testid="select-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-5.2">GPT-5.2</SelectItem>
                      <SelectItem value="gpt-5.2-mini">GPT-5.2 Mini</SelectItem>
                      <SelectItem value="gpt-5.3-codex">GPT-5.3 Codex</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="objective">Objective</Label>
                  <Textarea
                    id="objective"
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    placeholder="Qualify new inbound architecture leads and prepare a handoff brief."
                    required
                    data-testid="input-objective"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tools">Tools</Label>
                  <Input
                    id="tools"
                    value={tools}
                    onChange={(e) => setTools(e.target.value)}
                    placeholder="web, files, email"
                    data-testid="input-tools"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="escalationContact">Escalation Contact</Label>
                  <Input
                    id="escalationContact"
                    value={escalationContact}
                    onChange={(e) => setEscalationContact(e.target.value)}
                    placeholder="ops@example.com"
                    data-testid="input-escalation-contact"
                  />
                </div>
              </div>

              <div className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm md:grid-cols-3">
                <div className="flex items-start gap-2">
                  <Bot className="mt-0.5 h-4 w-4 text-primary" />
                  <div>
                    <p className="font-medium">{selectedAgent?.name ?? "No agent"}</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedVersion?.version ?? "No version selected"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Settings2 className="mt-0.5 h-4 w-4 text-primary" />
                  <div>
                    <p className="font-medium">
                      {selectedEnvironment?.name ?? "No environment"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedWorkspace?.name ?? "No workspace selected"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                  <div>
                    <p className="font-medium">{clientName || "Client"}</p>
                    <p className="text-xs text-muted-foreground">
                      {model} with {splitTools(tools).length} tools
                    </p>
                  </div>
                </div>
              </div>

              {(createMutation.error || provisionError || updateMutation.error) && (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>
                    {getErrorMessage(
                      createMutation.error ??
                        provisionError ??
                        updateMutation.error,
                    )}
                  </span>
                </div>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCreateOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    isDeploying ||
                    !selectedEnvironmentId ||
                    !selectedPackageVersionId
                  }
                  data-testid="button-submit-deployment"
                >
                  {isDeploying ? "Deploying..." : "Deploy Agent"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : deployments.length === 0 ? (
        <div className="border border-dashed bg-card py-20 text-center">
          <Activity className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-medium">No agent deployments</h3>
          <p className="mt-1 text-muted-foreground">
            Deploy an agent for this tenant to get started.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-6 py-3 font-medium text-muted-foreground">Agent</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Client</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Environment</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Runtime</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Created</th>
                <th className="px-6 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {deployments.map((deployment) => {
                const version = versionsById.get(deployment.packageVersionId);
                const agent = version ? packagesById.get(version.packageId) : undefined;
                const env = environmentsById.get(deployment.environmentId);
                const workspace = env ? workspacesById.get(env.workspaceId) : undefined;
                const metadata = deployment.metadata ?? {};
                const client =
                  typeof metadata.clientName === "string"
                    ? metadata.clientName
                    : "Unassigned";
                const liveRuntime = runtimeByDeploymentId.get(deployment.id);
                const runtime =
                  asRecord(liveRuntime?.runtime) ?? getRuntimeMetadata(deployment);
                const runtimeStatus =
                  typeof runtime?.status === "string" ? runtime.status : "not provisioned";
                const runtimeEndpoint = readString(runtime, "endpoint");
                const runtimeProvider = readString(runtime, "provider");
                const runtimeLastCheck = formatRuntimeTime(
                  readString(runtime, "lastHealthCheckAt"),
                );
                const isRuntimeBusy = runtimeActionId === deployment.id;

                return (
                  <tr
                    key={deployment.id}
                    className="transition-colors hover:bg-muted/50"
                    data-testid={`row-deployment-${deployment.id}`}
                  >
                    <td className="px-6 py-4">
                      <div className="font-medium text-foreground">
                        {agent?.name ?? deployment.packageVersionId}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {version?.version ?? "Version pending"}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium">{client}</div>
                      {typeof metadata.objective === "string" && (
                        <div className="max-w-xs truncate text-xs text-muted-foreground">
                          {metadata.objective}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium">
                        {env?.name ?? deployment.environmentId}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {workspace?.name ?? "Workspace pending"}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={statusVariant(deployment.status)}>
                        {deployment.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <Badge
                          variant={runtimeVariant(runtimeStatus)}
                        >
                          {isRuntimeBusy ? "updating" : runtimeStatus}
                        </Badge>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {runtimeProvider && <span>{runtimeProvider}</span>}
                          {runtimeLastCheck && <span>checked {runtimeLastCheck}</span>}
                        </div>
                        {runtimeEndpoint && (
                          <a
                            href={runtimeEndpoint}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-44 items-center gap-1 truncate text-xs text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{runtimeEndpoint}</span>
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-muted-foreground">
                      {new Date(deployment.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-options-${deployment.id}`}
                          >
                            Options
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleProvisionExisting(deployment)}
                            disabled={isRuntimeBusy}
                          >
                            <Rocket className="mr-2 h-4 w-4" /> Provision Runtime
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              handleUpdateStatus(deployment.id, "active")
                            }
                            disabled={isRuntimeBusy || deployment.status === "active"}
                          >
                            <Play className="mr-2 h-4 w-4" /> Start
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              handleUpdateStatus(deployment.id, "stopped")
                            }
                            disabled={isRuntimeBusy || deployment.status === "stopped"}
                          >
                            <Square className="mr-2 h-4 w-4" /> Stop
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleRestart(deployment.id)}
                            disabled={isRuntimeBusy || runtimeStatus === "not provisioned"}
                          >
                            <RefreshCcw className="mr-2 h-4 w-4" /> Restart
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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

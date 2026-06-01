import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import {
  useGetEnvironment,
  getGetEnvironmentQueryKey,
  useListDeployments,
  getListDeploymentsQueryKey,
  useUpdateEnvironment,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Activity, Save, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  assistantCatalogQueryKey,
  asRecord,
  fetchAssistantCatalog,
  type SecurityWrapperDefinition,
} from "@/lib/assistantBuilds";

function readString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function wrapperDraft(wrapper: SecurityWrapperDefinition) {
  return JSON.stringify(
    {
      slug: wrapper.slug,
      name: wrapper.name,
      defaults: wrapper.defaults,
      isolation: wrapper.isolation,
      source: wrapper.source,
    },
    null,
    2,
  );
}

export default function EnvironmentDetail() {
  const params = useParams<{ tenantId: string; workspaceId: string; environmentId: string }>();
  const tenantId = params.tenantId || "";
  const workspaceId = params.workspaceId || "";
  const environmentId = params.environmentId || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedWrapperSlug, setSelectedWrapperSlug] = useState("nemoclaw");
  const [wrapperJson, setWrapperJson] = useState("");
  const [wrapperError, setWrapperError] = useState("");

  const { data: env, isLoading: envLoading } = useGetEnvironment(
    tenantId,
    workspaceId,
    environmentId,
    {
      query: {
        enabled: !!(tenantId && workspaceId && environmentId),
        queryKey: getGetEnvironmentQueryKey(tenantId, workspaceId, environmentId),
      },
    },
  );

  const { data: deployments, isLoading: depsLoading } = useListDeployments(
    tenantId,
    environmentId,
    {},
    {
      query: {
        enabled: !!(tenantId && environmentId),
        queryKey: getListDeploymentsQueryKey(tenantId, environmentId, {}),
      },
    },
  );

  const { data: catalog } = useQuery({
    queryKey: assistantCatalogQueryKey(tenantId),
    queryFn: () => fetchAssistantCatalog(tenantId),
    enabled: !!tenantId,
  });

  const wrappers = catalog?.wrappers ?? [];
  const wrappersBySlug = useMemo(
    () => new Map(wrappers.map((wrapper) => [wrapper.slug, wrapper])),
    [wrappers],
  );
  const envMetadata = asRecord(env?.metadata) ?? {};
  const currentWrapper = asRecord(envMetadata.wrapper);
  const updateEnvironmentMutation = useUpdateEnvironment();

  useEffect(() => {
    if (!env || wrappers.length === 0) return;
    const slug = readString(currentWrapper, "slug") ?? "nemoclaw";
    const catalogWrapper = wrappersBySlug.get(slug) ?? wrappers[0];
    if (!catalogWrapper) return;

    setSelectedWrapperSlug(catalogWrapper.slug);
    setWrapperJson(
      currentWrapper ? JSON.stringify(currentWrapper, null, 2) : wrapperDraft(catalogWrapper),
    );
  }, [currentWrapper, env, wrappers, wrappersBySlug]);

  const handleWrapperChange = (slug: string) => {
    const wrapper = wrappersBySlug.get(slug);
    setSelectedWrapperSlug(slug);
    setWrapperError("");
    if (wrapper) setWrapperJson(wrapperDraft(wrapper));
  };

  const handleSaveWrapper = async () => {
    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(wrapperJson) as unknown;
      const record = asRecord(value);
      if (!record) throw new Error("Wrapper config must be a JSON object");
      parsed = record;
    } catch (err) {
      setWrapperError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }

    try {
      await updateEnvironmentMutation.mutateAsync({
        tenantId,
        workspaceId,
        environmentId,
        data: {
          metadata: {
            ...envMetadata,
            wrapper: {
              ...parsed,
              slug: readString(parsed, "slug") ?? selectedWrapperSlug,
              updatedAt: new Date().toISOString(),
            },
          },
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetEnvironmentQueryKey(tenantId, workspaceId, environmentId),
      });
      toast({
        title: "Wrapper updated",
        description: "The environment wrapper configuration was saved.",
      });
      setWrapperError("");
    } catch (err) {
      toast({
        title: "Failed to update wrapper",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  if (envLoading) return <div className="p-8"><div className="h-8 w-48 bg-muted animate-pulse rounded" /></div>;

  return (
    <div className="p-8">
      <Link
        href={`/workspaces/${workspaceId}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        data-testid="link-back-workspace"
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to Workspace
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight mb-2" data-testid="text-environment-name">{env?.name}</h1>
        <div className="flex gap-4 items-center">
          <Badge variant={env?.status === "active" ? "default" : "secondary"}>{env?.status}</Badge>
          <Badge variant="outline" className="capitalize">{env?.type}</Badge>
          <span className="text-sm font-mono text-muted-foreground" data-testid="text-environment-id">{env?.id}</span>
        </div>
      </div>

      <div className="mb-8 overflow-hidden rounded-lg border bg-card">
        <div className="border-b bg-muted/50 px-6 py-3">
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Wrapper Environment
          </div>
        </div>
        <div className="grid gap-4 p-6 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            <Label>Wrapper</Label>
            <Select value={selectedWrapperSlug} onValueChange={handleWrapperChange}>
              <SelectTrigger data-testid="select-environment-wrapper">
                <SelectValue placeholder="Choose wrapper" />
              </SelectTrigger>
              <SelectContent>
                {wrappers.map((wrapper) => (
                  <SelectItem key={wrapper.slug} value={wrapper.slug}>
                    {wrapper.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentWrapper && (
              <div className="pt-2 text-xs text-muted-foreground">
                {readString(currentWrapper, "name") ?? selectedWrapperSlug}
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="wrapperJson">Wrapper JSON</Label>
              <Textarea
                id="wrapperJson"
                value={wrapperJson}
                onChange={(event) => setWrapperJson(event.target.value)}
                className="min-h-52 font-mono text-xs"
                spellCheck={false}
                data-testid="textarea-environment-wrapper"
              />
            </div>
            {wrapperError && (
              <p className="text-sm text-destructive">{wrapperError}</p>
            )}
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={handleSaveWrapper}
                disabled={updateEnvironmentMutation.isPending || !wrapperJson.trim()}
                data-testid="button-save-environment-wrapper"
              >
                <Save className="mr-2 h-4 w-4" />
                {updateEnvironmentMutation.isPending ? "Saving..." : "Save Wrapper"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight">Deployments in Environment</h2>
      </div>

      {depsLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => <div key={i} className="h-16 bg-card border rounded-lg animate-pulse" />)}
        </div>
      ) : (deployments?.items ?? []).length === 0 ? (
        <div className="text-center py-20 bg-card rounded-lg border border-dashed">
          <Activity className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No deployments in this environment</h3>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-6 py-3 font-medium text-muted-foreground">ID</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Package Version</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(deployments?.items ?? []).map((d) => (
                <tr key={d.id} className="hover:bg-muted/50 transition-colors" data-testid={`row-deployment-${d.id}`}>
                  <td className="px-6 py-4 font-mono text-primary">{d.id}</td>
                  <td className="px-6 py-4 font-mono text-muted-foreground">{d.packageVersionId}</td>
                  <td className="px-6 py-4">
                    <Badge variant={d.status === "active" ? "default" : d.status === "failed" ? "destructive" : "secondary"}>
                      {d.status}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-right text-muted-foreground">
                    {new Date(d.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

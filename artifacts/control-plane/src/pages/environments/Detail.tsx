import { useParams } from "wouter";
import { useGetEnvironment, getGetEnvironmentQueryKey, useListDeployments, getListDeploymentsQueryKey } from "@workspace/api-client-react";
import { ArrowLeft, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

export default function EnvironmentDetail() {
  const params = useParams<{ tenantId: string; workspaceId: string; environmentId: string }>();
  const tenantId = params.tenantId || "";
  const workspaceId = params.workspaceId || "";
  const environmentId = params.environmentId || "";

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

      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight">Deployments in Environment</h2>
      </div>

      {depsLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => <div key={i} className="h-16 bg-card border rounded-lg animate-pulse" />)}
        </div>
      ) : deployments?.items.length === 0 ? (
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
              {deployments?.items.map((d) => (
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

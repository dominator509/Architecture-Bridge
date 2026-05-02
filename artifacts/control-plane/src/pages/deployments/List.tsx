import { useState } from "react";
import { useParams } from "wouter";
import {
  useListAllDeployments,
  getListAllDeploymentsQueryKey,
  useCreateDeployment,
  useUpdateDeployment,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Activity, Play, Square, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function DeploymentList() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId || "";
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [environmentId, setEnvironmentId] = useState("");
  const [packageVersionId, setPackageVersionId] = useState("");

  const { data, isLoading } = useListAllDeployments(tenantId, {}, {
    query: {
      enabled: !!tenantId,
      queryKey: getListAllDeploymentsQueryKey(tenantId, {}),
    },
  });

  const createMutation = useCreateDeployment();
  const updateMutation = useUpdateDeployment();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { tenantId, environmentId, data: { packageVersionId } },
      {
        onSuccess: () => {
          setIsCreateOpen(false);
          setEnvironmentId("");
          setPackageVersionId("");
          queryClient.invalidateQueries({ queryKey: getListAllDeploymentsQueryKey(tenantId, {}) });
        },
      },
    );
  };

  const handleUpdateStatus = (id: string, status: "active" | "stopped" | "failed" | "pending") => {
    updateMutation.mutate(
      { tenantId, deploymentId: id, data: { status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAllDeploymentsQueryKey(tenantId, {}) });
        },
      },
    );
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Deployments</h1>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-deployment">
              <Plus className="mr-2 h-4 w-4" /> New Deployment
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Deployment</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="envId">Environment ID</Label>
                <Input
                  id="envId"
                  value={environmentId}
                  onChange={(e) => setEnvironmentId(e.target.value)}
                  placeholder="env_xyz123"
                  required
                  data-testid="input-environment-id"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pvId">Package Version ID</Label>
                <Input
                  id="pvId"
                  value={packageVersionId}
                  onChange={(e) => setPackageVersionId(e.target.value)}
                  placeholder="pkgv_abc456"
                  required
                  data-testid="input-package-version-id"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-deployment">
                  {createMutation.isPending ? "Creating..." : "Deploy"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-card border rounded-lg animate-pulse" />)}
        </div>
      ) : data?.items.length === 0 ? (
        <div className="text-center py-20 bg-card rounded-lg border border-dashed">
          <Activity className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No deployments</h3>
          <p className="text-muted-foreground mt-1">Create a deployment to get started.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-6 py-3 font-medium text-muted-foreground">ID</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Environment</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Package Version</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Created</th>
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data?.items.map((d) => (
                <tr key={d.id} className="hover:bg-muted/50 transition-colors" data-testid={`row-deployment-${d.id}`}>
                  <td className="px-6 py-4 font-mono font-medium text-primary">{d.id}</td>
                  <td className="px-6 py-4 font-mono text-muted-foreground">{d.environmentId}</td>
                  <td className="px-6 py-4 font-mono text-muted-foreground">{d.packageVersionId}</td>
                  <td className="px-6 py-4">
                    <Badge variant={d.status === "active" ? "default" : d.status === "failed" ? "destructive" : "secondary"}>
                      {d.status}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {new Date(d.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" data-testid={`button-options-${d.id}`}>Options</Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleUpdateStatus(d.id, "active")}>
                          <Play className="mr-2 h-4 w-4" /> Start
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleUpdateStatus(d.id, "stopped")}>
                          <Square className="mr-2 h-4 w-4" /> Stop
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleUpdateStatus(d.id, "pending")}>
                          <RefreshCcw className="mr-2 h-4 w-4" /> Restart
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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

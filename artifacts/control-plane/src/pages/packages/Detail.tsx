import { useState } from "react";
import { Link, useParams } from "wouter";
import { useGetPackage, getGetPackageQueryKey, useListPackageVersions, getListPackageVersionsQueryKey, useCreatePackageVersion } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, ArrowLeft, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export default function PackageDetail() {
  const params = useParams<{ tenantId: string, packageId: string }>();
  const tenantId = params.tenantId || "";
  const packageId = params.packageId || "";
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [version, setVersion] = useState("");
  const [manifestStr, setManifestStr] = useState("{\n  \"type\": \"agent\",\n  \"capabilities\": []\n}");

  const { data: pkg, isLoading: pkgLoading } = useGetPackage(tenantId, packageId, {
    query: {
      enabled: !!(tenantId && packageId),
      queryKey: getGetPackageQueryKey(tenantId, packageId)
    }
  });

  const { data: versions, isLoading: versionsLoading } = useListPackageVersions(tenantId, packageId, {}, {
    query: {
      enabled: !!(tenantId && packageId),
      queryKey: getListPackageVersionsQueryKey(tenantId, packageId, {})
    }
  });

  const createMutation = useCreatePackageVersion();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const manifest = JSON.parse(manifestStr);
      createMutation.mutate(
        { tenantId, packageId, data: { version, manifest } },
        {
          onSuccess: () => {
            setIsCreateOpen(false);
            setVersion("");
            setManifestStr("{\n  \"type\": \"agent\",\n  \"capabilities\": []\n}");
            queryClient.invalidateQueries({ queryKey: getListPackageVersionsQueryKey(tenantId, packageId, {}) });
          }
        }
      );
    } catch (err) {
      alert("Invalid JSON in manifest");
    }
  };

  if (pkgLoading) return <div className="p-8"><div className="h-8 w-48 bg-muted animate-pulse rounded" /></div>;

  return (
    <div className="p-8">
      <Link href={`/tenants/${tenantId}/packages`} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to Packages
      </Link>
      
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight mb-2">{pkg?.name}</h1>
        <div className="flex gap-4 items-center">
          <Badge variant={pkg?.status === 'active' ? 'default' : 'secondary'}>{pkg?.status}</Badge>
          <span className="text-sm font-mono text-muted-foreground">{pkg?.id}</span>
        </div>
        {pkg?.description && <p className="mt-4 text-muted-foreground">{pkg.description}</p>}
      </div>

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold tracking-tight">Versions</h2>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-version">
              <Plus className="mr-2 h-4 w-4" /> New Version
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Package Version</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="version">Version (e.g. 1.0.0)</Label>
                <Input 
                  id="version" 
                  value={version} 
                  onChange={(e) => setVersion(e.target.value)} 
                  required
                  data-testid="input-version"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manifest">Manifest (JSON)</Label>
                <Textarea 
                  id="manifest" 
                  value={manifestStr} 
                  onChange={(e) => setManifestStr(e.target.value)} 
                  required
                  className="font-mono text-xs h-40"
                  data-testid="input-manifest"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-version">
                  {createMutation.isPending ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {versionsLoading ? (
        <div className="space-y-4">
          {[1, 2].map(i => <div key={i} className="h-16 bg-card border rounded-lg animate-pulse" />)}
        </div>
      ) : versions?.items.length === 0 ? (
        <div className="text-center py-20 bg-card rounded-lg border border-dashed">
          <Layers className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No versions</h3>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-6 py-3 font-medium text-muted-foreground">Version</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">ID</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {versions?.items.map(v => (
                <tr key={v.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-6 py-4 font-medium font-mono">{v.version}</td>
                  <td className="px-6 py-4 font-mono text-muted-foreground">{v.id}</td>
                  <td className="px-6 py-4">
                    <Badge variant={v.status === 'published' ? 'default' : 'secondary'}>{v.status}</Badge>
                  </td>
                  <td className="px-6 py-4 text-right text-muted-foreground">
                    {new Date(v.createdAt).toLocaleDateString()}
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

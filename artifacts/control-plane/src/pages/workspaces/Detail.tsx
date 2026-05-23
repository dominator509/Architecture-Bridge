import { useState } from "react";
import { Link, useParams } from "wouter";
import { useGetWorkspace, getGetWorkspaceQueryKey, useListEnvironments, getListEnvironmentsQueryKey, useCreateEnvironment } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Box, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function WorkspaceDetail() {
  const params = useParams<{ tenantId: string, workspaceId: string }>();
  const tenantId = params.tenantId || "";
  const workspaceId = params.workspaceId || "";
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState<"development" | "staging" | "production">("development");

  const { data: workspace, isLoading: wsLoading } = useGetWorkspace(tenantId, workspaceId, {
    query: {
      enabled: !!(tenantId && workspaceId),
      queryKey: getGetWorkspaceQueryKey(tenantId, workspaceId)
    }
  });

  const { data: envs, isLoading: envsLoading } = useListEnvironments(tenantId, workspaceId, {}, {
    query: {
      enabled: !!(tenantId && workspaceId),
      queryKey: getListEnvironmentsQueryKey(tenantId, workspaceId, {})
    }
  });

  const createMutation = useCreateEnvironment();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { tenantId, workspaceId, data: { name, slug, type } },
      {
        onSuccess: () => {
          setIsCreateOpen(false);
          setName("");
          setSlug("");
          setType("development");
          queryClient.invalidateQueries({ queryKey: getListEnvironmentsQueryKey(tenantId, workspaceId, {}) });
        }
      }
    );
  };

  const filtered = envs?.items.filter(e => 
    e.name.toLowerCase().includes(search.toLowerCase()) || 
    e.id.toLowerCase().includes(search.toLowerCase())
  ) || [];

  if (wsLoading) return <div className="p-8"><div className="h-8 w-48 bg-muted animate-pulse rounded" /></div>;

  return (
    <div className="p-8">
      <Link href="/workspaces" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to Workspaces
      </Link>
      
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight mb-2">{workspace?.name}</h1>
        <div className="flex gap-4 items-center">
          <Badge variant={workspace?.status === 'active' ? 'default' : 'secondary'}>{workspace?.status}</Badge>
          <span className="text-sm font-mono text-muted-foreground">{workspace?.id}</span>
        </div>
      </div>

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold tracking-tight">Environments</h2>
        <div className="flex items-center gap-4">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search environments..." 
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-environments"
            />
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-environment">
                <Plus className="mr-2 h-4 w-4" /> New Environment
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Environment</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Environment Name</Label>
                  <Input 
                    id="name" 
                    value={name} 
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''));
                    }} 
                    required
                    data-testid="input-env-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">Slug</Label>
                  <Input 
                    id="slug" 
                    value={slug} 
                    onChange={(e) => setSlug(e.target.value)} 
                    required
                    data-testid="input-env-slug"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <Select value={type} onValueChange={(val: any) => setType(val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="development">Development</SelectItem>
                      <SelectItem value="staging">Staging</SelectItem>
                      <SelectItem value="production">Production</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-env">
                    {createMutation.isPending ? "Creating..." : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {envsLoading ? (
        <div className="space-y-4">
          {[1, 2].map(i => <div key={i} className="h-16 bg-card border rounded-lg animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-card rounded-lg border border-dashed">
          <Box className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No environments</h3>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-6 py-3 font-medium text-muted-foreground">Name</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Type</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(e => (
                <tr key={e.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-6 py-4 font-medium">
                    <Link href={`/workspaces/${workspaceId}/environments/${e.id}`} className="text-primary hover:underline" data-testid={`link-env-${e.id}`}>
                      {e.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 capitalize">{e.type}</td>
                  <td className="px-6 py-4">
                    <Badge variant={e.status === 'active' ? 'default' : 'secondary'}>{e.status}</Badge>
                  </td>
                  <td className="px-6 py-4 text-right text-muted-foreground">
                    {new Date(e.createdAt).toLocaleDateString()}
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

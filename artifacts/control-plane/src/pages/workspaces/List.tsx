import { useState } from "react";
import { Link, useParams } from "wouter";
import { useListWorkspaces, getListWorkspacesQueryKey, useCreateWorkspace } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Box } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

export default function WorkspaceList() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const { data, isLoading } = useListWorkspaces(tenantId, {}, {
    query: {
      enabled: !!tenantId,
      queryKey: getListWorkspacesQueryKey(tenantId, {})
    }
  });

  const createMutation = useCreateWorkspace();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { tenantId, data: { name, slug } },
      {
        onSuccess: (workspace) => {
          setIsCreateOpen(false);
          setName("");
          setSlug("");
          queryClient.invalidateQueries({ queryKey: getListWorkspacesQueryKey(tenantId, {}) });
          toast({ title: "Workspace created", description: `"${workspace.name}" is ready.` });
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? err?.message ?? "Unknown error";
          toast({ title: "Failed to create workspace", description: msg, variant: "destructive" });
        },
      }
    );
  };

  const filtered = (data?.items ?? []).filter(w =>
    w.name.toLowerCase().includes(search.toLowerCase()) ||
    w.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Workspaces</h1>
        <div className="flex items-center gap-4">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search workspaces..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-workspaces"
            />
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-workspace">
                <Plus className="mr-2 h-4 w-4" /> New Workspace
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Workspace</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Workspace Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''));
                    }}
                    required
                    data-testid="input-workspace-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">Slug</Label>
                  <Input
                    id="slug"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    required
                    data-testid="input-workspace-slug"
                  />
                  <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens only.</p>
                </div>
                {createMutation.error && (
                  <p className="text-sm text-destructive">
                    {(createMutation.error as any)?.response?.data?.error ?? "An error occurred"}
                  </p>
                )}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-workspace">
                    {createMutation.isPending ? "Creating..." : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-card border rounded-lg animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-card rounded-lg border border-dashed">
          <Box className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No workspaces</h3>
          <p className="text-muted-foreground text-sm mt-1">Create a workspace to get started.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-6 py-3 font-medium text-muted-foreground">Name</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">ID</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(w => (
                <tr key={w.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-6 py-4 font-medium">
                    <Link href={`/workspaces/${w.id}`} className="text-primary hover:underline" data-testid={`link-workspace-${w.id}`}>
                      {w.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 font-mono text-muted-foreground">{w.id}</td>
                  <td className="px-6 py-4">
                    <Badge variant={w.status === 'active' ? 'default' : 'secondary'}>{w.status}</Badge>
                  </td>
                  <td className="px-6 py-4 text-right text-muted-foreground">
                    {new Date(w.createdAt).toLocaleDateString()}
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

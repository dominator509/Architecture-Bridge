import { useState } from "react";
import { Link } from "wouter";
import { useListTenants, getListTenantsQueryKey, useCreateTenant } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Building2, Server, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export default function TenantList() {
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTenantName, setNewTenantName] = useState("");
  const [newTenantSlug, setNewTenantSlug] = useState("");

  const queryClient = useQueryClient();
  
  const { data, isLoading } = useListTenants({}, {
    query: { queryKey: getListTenantsQueryKey({}) }
  });

  const createTenant = useCreateTenant();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createTenant.mutate(
      { data: { name: newTenantName, slug: newTenantSlug } },
      {
        onSuccess: () => {
          setIsCreateOpen(false);
          setNewTenantName("");
          setNewTenantSlug("");
          queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey({}) });
        }
      }
    );
  };

  const filteredTenants = data?.items.filter(t => 
    t.name.toLowerCase().includes(search.toLowerCase()) || 
    t.id.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <Server className="h-6 w-6 text-primary mr-2" />
              <h1 className="text-xl font-bold text-card-foreground tracking-tight">Control Plane</h1>
            </div>
            <div>
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-new-tenant">
                    <Plus className="mr-2 h-4 w-4" /> New Tenant
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Tenant</DialogTitle>
                    <DialogDescription>
                      Provision a new isolated environment for a tenant.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleCreate} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Tenant Name</Label>
                      <Input 
                        id="name" 
                        value={newTenantName} 
                        onChange={(e) => {
                          setNewTenantName(e.target.value);
                          if (!newTenantSlug) {
                            setNewTenantSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''));
                          }
                        }} 
                        placeholder="Acme Corp" 
                        required
                        data-testid="input-tenant-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="slug">Slug</Label>
                      <Input 
                        id="slug" 
                        value={newTenantSlug} 
                        onChange={(e) => setNewTenantSlug(e.target.value)} 
                        placeholder="acme-corp" 
                        required
                        data-testid="input-tenant-slug"
                      />
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                      <Button type="submit" disabled={createTenant.isPending} data-testid="button-submit-tenant">
                        {createTenant.isPending ? "Creating..." : "Create Tenant"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold tracking-tight">Tenants</h2>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search tenants..." 
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-tenants"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-40 bg-card rounded-lg border border-border animate-pulse" />
            ))}
          </div>
        ) : filteredTenants.length === 0 ? (
          <div className="text-center py-20 bg-card rounded-lg border border-border border-dashed">
            <Building2 className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-card-foreground">No tenants found</h3>
            <p className="text-muted-foreground mt-1 mb-4">Get started by creating a new tenant.</p>
            <Button onClick={() => setIsCreateOpen(true)} variant="outline">
              Create Tenant
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTenants.map((tenant) => (
              <Link key={tenant.id} href={`/tenants/${tenant.id}`} className="block group" data-testid={`card-tenant-${tenant.id}`}>
                <div className="h-full bg-card hover:bg-accent hover:border-accent border border-border rounded-lg p-6 transition-all duration-200 hover:shadow-md flex flex-col relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />
                  
                  <div className="flex justify-between items-start mb-4">
                    <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <Badge variant={tenant.status === 'active' ? 'default' : 'secondary'} className="capitalize">
                      {tenant.status}
                    </Badge>
                  </div>
                  
                  <h3 className="text-xl font-bold mb-1 text-card-foreground truncate">{tenant.name}</h3>
                  <p className="text-sm text-muted-foreground font-mono mb-4 truncate">{tenant.id}</p>
                  
                  <div className="mt-auto pt-4 border-t border-border flex items-center justify-between text-sm text-muted-foreground group-hover:text-primary transition-colors">
                    <span>Manage tenant</span>
                    <ArrowRight className="h-4 w-4 transform group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

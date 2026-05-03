import { useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useGetTenant, getGetTenantQueryKey } from "@workspace/api-client-react";
import {
  LayoutDashboard,
  Box,
  Layers,
  Activity,
  ShieldCheck,
  FileTerminal,
  ArrowLeft,
  Server,
  BookOpen,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const navItems = [
  { href: "", label: "Overview", icon: LayoutDashboard, end: true },
  { href: "/workspaces", label: "Workspaces", icon: Box },
  { href: "/packages", label: "Packages", icon: Layers },
  { href: "/deployments", label: "Deployments", icon: Activity },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/audit", label: "Audit Log", icon: FileTerminal },
  { href: "/action-ledger", label: "Action Ledger", icon: BookOpen },
  { href: "/policy", label: "Policy", icon: Server },
];

export function TenantLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId || "";

  const { data: tenant, isLoading } = useGetTenant(tenantId, {
    query: {
      enabled: !!tenantId,
      queryKey: getGetTenantQueryKey(tenantId)
    }
  });

  const basePath = `/tenants/${tenantId}`;

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="hidden md:flex w-64 border-r border-border bg-card flex-col">
        <div className="p-4 border-b border-border">
          <Link href="/" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors" data-testid="link-back-tenants">
            <ArrowLeft className="mr-1 h-3 w-3" />
            Back to Tenants
          </Link>
          {isLoading ? (
            <div className="h-6 w-32 bg-muted rounded animate-pulse" />
          ) : (
            <div>
              <h2 className="font-bold text-lg text-card-foreground tracking-tight truncate" data-testid="text-tenant-name">
                {tenant?.name || "Unknown Tenant"}
              </h2>
              <p className="text-xs text-muted-foreground font-mono truncate" data-testid="text-tenant-id">
                {tenant?.id}
              </p>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          {navItems.map((item) => {
            const href = `${basePath}${item.href}`;
            const isActive = item.end ? location === href : location.startsWith(href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={href}
                className={cn(
                  "flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors group",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Icon className={cn(
                  "mr-3 h-4 w-4 flex-shrink-0 transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                )} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Tenant</p>
            <p className="truncate font-medium text-sm" data-testid="mobile-tenant-name">
              {tenant?.name || "Unknown Tenant"}
            </p>
          </div>
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Open navigation">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[85vw] max-w-sm p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Tenant navigation</SheetTitle>
              </SheetHeader>
              <div className="flex h-full flex-col">
                <div className="p-4 border-b border-border">
                  <Link
                    href="/"
                    className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors"
                    data-testid="mobile-link-back-tenants"
                    onClick={() => setMobileNavOpen(false)}
                  >
                    <ArrowLeft className="mr-1 h-3 w-3" />
                    Back to Tenants
                  </Link>
                  <div>
                    <h2 className="font-bold text-lg text-card-foreground tracking-tight truncate">
                      {tenant?.name || "Unknown Tenant"}
                    </h2>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {tenant?.id}
                    </p>
                  </div>
                </div>
                <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
                  {navItems.map((item) => {
                    const href = `${basePath}${item.href}`;
                    const isActive = item.end ? location === href : location.startsWith(href);
                    const Icon = item.icon;

                    return (
                      <Link
                        key={item.href}
                        href={href}
                        onClick={() => setMobileNavOpen(false)}
                        className={cn(
                          "flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors group",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <Icon className={cn(
                          "mr-3 h-4 w-4 flex-shrink-0 transition-colors",
                          isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                        )} />
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        <main className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto">
          <div className="h-full relative min-w-0">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

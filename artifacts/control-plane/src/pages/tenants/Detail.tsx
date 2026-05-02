import { useParams } from "wouter";
import { useGetTenantSummary, getGetTenantSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Box, Layers, Activity, ShieldCheck, FileTerminal } from "lucide-react";

export default function TenantDetail() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId || "";

  const { data: summary, isLoading } = useGetTenantSummary(tenantId, {
    query: {
      enabled: !!tenantId,
      queryKey: getGetTenantSummaryQueryKey(tenantId)
    }
  });

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="h-5 w-24 bg-muted rounded" />
                <div className="h-4 w-4 bg-muted rounded-full" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-16 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const stats = [
    { label: "Workspaces", value: summary?.workspaceCount || 0, icon: Box },
    { label: "Environments", value: summary?.environmentCount || 0, icon: Box },
    { label: "Packages", value: summary?.packageCount || 0, icon: Layers },
    { label: "Active Deployments", value: summary?.activeDeploymentCount || 0, icon: Activity },
    { label: "Pending Approvals", value: summary?.pendingApprovalCount || 0, icon: ShieldCheck },
    { label: "Recent Audit Events", value: summary?.recentAuditEventCount || 0, icon: FileTerminal },
  ];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Tenant Overview</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, '-')}`}>
                  {stat.value}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

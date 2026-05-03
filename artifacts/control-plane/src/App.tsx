import { Switch, Route, Router as WouterRouter, useParams } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import NotFound from "@/pages/not-found";

import TenantList from "@/pages/tenants/List";
import TenantDetail from "@/pages/tenants/Detail";
import WorkspaceList from "@/pages/workspaces/List";
import WorkspaceDetail from "@/pages/workspaces/Detail";
import EnvironmentDetail from "@/pages/environments/Detail";
import PackageList from "@/pages/packages/List";
import PackageDetail from "@/pages/packages/Detail";
import DeploymentList from "@/pages/deployments/List";
import ApprovalList from "@/pages/approvals/List";
import AuditList from "@/pages/audit/List";
import ActionLedgerList from "@/pages/action-ledger/List";
import PolicyPlayground from "@/pages/policy/Playground";
import { TenantLayout } from "@/components/layout/TenantLayout";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function TenantRoutes() {
  const { tenantId } = useParams<{ tenantId: string }>();
  return (
    <WouterRouter base={`/tenants/${tenantId}`}>
      <TenantLayout>
        <ErrorBoundary>
          <Switch>
            <Route path="/" component={TenantDetail} />

            {/* Workspaces & Environments */}
            <Route path="/workspaces" component={WorkspaceList} />
            <Route path="/workspaces/:workspaceId" component={WorkspaceDetail} />
            <Route path="/workspaces/:workspaceId/environments/:environmentId" component={EnvironmentDetail} />

            {/* Packages */}
            <Route path="/packages" component={PackageList} />
            <Route path="/packages/:packageId" component={PackageDetail} />

            {/* Deployments */}
            <Route path="/deployments" component={DeploymentList} />

            {/* Approvals */}
            <Route path="/approvals" component={ApprovalList} />

            {/* Audit Log */}
            <Route path="/audit" component={AuditList} />

            {/* Action Ledger */}
            <Route path="/action-ledger" component={ActionLedgerList} />

            {/* Policy (Playground + Decision History) */}
            <Route path="/policy" component={PolicyPlayground} />

            <Route component={NotFound} />
          </Switch>
        </ErrorBoundary>
      </TenantLayout>
    </WouterRouter>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={TenantList} />
      <Route path="/tenants/:tenantId/*?" component={TenantRoutes} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;

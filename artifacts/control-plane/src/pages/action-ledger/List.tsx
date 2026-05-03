import { useState } from "react";
import { useParams } from "wouter";
import { useListActionLedger, getListActionLedgerQueryKey } from "@workspace/api-client-react";
import { BookOpen, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";

type LedgerStatus =
  | "attempted"
  | "blocked"
  | "approval_required"
  | "approved"
  | "executed"
  | "cancelled"
  | "failed";

const STATUS_CONFIG: Record<LedgerStatus, { label: string; className: string }> = {
  attempted:        { label: "attempted",        className: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  blocked:          { label: "blocked",          className: "bg-red-500/10 text-red-400 border-red-500/30" },
  approval_required:{ label: "approval required", className: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  approved:         { label: "approved",         className: "bg-green-500/10 text-green-400 border-green-500/30" },
  executed:         { label: "executed",         className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  cancelled:        { label: "cancelled",        className: "text-muted-foreground border-border" },
  failed:           { label: "failed",           className: "bg-red-500/10 text-red-400 border-red-500/30" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as LedgerStatus];
  const label = cfg?.label ?? status;
  const cls = cfg?.className ?? "text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {label}
    </span>
  );
}

export default function ActionLedgerList() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId || "";
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<string>("all");

  const queryParams = statusFilter !== "all" ? { status: statusFilter as LedgerStatus } : {};

  const { data, isLoading } = useListActionLedger(tenantId, queryParams, {
    query: {
      enabled: !!tenantId,
      queryKey: getListActionLedgerQueryKey(tenantId, queryParams),
    },
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getListActionLedgerQueryKey(tenantId, queryParams) });
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Action Ledger</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Immutable evidence trail of every policy-evaluated action.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCcw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <Label className="text-sm">Filter by status:</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="attempted">attempted</SelectItem>
            <SelectItem value="blocked">blocked</SelectItem>
            <SelectItem value="approval_required">approval_required</SelectItem>
            <SelectItem value="approved">approved</SelectItem>
            <SelectItem value="executed">executed</SelectItem>
            <SelectItem value="cancelled">cancelled</SelectItem>
            <SelectItem value="failed">failed</SelectItem>
          </SelectContent>
        </Select>
        {data && (
          <span className="text-sm text-muted-foreground ml-auto">
            {data.total} {data.total === 1 ? "entry" : "entries"}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-16 bg-card border rounded-lg animate-pulse" />)}
        </div>
      ) : data?.items.length === 0 ? (
        <div className="text-center py-20 bg-card rounded-lg border border-dashed">
          <BookOpen className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No ledger entries</h3>
          <p className="text-muted-foreground text-sm mt-1">
            Entries appear when policy-evaluated actions are attempted.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-4 py-3 font-medium text-muted-foreground">ID</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Actor</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Action</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Policy Decision</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Linked</th>
                <th className="px-4 py-3 font-medium text-muted-foreground text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data?.items.map(entry => (
                <tr key={entry.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{entry.id}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs font-medium">{entry.actorType}</div>
                    <div className="text-xs text-muted-foreground font-mono">{entry.actorId}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{entry.actionType}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={entry.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {entry.policyDecisionId ? (
                      <span title={entry.policyDecisionId}>
                        {entry.policyDecisionId.slice(0, 16)}…
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {entry.approvalRequestId ? (
                      <span className="text-amber-400" title={entry.approvalRequestId}>apr_…</span>
                    ) : entry.deploymentId ? (
                      <span className="text-emerald-400" title={entry.deploymentId}>dep_…</span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    <div>{new Date(entry.createdAt).toLocaleDateString()}</div>
                    <div>{new Date(entry.createdAt).toLocaleTimeString()}</div>
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

import { useState } from "react";
import { useParams } from "wouter";
import {
  useListApprovalRequests, getListApprovalRequestsQueryKey,
  useCreateApprovalRequest,
  useSubmitApprovalDecision
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck, Check, X, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export default function ApprovalList() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId || "";
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [resourceType, setResourceType] = useState("deployment");
  const [resourceId, setResourceId] = useState("");
  const [action, setAction] = useState("promote");
  const [requesterId, setRequesterId] = useState("usr_requester_001");

  const [decisionTarget, setDecisionTarget] = useState<{ id: string; decision: "approved" | "rejected" } | null>(null);
  const [reviewerId, setReviewerId] = useState("reviewer_001");

  const { data, isLoading } = useListApprovalRequests(tenantId, {}, {
    query: {
      enabled: !!tenantId,
      queryKey: getListApprovalRequestsQueryKey(tenantId, {})
    }
  });

  const createMutation = useCreateApprovalRequest();
  const decisionMutation = useSubmitApprovalDecision();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { tenantId, data: { resourceType, resourceId, action, requesterId } },
      {
        onSuccess: () => {
          setIsCreateOpen(false);
          setResourceId("");
          queryClient.invalidateQueries({ queryKey: getListApprovalRequestsQueryKey(tenantId, {}) });
        }
      }
    );
  };

  const handleDecisionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!decisionTarget) return;
    decisionMutation.mutate(
      { tenantId, approvalId: decisionTarget.id, data: { decision: decisionTarget.decision, reviewerId } },
      {
        onSuccess: () => {
          setDecisionTarget(null);
          queryClient.invalidateQueries({ queryKey: getListApprovalRequestsQueryKey(tenantId, {}) });
        }
      }
    );
  };

  const statusVariant = (status: string) => {
    if (status === "approved") return "default";
    if (status === "rejected") return "destructive";
    return "secondary";
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Approvals</h1>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-approval">
              <Plus className="mr-2 h-4 w-4" /> New Approval Request
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Approval Request</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="resourceType">Resource Type</Label>
                <Input value={resourceType} onChange={e => setResourceType(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="resourceId">Resource ID</Label>
                <Input value={resourceId} onChange={e => setResourceId(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="action">Action</Label>
                <Input value={action} onChange={e => setAction(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="requesterId">Requester ID</Label>
                <Input value={requesterId} onChange={e => setRequesterId(e.target.value)} required />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-approval">
                  {createMutation.isPending ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-card border rounded-lg animate-pulse" />)}
        </div>
      ) : (data?.items ?? []).length === 0 ? (
        <div className="text-center py-20 bg-card rounded-lg border border-dashed">
          <ShieldCheck className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No pending approvals</h3>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-6 py-3 font-medium text-muted-foreground">ID</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Resource</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Action</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Linked</th>
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(data?.items ?? []).map(a => (
                <tr key={a.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-6 py-4 font-mono font-medium text-sm">{a.id}</td>
                  <td className="px-6 py-4">
                    <div className="font-medium">{a.resourceType}</div>
                    <div className="text-xs text-muted-foreground font-mono">{a.resourceId}</div>
                  </td>
                  <td className="px-6 py-4">{a.action}</td>
                  <td className="px-6 py-4">
                    <Badge variant={statusVariant(a.status)}>{a.status}</Badge>
                  </td>
                  <td className="px-6 py-4">
                    {a.actionLedgerEntryId ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-400 font-mono" title={a.actionLedgerEntryId}>
                        <Link2 className="h-3 w-3" />
                        {a.actionLedgerEntryId.slice(0, 12)}…
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {a.status === 'pending' && (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600 border-green-600/30 hover:bg-green-600/10"
                          onClick={() => setDecisionTarget({ id: a.id, decision: "approved" })}
                        >
                          <Check className="h-4 w-4 mr-1" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 border-red-600/30 hover:bg-red-600/10"
                          onClick={() => setDecisionTarget({ id: a.id, decision: "rejected" })}
                        >
                          <X className="h-4 w-4 mr-1" /> Reject
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!decisionTarget} onOpenChange={open => { if (!open) setDecisionTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisionTarget?.decision === "approved" ? "Approve" : "Reject"} Request
            </DialogTitle>
            <DialogDescription>
              Provide your reviewer ID. It must differ from the requester to prevent self-approval.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleDecisionSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Reviewer ID</Label>
              <Input
                value={reviewerId}
                onChange={e => setReviewerId(e.target.value)}
                placeholder="reviewer_001"
                required
              />
              <p className="text-xs text-muted-foreground">
                Must be different from the requester ID to prevent self-approval.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDecisionTarget(null)}>Cancel</Button>
              <Button
                type="submit"
                disabled={decisionMutation.isPending}
                variant={decisionTarget?.decision === "approved" ? "default" : "destructive"}
              >
                {decisionMutation.isPending
                  ? "Submitting..."
                  : decisionTarget?.decision === "approved"
                  ? "Confirm Approve"
                  : "Confirm Reject"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

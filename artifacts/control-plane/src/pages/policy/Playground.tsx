import { useState } from "react";
import { useParams } from "wouter";
import {
  useEvaluatePolicy,
  useListPolicyDecisions,
  getListPolicyDecisionsQueryKey,
} from "@workspace/api-client-react";
import { Server, CheckCircle2, XCircle, Clock, AlertTriangle, History, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

type PolicyOutcome = "allow" | "deny" | "require_approval" | "require_escalation";

const OUTCOME_CONFIG: Record<PolicyOutcome, {
  icon: React.ElementType;
  label: string;
  panelClass: string;
  badgeClass: string;
}> = {
  allow: {
    icon: CheckCircle2,
    label: "ALLOWED",
    panelClass: "bg-green-500/10 text-green-500",
    badgeClass: "bg-green-500/10 text-green-500 border-green-500/30",
  },
  deny: {
    icon: XCircle,
    label: "DENIED",
    panelClass: "bg-red-500/10 text-red-500",
    badgeClass: "bg-red-500/10 text-red-500 border-red-500/30",
  },
  require_approval: {
    icon: Clock,
    label: "APPROVAL REQUIRED",
    panelClass: "bg-amber-500/10 text-amber-500",
    badgeClass: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  },
  require_escalation: {
    icon: AlertTriangle,
    label: "ESCALATION REQUIRED",
    panelClass: "bg-yellow-500/10 text-yellow-500",
    badgeClass: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30",
  },
};

function OutcomeBadge({ outcome }: { outcome: string }) {
  const cfg = OUTCOME_CONFIG[outcome as PolicyOutcome];
  if (!cfg) return <Badge variant="outline">{outcome}</Badge>;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${cfg.badgeClass}`}>
      <cfg.icon className="h-3 w-3" />
      {outcome}
    </span>
  );
}

export default function PolicyPlayground() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId || "";

  const [principalType, setPrincipalType] = useState<"user" | "agent" | "system">("user");
  const [principalId, setPrincipalId] = useState("");
  const [action, setAction] = useState("deployment:create");
  const [resourceType, setResourceType] = useState("environment");
  const [resourceId, setResourceId] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");

  const evalMutation = useEvaluatePolicy();

  const { data: decisions, isLoading: decisionsLoading } = useListPolicyDecisions(tenantId, {}, {
    query: {
      enabled: !!tenantId,
      queryKey: getListPolicyDecisionsQueryKey(tenantId, {}),
      refetchInterval: 5000,
    },
  });

  const handleEvaluate = (e: React.FormEvent) => {
    e.preventDefault();
    evalMutation.mutate({
      tenantId,
      data: {
        principal: { type: principalType, id: principalId || `${principalType}_test` },
        action,
        resource: { type: resourceType || "environment", id: resourceId || "env_test" },
      },
    });
  };

  const decision = evalMutation.data;
  const outcome = decision?.outcome as PolicyOutcome | undefined;
  const outcomeCfg = outcome ? OUTCOME_CONFIG[outcome] : null;

  const filteredDecisions = decisions?.items.filter(d =>
    outcomeFilter === "all" || d.outcome === outcomeFilter,
  ) ?? [];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Policy</h1>
        <p className="text-muted-foreground mt-1">Evaluate access control policies and review stored decisions.</p>
      </div>

      <Tabs defaultValue="playground">
        <TabsList className="mb-6">
          <TabsTrigger value="playground" className="gap-2">
            <FlaskConical className="h-4 w-4" /> Playground
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" /> Decision History
            {decisions && decisions.total > 0 && (
              <span className="ml-1 text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
                {decisions.total}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="playground">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card>
              <CardHeader>
                <CardTitle>Evaluation Request</CardTitle>
                <CardDescription>Construct a synthetic access request to test the policy engine</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleEvaluate} className="space-y-6">
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium border-b pb-2">Principal</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select value={principalType} onValueChange={(val: "user" | "agent" | "system") => setPrincipalType(val)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">User</SelectItem>
                            <SelectItem value="agent">Agent</SelectItem>
                            <SelectItem value="system">System</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>ID</Label>
                        <Input value={principalId} onChange={e => setPrincipalId(e.target.value)} placeholder="usr_123 (optional)" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-medium border-b pb-2">Action</h3>
                    <div className="space-y-2">
                      <Label>Action Name</Label>
                      <Select value={action} onValueChange={setAction}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="deployment:create">deployment:create</SelectItem>
                          <SelectItem value="deployment:status_update">deployment:status_update</SelectItem>
                          <SelectItem value="workspace:delete">workspace:delete</SelectItem>
                          <SelectItem value="package:publish">package:publish</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-medium border-b pb-2">Resource</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Input value={resourceType} onChange={e => setResourceType(e.target.value)} placeholder="environment" />
                      </div>
                      <div className="space-y-2">
                        <Label>ID</Label>
                        <Input value={resourceId} onChange={e => setResourceId(e.target.value)} placeholder="env_abc (optional)" />
                      </div>
                    </div>
                  </div>

                  <Button type="submit" disabled={evalMutation.isPending} className="w-full">
                    {evalMutation.isPending ? "Evaluating..." : "Evaluate Policy"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Evaluation Result</CardTitle>
                <CardDescription>Real-time policy engine decision (stored as pdec_)</CardDescription>
              </CardHeader>
              <CardContent>
                {!evalMutation.isIdle && evalMutation.isPending && (
                  <div className="flex items-center justify-center h-40">
                    <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  </div>
                )}

                {evalMutation.isIdle && !decision && (
                  <div className="flex flex-col items-center justify-center h-40 text-muted-foreground border border-dashed rounded-lg">
                    <Server className="h-8 w-8 mb-2 opacity-50" />
                    <p>Submit a request to see results</p>
                  </div>
                )}

                {decision && outcomeCfg && (
                  <div className="space-y-5">
                    <div className={`p-4 rounded-lg flex items-center gap-3 ${outcomeCfg.panelClass}`}>
                      <outcomeCfg.icon className="h-8 w-8 flex-shrink-0" />
                      <div>
                        <div className="text-lg font-bold">{outcomeCfg.label}</div>
                        <div className="text-sm opacity-80">{decision.reason}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Outcome</Label>
                        <div><OutcomeBadge outcome={decision.outcome} /></div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Allowed</Label>
                        <div className={decision.allowed ? "text-green-500 font-medium" : "text-red-500 font-medium"}>
                          {decision.allowed ? "Yes" : "No"}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wide">Matched Rule</Label>
                      <div className="p-2 bg-muted rounded font-mono text-sm text-muted-foreground break-all">
                        {decision.matchedRule || "None (default deny)"}
                      </div>
                    </div>

                    {decision.id && (
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Decision ID (pdec_)</Label>
                        <div className="p-2 bg-muted rounded font-mono text-xs text-muted-foreground break-all">
                          {decision.id}
                        </div>
                      </div>
                    )}

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wide">Evaluated At</Label>
                      <div className="text-sm text-muted-foreground">
                        {new Date(decision.evaluatedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history">
          <div className="mb-4 flex items-center gap-3">
            <Label className="text-sm">Filter by outcome:</Label>
            <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All outcomes</SelectItem>
                <SelectItem value="allow">allow</SelectItem>
                <SelectItem value="deny">deny</SelectItem>
                <SelectItem value="require_approval">require_approval</SelectItem>
                <SelectItem value="require_escalation">require_escalation</SelectItem>
              </SelectContent>
            </Select>
            {decisions && (
              <span className="text-sm text-muted-foreground ml-auto">
                {filteredDecisions.length} of {decisions.total} decisions
              </span>
            )}
          </div>

          {decisionsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-14 bg-card border rounded-lg animate-pulse" />)}
            </div>
          ) : filteredDecisions.length === 0 ? (
            <div className="text-center py-20 bg-card rounded-lg border border-dashed">
              <History className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No policy decisions recorded</h3>
              <p className="text-muted-foreground text-sm mt-1">Use the Playground tab to evaluate a policy</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden bg-card">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="px-4 py-3 font-medium text-muted-foreground">ID</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Principal</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Action</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Resource</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Outcome</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredDecisions.map(d => (
                    <tr key={d.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{d.id}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-xs">{d.principalType}</div>
                        <div className="text-xs text-muted-foreground font-mono">{d.principalId}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{d.action}</td>
                      <td className="px-4 py-3">
                        <div className="text-xs">{d.resourceType}</div>
                        <div className="text-xs text-muted-foreground font-mono">{d.resourceId}</div>
                      </td>
                      <td className="px-4 py-3">
                        <OutcomeBadge outcome={d.outcome} />
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {new Date(d.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

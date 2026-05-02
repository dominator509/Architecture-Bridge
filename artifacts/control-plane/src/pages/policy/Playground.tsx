import { useState } from "react";
import { useParams } from "wouter";
import { useEvaluatePolicy } from "@workspace/api-client-react";
import { Server, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function PolicyPlayground() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId || "";

  const [principalType, setPrincipalType] = useState<"user" | "agent" | "system">("user");
  const [principalId, setPrincipalId] = useState("");
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [resourceId, setResourceId] = useState("");

  const evalMutation = useEvaluatePolicy();

  const handleEvaluate = (e: React.FormEvent) => {
    e.preventDefault();
    evalMutation.mutate({
      tenantId,
      data: {
        principal: { type: principalType, id: principalId },
        action,
        resource: { type: resourceType, id: resourceId }
      }
    });
  };

  const decision = evalMutation.data;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Policy Evaluation Playground</h1>
        <p className="text-muted-foreground mt-1">Test access control policies for a given principal and resource.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Evaluation Request</CardTitle>
            <CardDescription>Construct a synthetic access request</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleEvaluate} className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-sm font-medium border-b pb-2">Principal</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={principalType} onValueChange={(val: any) => setPrincipalType(val)}>
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
                    <Input value={principalId} onChange={e => setPrincipalId(e.target.value)} required placeholder="usr_123" />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-medium border-b pb-2">Action</h3>
                <div className="space-y-2">
                  <Label>Action Name</Label>
                  <Input value={action} onChange={e => setAction(e.target.value)} required placeholder="deployments:create" />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-medium border-b pb-2">Resource</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Input value={resourceType} onChange={e => setResourceType(e.target.value)} required placeholder="environment" />
                  </div>
                  <div className="space-y-2">
                    <Label>ID</Label>
                    <Input value={resourceId} onChange={e => setResourceId(e.target.value)} required placeholder="env_abc" />
                  </div>
                </div>
              </div>

              <Button type="submit" disabled={evalMutation.isPending} className="w-full">
                {evalMutation.isPending ? "Evaluating..." : "Evaluate Policy"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader>
            <CardTitle>Evaluation Result</CardTitle>
            <CardDescription>Real-time policy engine decision</CardDescription>
          </CardHeader>
          <CardContent>
            {!evalMutation.isIdle && evalMutation.isPending && (
              <div className="flex items-center justify-center h-40">
                <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
            )}
            
            {!evalMutation.isPending && !decision && (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground border border-dashed rounded-lg">
                <Server className="h-8 w-8 mb-2 opacity-50" />
                <p>Submit a request to see results</p>
              </div>
            )}

            {decision && (
              <div className="space-y-6">
                <div className={`p-4 rounded-lg flex items-center ${decision.allowed ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                  {decision.allowed ? <CheckCircle2 className="h-8 w-8 mr-3" /> : <XCircle className="h-8 w-8 mr-3" />}
                  <div>
                    <div className="text-lg font-bold">{decision.allowed ? "ALLOWED" : "DENIED"}</div>
                    <div className="text-sm opacity-80">{decision.reason}</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Matched Rule</Label>
                  <div className="p-3 bg-muted rounded font-mono text-sm text-muted-foreground break-all">
                    {decision.matchedRule || "None"}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Evaluated At</Label>
                  <div className="text-sm text-muted-foreground">
                    {new Date(decision.evaluatedAt).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

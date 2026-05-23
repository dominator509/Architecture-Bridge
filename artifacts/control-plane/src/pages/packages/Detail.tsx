import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  getGetPackageQueryKey,
  getListPackageVersionsQueryKey,
  useCreatePackageVersion,
  useGetPackage,
  useListPackageVersions,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, Plus, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type ManifestRecord = Record<string, unknown> & {
  model?: string;
  capabilities?: string[];
  instructions?: string;
};

function splitCapabilities(value: string): string[] {
  return value
    .split(",")
    .map((capability) => capability.trim())
    .filter(Boolean);
}

function getManifest(record: unknown): ManifestRecord {
  if (!record || typeof record !== "object" || Array.isArray(record)) return {};
  return record as ManifestRecord;
}

export default function PackageDetail() {
  const params = useParams<{ tenantId: string; packageId: string }>();
  const tenantId = params.tenantId || "";
  const packageId = params.packageId || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [version, setVersion] = useState("");
  const [model, setModel] = useState("gpt-5.2");
  const [capabilities, setCapabilities] = useState("web research, file search");
  const [instructions, setInstructions] = useState("");
  const [guardrails, setGuardrails] = useState("Require approval before external sends or destructive actions.");

  const { data: pkg, isLoading: pkgLoading } = useGetPackage(
    tenantId,
    packageId,
    {
      query: {
        enabled: !!(tenantId && packageId),
        queryKey: getGetPackageQueryKey(tenantId, packageId),
      },
    },
  );

  const { data: versions, isLoading: versionsLoading } = useListPackageVersions(
    tenantId,
    packageId,
    {},
    {
      query: {
        enabled: !!(tenantId && packageId),
        queryKey: getListPackageVersionsQueryKey(tenantId, packageId, {}),
      },
    },
  );

  const createMutation = useCreatePackageVersion();

  const resetForm = () => {
    setVersion("");
    setModel("gpt-5.2");
    setCapabilities("web research, file search");
    setInstructions("");
    setGuardrails("Require approval before external sends or destructive actions.");
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();

    const manifest = {
      type: "agent",
      model,
      capabilities: splitCapabilities(capabilities),
      instructions: instructions.trim(),
      guardrails: guardrails.trim(),
      configSchemaVersion: "agent-template/v1",
    };

    createMutation.mutate(
      {
        tenantId,
        packageId,
        data: { version, manifest, status: "published" },
      },
      {
        onSuccess: () => {
          setIsCreateOpen(false);
          resetForm();
          queryClient.invalidateQueries({
            queryKey: getListPackageVersionsQueryKey(tenantId, packageId, {}),
          });
          toast({
            title: "Agent version published",
            description: `${pkg?.name ?? "Agent"} ${version} is available for deployment.`,
          });
        },
        onError: (err: any) => {
          toast({
            title: "Failed to publish agent version",
            description: err?.data?.error ?? err?.message ?? "Unknown error",
            variant: "destructive",
          });
        },
      },
    );
  };

  if (pkgLoading) {
    return (
      <div className="p-8">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="p-8">
      <Link
        href="/packages"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to Agents
      </Link>

      <div className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{pkg?.name}</h1>
            {pkg?.description && (
              <p className="mt-2 text-muted-foreground">{pkg.description}</p>
            )}
          </div>
          <Badge variant={pkg?.status === "active" ? "default" : "secondary"}>
            {pkg?.status}
          </Badge>
        </div>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight">Agent Versions</h2>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href={`/deployments?agent=${packageId}`}>
              <Rocket className="mr-2 h-4 w-4" /> Deploy Agent
            </Link>
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-version">
                <Plus className="mr-2 h-4 w-4" /> Publish Version
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Publish Agent Version</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="version">Version</Label>
                  <Input
                    id="version"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="1.0.0"
                    required
                    data-testid="input-version"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model">Default Model</Label>
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger id="model" data-testid="select-agent-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-5.2">GPT-5.2</SelectItem>
                      <SelectItem value="gpt-5.2-mini">GPT-5.2 Mini</SelectItem>
                      <SelectItem value="gpt-5.3-codex">GPT-5.3 Codex</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="capabilities">Capabilities</Label>
                <Input
                  id="capabilities"
                  value={capabilities}
                  onChange={(e) => setCapabilities(e.target.value)}
                  placeholder="web research, file search"
                  data-testid="input-capabilities"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instructions">Instructions</Label>
                <Textarea
                  id="instructions"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Summarize client intake data and prepare follow-up tasks."
                  required
                  data-testid="input-instructions"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="guardrails">Guardrails</Label>
                <Textarea
                  id="guardrails"
                  value={guardrails}
                  onChange={(e) => setGuardrails(e.target.value)}
                  data-testid="input-guardrails"
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCreateOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  data-testid="button-submit-version"
                >
                  {createMutation.isPending ? "Publishing..." : "Publish"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {versionsLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : versions?.items.length === 0 ? (
        <div className="border border-dashed bg-card py-20 text-center">
          <Bot className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-medium">No versions</h3>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-6 py-3 font-medium text-muted-foreground">Version</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Model</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Capabilities</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-6 py-3 text-right font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {versions?.items.map((agentVersion) => {
                const manifest = getManifest(agentVersion.manifest);
                const capabilityList = Array.isArray(manifest.capabilities)
                  ? manifest.capabilities.join(", ")
                  : "Not set";

                return (
                  <tr key={agentVersion.id} className="transition-colors hover:bg-muted/50">
                    <td className="px-6 py-4 font-mono font-medium">
                      {agentVersion.version}
                    </td>
                    <td className="px-6 py-4">{manifest.model ?? "Default"}</td>
                    <td className="max-w-md truncate px-6 py-4 text-muted-foreground">
                      {capabilityList}
                    </td>
                    <td className="px-6 py-4">
                      <Badge
                        variant={
                          agentVersion.status === "published"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {agentVersion.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right text-muted-foreground">
                      {new Date(agentVersion.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

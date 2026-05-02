import { useState } from "react";
import { useParams } from "wouter";
import { useListAuditEvents, getListAuditEventsQueryKey } from "@workspace/api-client-react";
import { FileTerminal, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export default function AuditList() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId || "";

  const [search, setSearch] = useState("");

  const { data, isLoading } = useListAuditEvents(tenantId, {}, {
    query: {
      enabled: !!tenantId,
      queryKey: getListAuditEventsQueryKey(tenantId, {})
    }
  });

  const filtered = data?.items.filter(a => 
    a.eventType.toLowerCase().includes(search.toLowerCase()) || 
    a.resourceId.toLowerCase().includes(search.toLowerCase()) ||
    a.actorId.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search events..." 
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-16 bg-card border rounded-lg animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-card rounded-lg border border-dashed">
          <FileTerminal className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No audit events</h3>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-6 py-3 font-medium text-muted-foreground">Event</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Actor</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">Resource</th>
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(a => (
                <tr key={a.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-6 py-4">
                    <Badge variant="outline" className="font-mono bg-background">{a.eventType}</Badge>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-xs">{a.actorType}</div>
                    <div className="text-xs text-muted-foreground font-mono">{a.actorId}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-xs">{a.resourceType}</div>
                    <div className="text-xs text-muted-foreground font-mono">{a.resourceId}</div>
                  </td>
                  <td className="px-6 py-4 text-right text-muted-foreground">
                    {new Date(a.createdAt).toLocaleString()}
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

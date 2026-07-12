/**
 * Batch 3 — Funder workspace profile / role mapping.
 * Team self-service is intentionally NOT built in this batch.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FunderWorkspaceShell } from "./components/FunderWorkspaceShell";
import {
  funderRoleLabel,
  funderRoleSummary,
} from "@/lib/funder-workspace/funder-permissions";

export default function FunderWorkspaceProfile() {
  return (
    <FunderWorkspaceShell
      title="Profile"
      description="Your organisation and role mapping."
    >
      {(ctx) => {
        const summary = funderRoleSummary(ctx.role);
        return (
          <div className="space-y-4" data-testid="fw-funder-profile">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Organisation</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <Field label="Name" value={ctx.organisation.name} />
                <Field
                  label="Contact email"
                  value={ctx.organisation.contact_email ?? "—"}
                />
                <Field
                  label="Jurisdiction"
                  value={ctx.organisation.jurisdiction ?? "—"}
                />
                <div>
                  <div className="text-xs text-muted-foreground">Approval status</div>
                  <Badge variant="default" className="mt-1">
                    {ctx.organisation.approval_status ?? "—"}
                  </Badge>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Organisation status</div>
                  <Badge variant="secondary" className="mt-1">
                    {ctx.organisation.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your role</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground">Signed in as</div>
                  <div>
                    {ctx.display_name ?? "—"}{" "}
                    <span className="text-muted-foreground">({ctx.email})</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Role</div>
                  <div className="flex items-center gap-2">
                    <Badge>{funderRoleLabel(ctx.role)}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {ctx.role}
                    </span>
                  </div>
                </div>
                {summary.length > 0 && (
                  <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                    {summary.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Team management</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Team self-service (invitations, deactivations, role changes) is
                not yet available in this build. To add or remove funder users,
                contact Izenzo.
              </CardContent>
            </Card>
          </div>
        );
      }}
    </FunderWorkspaceShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

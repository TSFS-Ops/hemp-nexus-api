/**
 * Batch 3 — Funder workspace profile / role mapping.
 * Team self-service is intentionally NOT built in this batch.
 */
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FunderWorkspaceShell } from "./components/FunderWorkspaceShell";
import { funderRoleSummary } from "@/lib/funder-workspace/funder-permissions";
import {
  InfoBanner,
  SectionHeading,
  StatusBadge,
  funderRoleLabel,
} from "@/lib/funder-workspace/ui";

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
                <SectionHeading title="Organisation" />
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <Field label="Name" value={ctx.organisation.name} />
                <Field
                  label="Contact email"
                  value={ctx.organisation.contact_email ?? "—"}
                />
                <Field
                  label="Jurisdiction"
                  value={ctx.organisation.jurisdiction ?? "—"}
                />
                <Field
                  label="Approval status"
                  valueNode={
                    <StatusBadge
                      kind="approval"
                      value={ctx.organisation.approval_status ?? undefined}
                    />
                  }
                />
                <Field
                  label="Organisation status"
                  valueNode={<StatusBadge kind="org" value={ctx.organisation.status} />}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <SectionHeading title="Your role" />
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground">Signed in as</div>
                  <div className="mt-0.5">
                    {ctx.display_name ?? "—"}{" "}
                    <span className="text-muted-foreground">({ctx.email})</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Role</div>
                  <div className="mt-0.5">
                    <span className="inline-flex items-center rounded-md bg-primary/10 text-primary px-2 py-0.5 text-sm font-medium">
                      {funderRoleLabel(ctx.role)}
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

            <InfoBanner tone="info" title="Team management">
              Team self-service (invitations, deactivations, role changes) is not
              yet available for funder admins. To add or remove funder users,
              contact Izenzo.
            </InfoBanner>
          </div>
        );
      }}
    </FunderWorkspaceShell>
  );
}

function Field({
  label,
  value,
  valueNode,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground mt-0.5">{valueNode ?? value ?? "—"}</div>
    </div>
  );
}

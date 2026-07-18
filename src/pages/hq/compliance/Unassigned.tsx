import { QueuePage } from "./QueuePage";
export default function ComplianceUnassigned() {
  return (
    <QueuePage
      title="Unassigned Cases"
      description="Cases waiting to be picked up by an analyst. Ordinary cases: 4 business hours. Critical: 1 hour."
      initialFilters={{ unassigned: true }}
      emptyLabel="All cases are currently assigned."
    />
  );
}

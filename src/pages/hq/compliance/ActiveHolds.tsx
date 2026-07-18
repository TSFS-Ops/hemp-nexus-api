import { QueuePage } from "./QueuePage";
export default function ComplianceActiveHolds() {
  return (
    <QueuePage
      title="Active Holds"
      description="Cases with an active compliance or legal hold. Release requires distinct approval and AAL2 where required."
      initialFilters={{ hasHold: true }}
      emptyLabel="No active holds."
    />
  );
}

import { QueuePage } from "./QueuePage";
export default function ComplianceMyCases() {
  return (
    <QueuePage
      title="My Cases"
      description="Cases currently assigned to you."
      initialFilters={{ assignedToMe: true }}
      emptyLabel="You have no assigned cases right now."
    />
  );
}

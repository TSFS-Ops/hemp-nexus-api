import { QueuePage } from "./QueuePage";
export default function CompliancePeriodicReviews() {
  return (
    <QueuePage
      title="Periodic Reviews"
      description="Cases due for periodic review. Low: 12m, Medium: 6m, High: 3m, Critical: monthly or continuous."
      initialFilters={{ caseTypes: ["periodic_refresh"] }}
      emptyLabel="No periodic reviews scheduled."
    />
  );
}

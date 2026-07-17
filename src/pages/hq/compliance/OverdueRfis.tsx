import { QueuePage } from "./QueuePage";
export default function ComplianceOverdueRfis() {
  return (
    <QueuePage
      title="Overdue RFIs"
      description="Cases with a Request for Information that has passed the customer deadline."
      initialFilters={{ moreInformationRequired: true, overdue: true }}
      emptyLabel="No overdue RFIs."
    />
  );
}

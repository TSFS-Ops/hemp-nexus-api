import { QueuePage } from "./QueuePage";
export default function CompliancePendingApprovals() {
  return (
    <QueuePage
      title="Pending Approvals"
      description="Cases with a decision proposal awaiting one or more distinct approvers."
      initialFilters={{ hasApproval: true }}
      emptyLabel="No approvals pending."
    />
  );
}

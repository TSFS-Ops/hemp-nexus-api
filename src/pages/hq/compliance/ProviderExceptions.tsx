import { QueuePage } from "./QueuePage";
export default function ComplianceProviderExceptions() {
  return (
    <QueuePage
      title="Provider Exceptions"
      description="Cases with provider errors or dependencies. Tolerance: 4 hours for high/critical, 24 hours for ordinary."
      initialFilters={{ providerDependent: true }}
      emptyLabel="No provider exceptions."
    />
  );
}

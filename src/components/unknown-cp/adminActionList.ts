export const UNKNOWN_CP_ADMIN_ACTIONS_LIST = [
  { key: "start_review", label: "Start review" },
  { key: "request_more_information", label: "Request more information" },
  { key: "record_additional_information_reviewed", label: "Record additional information reviewed" },
  { key: "log_outreach_attempt", label: "Log outreach attempt" },
  { key: "send_counterparty_invite", label: "Send counterparty invite" },
  { key: "mark_onboarding_in_progress", label: "Mark onboarding in progress" },
  { key: "confirm_known_counterparty_link", label: "Confirm known counterparty link" },
  { key: "record_declined", label: "Record declined" },
  { key: "record_no_response", label: "Record no response" },
  { key: "record_unreachable", label: "Record unreachable" },
  { key: "mark_invalid_details", label: "Mark invalid details" },
  { key: "close_case", label: "Close case" },
  { key: "reopen_case", label: "Reopen case" },
] as const;
export type UnknownCpAdminActionKey = (typeof UNKNOWN_CP_ADMIN_ACTIONS_LIST)[number]["key"];

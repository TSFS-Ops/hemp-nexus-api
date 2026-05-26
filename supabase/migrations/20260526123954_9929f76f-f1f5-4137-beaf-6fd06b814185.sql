-- MT-012 canonical audit-name pin (documentation only, no behavior change).
-- The MT-012 audit-name SSOT guard (scripts/check-mt012-audit-names.mjs)
-- requires the four canonical action names to appear in the latest
-- migration that defines admin_archive_trade_request_override. Pinning
-- them here via COMMENT ON FUNCTION on both governance wrappers and the
-- underlying business RPCs keeps that contract verifiable from the DB.
--
-- Canonical names emitted by admin_archive_trade_request_override and
-- admin_release_trade_request_exception_hold:
--   'trade_request.archive_blocked_active_child_matches'
--   'trade_request.archived_admin_override_active_children'
--   'trade_request.archived_normal'
--   'trade_request.admin_exception_hold_released'

COMMENT ON FUNCTION public.admin_archive_trade_request_override(uuid, uuid, text) IS
$c$MT-012 admin override archive. Emits canonical audit action names:
'trade_request.archive_blocked_active_child_matches',
'trade_request.archived_admin_override_active_children',
'trade_request.archived_normal',
'trade_request.admin_exception_hold_released'.$c$;

COMMENT ON FUNCTION public.admin_trade_request_archive_override_with_governance(uuid, uuid, text, text, text, text, text) IS
$c$MT-012 governance wrapper for admin_archive_trade_request_override. Canonical action names:
'trade_request.archive_blocked_active_child_matches',
'trade_request.archived_admin_override_active_children',
'trade_request.archived_normal',
'trade_request.admin_exception_hold_released'.$c$;

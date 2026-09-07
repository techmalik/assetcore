// ============================================================================
// API error code → a sentence a person can act on.
//
// The API answers failures with a machine code (`{ error: 'forbidden' }`) and
// apiClient puts that code straight into `Error.message`. Every screen that
// rendered `ex.message` was therefore showing users strings like
// `invalid_credentials`, `no_org_context`, `forbidden` and `internal_error`.
//
// The app already knew better in about a dozen places — "The ceiling has to be
// above the floor.", "An outcome is required to complete an audit." — but each
// was a one-off ternary on one screen, so a code that surfaced anywhere else
// leaked raw. This table is those sentences in one place, so a code is
// explained wherever it lands rather than only where somebody remembered.
//
// Rules for entries: say what happened and, where there is one, what to do
// about it. No error codes, no HTTP status numbers, no blame.
// ============================================================================

export const ERROR_MESSAGES = {
  // --- Authentication and session ---
  invalid_credentials: 'That email and password do not match an account.',
  too_many_attempts: 'Too many attempts. Wait about 15 minutes and try again.',
  invalid_current_password: 'That is not your current password.',
  account_disabled: 'This account has been disabled. Ask an administrator to re-enable it.',
  account_unavailable: 'This account is not available. Ask an administrator to check it.',
  invalid_token: 'That link is not valid.',
  invalid_or_expired_token: 'That link has expired or has already been used. Ask for a new one.',
  missing_token: 'That link is incomplete. Use the full link from your invitation.',
  invalid_refresh_token: 'Your session has ended. Sign in again.',
  no_refresh_token: 'Your session has ended. Sign in again.',

  // --- Authorisation and org context ---
  forbidden: 'Your role does not allow that.',
  no_org_context: 'This account is not attached to an organisation, so there is nothing to show.',
  insufficient_platform_role: 'Your role does not allow that.',
  not_a_platform_admin: 'Your role does not allow that.',
  licence_not_provisioned: 'This instance has no licence yet. Contact your administrator.',

  // --- Membership and users ---
  already_a_member: 'That person is already a member of this organisation.',
  email_belongs_to_another_org: 'That email address already belongs to another organisation.',
  cannot_demote_last_owner: 'An organisation has to keep at least one System Admin.',
  cannot_disable_last_owner: 'An organisation has to keep at least one active System Admin.',
  cannot_disable_self: 'You cannot disable your own account.',

  // --- Approvals ---
  invalid_band: 'The ceiling has to be above the floor.',
  no_matching_rule: 'No approval rule covers this yet. Ask an administrator to add one.',
  already_pending: 'A request is already waiting on this.',
  self_approval: 'You cannot decide your own request.',
  wrong_approver: 'This request is waiting on a different role.',
  not_pending: 'This request has already been decided.',
  not_requester: 'Only the person who raised a request can recall it.',

  // --- Work orders, defects, inspections ---
  invalid_transition: 'That is not a status this job can move to from where it is.',
  already_raised: 'That has already been raised.',
  condition_rating_required: 'A condition rating of 1 to 5 is required to complete an inspection.',
  outcome_required: 'An outcome is required to complete an audit.',
  completed_at_in_future: 'A completion date cannot be in the future.',
  invalid_maintenance_dates: 'Those maintenance dates are the wrong way round.',
  next_maintenance_before_completed: 'The next maintenance date has to be after the one just completed.',
  invalid_trigger_for_entity: 'That trigger does not apply to the entity you picked.',
  residual_incomplete: 'Residual risk needs both a likelihood and a consequence.',

  // --- Parts and stock ---
  insufficient_stock: 'There is not enough on hand for that issue.',
  already_consumed: 'That part has already left the store. Reverse it with a stock adjustment instead.',
  duplicate_part_number: 'A part with that number already exists.',

  // --- Depreciation ---
  incomplete_basis: 'This asset is missing something a schedule needs — a purchase value, a useful life, or a start date.',
  unsupported_method: 'That depreciation method is not supported.',
  nothing_to_depreciate: 'There is nothing left to depreciate on this asset.',
  no_schedule: 'This asset has no depreciation schedule yet.',

  // --- Files and uploads ---
  file_too_large: 'That file is too large.',
  missing_file: 'No file was attached.',
  unsupported_type: 'That file type is not accepted here.',
  photo_limit: 'This record has reached its photo limit.',
  invalid_path: 'That file could not be found.',

  // --- Shape and generic ---
  invalid_request: 'Some of what was entered is not valid. Check the fields and try again.',
  empty_patch: 'Nothing was changed.',
  duplicate_name: 'That name is already in use.',
  not_found: 'That record could not be found.',
  template_not_found: 'That template could not be found.',
  unsupported_kind: 'That report type is not supported.',
  too_many_rows: 'That is more rows than can be handled at once. Split the file and try again.',
  exactly_one_parent_required: 'This has to be attached to exactly one parent record.',
  internal_error: 'Something went wrong at our end. Try again, and tell an administrator if it keeps happening.',
}

/**
 * The sentence for a failure, or `fallback` when the code is one we have not
 * written copy for.
 *
 * Falls back rather than echoing an unknown code: a code we forgot to add is
 * still a code, and showing it is the bug this module exists to remove. Pass a
 * fallback that fits the screen ("Save failed.", "Could not load the register.").
 */
export function errorText(err, fallback = 'Something went wrong. Try again.') {
  const code = typeof err === 'string' ? err : err?.code || err?.message
  if (!code) return fallback
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]
  // Anything that is not a bare snake_case code is already prose — a network
  // failure from fetch, or a message a caller wrote by hand — so show it.
  if (!/^[a-z][a-z0-9_]*$/.test(code)) return code
  return fallback
}

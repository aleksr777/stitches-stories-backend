export enum ErrMsg {
  INTERNAL_SERVER_ERROR = 'Internal server error.',

  INVALID_EMAIL_OR_PASSWORD = 'Invalid email or password.',

  TOKEN_NOT_DEFINED = 'Token is not defined.',
  ACCESS_TOKEN_NOT_DEFINED = 'Access token is not defined.',
  REFRESH_TOKEN_NOT_DEFINED = 'Refresh token is not defined.',
  PASSWORD_RESET_CODE_NOT_DEFINED = 'Password reset code is not defined.',
  CURRENT_USER_PASSWORD_RESET_CODE_NOT_DEFINED = 'Current user password reset code is not defined.',
  REGISTRATION_CODE_NOT_DEFINED = 'Registration code is not defined.',
  EMAIL_CHANGE_CODE_NOT_DEFINED = 'Email change code is not defined.',
  PASSWORD_CHANGE_CODE_NOT_DEFINED = 'Password change code is not defined.',

  INVALID_TOKEN = 'Invalid token.',

  INVALID_ACCESS_TOKEN = 'Access token is expired or invalid.',
  INVALID_REFRESH_TOKEN = 'Refresh token is expired or invalid.',
  INVALID_REGISTRATION_CODE = 'Registration code is expired or invalid. Please request a new one.',
  INVALID_PASSWORD_RESET_CODE = 'Password reset code is expired or invalid. Please request a new one.',
  INVALID_CURRENT_USER_PASSWORD_RESET_CODE = 'Current user password reset code is expired or invalid. Please request a new one.',
  INVALID_EMAIL_CHANGE_CODE = 'Email change code is expired or invalid. Please request a new one.',
  INVALID_PASSWORD_CHANGE_CODE = 'Password change code is expired or invalid. Please request a new one.',
  VERIFICATION_CODE_RESEND_TOO_SOON = 'Please wait before requesting another verification code.',

  UNABLE_GENERATE_UNIQUE_CODE = 'Unable to generate unique code.',

  INVALID_REGISTRATION_PAYLOAD = 'Invalid registration payload',

  USER_ID_NOT_DEFINED = 'User id is not defined',

  PAYLOAD_NOT_DEFINED = 'Payload is not defined',

  USER_NOT_FOUND = 'User was not found in the database.',

  CONFLICT_USER_EXISTS = 'A user with such unique data already exists in the database.',

  INSUFFICIENT_ACCESS_RIGHTS = 'The current user has insufficient access rights.',

  ACCOUNT_BLOCKED = 'Account has been blocked.',
  ACCOUNT_ALREADY_BLOCKED = 'This account has already been blocked.',
  ACCOUNT_NOT_BLOCKED = 'This account is not blocked.',
  ADMINISTRATOR_CANNOT_BE_BLOCKED = 'The administrator cannot be blocked.',
  ADMINISTRATOR_CANNOT_BE_DELETED = 'The administrator cannot be deleted.',

  CURRENT_USER_BLOCKED = 'Current user is blocked.',
  CURRENT_PASSWORD_IS_INCORRECT = 'Current password is incorrect.',

  SERVICE_EMAIL_MATCH_USER_EMAIL = `The service mail must not match the user's email.`,
  NEW_EMAIL_MATCH_USER_EMAIL = 'The new email must not be the same as the current one.',

  NEW_PASSWORD_MUST_DIFFER = 'New password must differ from old.',
  OLD_PASSWORD_IS_INCORRECT = 'Old password is incorrect',

  NO_FIELDS_FOR_UPDATE = 'No fields provided for update.',
  FIELDS_CANNOT_BE_UPDATED = 'Some fields cannot be updated in this way.',
  FIELDS_CANNOT_BE_EMPTY = 'Some fields cannot be empty.',

  INVALID_PAGINATION_PARAMETERS = 'Invalid pagination parameters.',
}

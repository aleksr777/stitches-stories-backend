export const ID = 'id';
export const EMAIL = 'email';
const PHONE_NUMBER = 'phone_number';
export const CONTACT_EMAIL = 'contact_email';
const SEX = 'sex';

const NAME = 'name';

export const ROLE = 'role';
export const PASSWORD = 'password';

const LAST_ACTIVITY_AT = 'last_activity_at';
const CREATED_AT = 'created_at';
const UPDATED_AT = 'updated_at';

export const IS_BLOCKED = 'is_blocked';
const BLOCKED_AT = 'blocked_at';
const BLOCKED_BY = 'blocked_by';
export const BLOCKED_REASON = 'blocked_reason';

export const USER_SEARCHABLE_FIELDS = [
  NAME,
  EMAIL,
  CONTACT_EMAIL,
  PHONE_NUMBER,
] as const;

const IS_BLOCKED_FIELDS = [
  IS_BLOCKED,
  BLOCKED_AT,
  BLOCKED_BY,
  BLOCKED_REASON,
] as const;

export const USER_PUBLIC_FIELDS = [ID, NAME, LAST_ACTIVITY_AT] as const;

export const USER_CONFIDENTIAL_FIELDS = [
  CREATED_AT,
  UPDATED_AT,
  EMAIL,
  SEX,
  CONTACT_EMAIL,
  PHONE_NUMBER,
  ROLE,
] as const;

export const USER_SECRET_FIELDS = [PASSWORD] as const;

export const USER_PROFILE_FIELDS = [
  ...USER_PUBLIC_FIELDS,
  ...USER_CONFIDENTIAL_FIELDS,
] as const;

export const ADMIN_FIELDS = [
  ...USER_PROFILE_FIELDS,
  ...IS_BLOCKED_FIELDS,
] as const;

export const SPECIAL_UPDATE_FIELDS = [
  ID,
  EMAIL,
  CONTACT_EMAIL,
  LAST_ACTIVITY_AT,
  CREATED_AT,
  UPDATED_AT,
  ROLE,
  ...IS_BLOCKED_FIELDS,
  ...USER_SECRET_FIELDS,
] as const;

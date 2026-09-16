import { USER_SECRET_FIELDS } from '../constants/user-select-fields.constants';
import { User } from '../..//users/entities/user.entity';
export type UserSecretKey = (typeof USER_SECRET_FIELDS)[number];
export type PublicUser = Omit<User, UserSecretKey>;

import { IsString, Matches } from 'class-validator';

export class AdminLoginChallengeDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  challenge_id!: string;
}

export class AdminLoginConfirmDto extends AdminLoginChallengeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

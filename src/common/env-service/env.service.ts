import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ENV_VARIABLES } from './env.constants';
import { ErrorsService } from '../../common/errors-service/errors.service';

type EnvType = 'string' | 'number' | 'boolean';

@Injectable()
export class EnvService {
  constructor(
    private readonly configService: ConfigService,
    private readonly errorsService: ErrorsService,
  ) {}

  private parseValue(
    key: string,
    raw: string,
    type: EnvType,
  ): string | number | boolean {
    if (type === 'number') {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        this.errorsService.default(
          null,
          `Env var "${key}" value "${raw}" is not a valid number`,
        );
      }
      return parsed;
    }

    if (type === 'boolean') {
      const normalized = raw.toLowerCase();
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
      this.errorsService.default(
        null,
        `Env var "${key}" value "${raw}" is not a valid boolean`,
      );
    }

    return raw;
  }

  public get(key: string): string;
  public get(key: string, type: 'string'): string;
  public get(key: string, type: 'number'): number;
  public get(key: string, type: 'boolean'): boolean;
  public get(key: string, type: EnvType = 'string'): string | number | boolean {
    const raw = this.configService.getOrThrow<string>(key);
    return this.parseValue(key, raw, type);
  }

  public getOptional(key: string, type?: 'string'): string | undefined;
  public getOptional(key: string, type: 'number'): number | undefined;
  public getOptional(key: string, type: 'boolean'): boolean | undefined;
  public getOptional(
    key: string,
    type: EnvType = 'string',
  ): string | number | boolean | undefined {
    const raw = this.configService.get<string>(key);
    if (raw === undefined || raw.trim() === '') return undefined;
    return this.parseValue(key, raw, type);
  }

  public validateVariables(): void {
    const missing = ENV_VARIABLES.filter((key) => {
      const val = process.env[key];
      return val === undefined || val.trim() === '';
    });
    if (missing.length) {
      this.errorsService.default(
        null,
        `The following required environment variables are missing or empty: ${missing.join(', ')}`,
      );
    }
  }
}

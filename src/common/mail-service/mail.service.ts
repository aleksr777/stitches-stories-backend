import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EnvService } from '../env-service/env.service';
import { ErrorsService } from '../errors-service/errors.service';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;
  private smtpFrom: string;
  constructor(
    private readonly envService: EnvService,
    private readonly errorsService: ErrorsService,
  ) {
    this.smtpFrom = this.envService.get('SMTP_FROM');
    this.transporter = nodemailer.createTransport({
      host: this.envService.get('SMTP_HOST'),
      port: this.envService.get('SMTP_PORT', 'number'),
      secure: this.envService.get('SMTP_SECURE', 'boolean'),
      auth: {
        user: this.envService.get('SMTP_USER'),
        pass: this.envService.get('SMTP_PASS'),
      },
    });
  }

  async send(
    to: string,
    subject: string,
    text: string,
    html?: string,
  ): Promise<void> {
    await this.transporter.sendMail({
      from: `"Service Email" <${this.smtpFrom}>`,
      to,
      subject,
      text,
      html,
    });
  }

  validateNotServiceEmail(email: string) {
    if (this.smtpFrom === email) {
      this.errorsService.throwIfServiceEmail();
    }
  }
}

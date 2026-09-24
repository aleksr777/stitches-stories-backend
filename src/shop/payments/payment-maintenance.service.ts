import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource, In, LessThanOrEqual } from 'typeorm';
import { PaymentInvoice } from './payment.entity';
import { PaymentService } from './payment.service';

@Injectable()
export class PaymentMaintenanceService {
  private running = false;
  private readonly logger = new Logger(PaymentMaintenanceService.name);
  constructor(
    private readonly db: DataSource,
    private readonly payments: PaymentService,
  ) {}
  @Interval(60000)
  async expire() {
    if (this.running) return;
    this.running = true;
    try {
      const invoices = await this.db.getRepository(PaymentInvoice).find({
        select: { id: true },
        where: {
          status: In(['ready', 'pending']),
          expiresAt: LessThanOrEqual(new Date()),
        },
        take: 100,
      });
      for (const invoice of invoices) await this.payments.expire(invoice.id);
    } catch {
      this.logger.error('Не удалось освободить просроченные резервы оплаты.');
    } finally {
      this.running = false;
    }
  }
}

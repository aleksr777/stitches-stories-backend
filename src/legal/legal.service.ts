import {
  Injectable,
  ConflictException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { createHash } from 'node:crypto';
import { ConsentEvent, LegalDocumentEntity } from './legal.entities';
import { DocumentRef, LegalDocument } from './legal.types';
import documentData from './documents.json';
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ':' +
            canonical((value as Record<string, unknown>)[k]),
        )
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
@Injectable()
export class LegalService implements OnModuleInit {
  constructor(private readonly db: DataSource) {}
  list(): LegalDocument[] {
    return Object.values(documentData) as LegalDocument[];
  }
  get(id: string) {
    const doc = this.list().find((d) => d.id === id);
    if (!doc) throw new NotFoundException('Документ не найден.');
    return doc;
  }
  async version(id: string, version: string) {
    const doc = await this.db
      .getRepository(LegalDocumentEntity)
      .findOneBy({ id, version });
    if (!doc) throw new NotFoundException();
    return doc.content;
  }
  assertReferences(refs: DocumentRef[], expected: string[]) {
    if (
      !Array.isArray(refs) ||
      refs.length !== expected.length ||
      new Set(refs.map((r) => r.id)).size !== expected.length ||
      expected.some((id) => !refs.some((r) => r.id === id))
    )
      throw new ConflictException('Подтвердите документы отдельно.');
    return refs.map((ref) => {
      const d = this.get(ref.id);
      if (d.version !== ref.version || d.sha256 !== ref.sha256)
        throw new ConflictException(
          'Документы обновились. Ознакомьтесь с новой версией.',
        );
      return d;
    });
  }
  async onModuleInit() {
    for (const doc of this.list()) {
      const unsigned = Object.fromEntries(
        Object.entries(doc).filter(([k]) => k !== 'sha256'),
      );
      if (digest(canonical(unsigned)) !== doc.sha256)
        throw new Error('Legal document hash mismatch: ' + doc.id);
      if (
        process.env.NODE_ENV === 'production' &&
        (doc.status !== 'published' ||
          /\[заполнить\]|\[домен\]|\[Фамилия|\[До публикации|\[почта оператора\]/i.test(
            canonical(doc),
          ))
      )
        throw new Error(
          'Publish complete legal documents before production: ' + doc.id,
        );
      await this.db
        .getRepository(LegalDocumentEntity)
        .createQueryBuilder()
        .insert()
        .values({
          id: doc.id,
          version: doc.version,
          sha256: doc.sha256,
          content: doc,
        })
        .orIgnore()
        .execute();
      const saved = await this.db
        .getRepository(LegalDocumentEntity)
        .findOneByOrFail({ id: doc.id, version: doc.version });
      if (saved.sha256 !== doc.sha256)
        throw new Error('A published version is immutable: ' + doc.id);
    }
  }
  async record(
    manager: EntityManager,
    refs: DocumentRef[],
    expected: string[],
    context: {
      userId?: number | null;
      subscriptionId?: string | null;
      source: string;
      verification: string;
    },
  ) {
    const docs = this.assertReferences(refs, expected);
    await manager.save(
      ConsentEvent,
      docs.map((d) =>
        manager.create(ConsentEvent, {
          userId: context.userId ?? null,
          subscriptionId: context.subscriptionId ?? null,
          documentId: d.id,
          version: d.version,
          sha256: d.sha256,
          purpose: d.purpose,
          action: d.type === 'consent' ? 'grant' : 'accept',
          source: context.source,
          verification: context.verification,
          documentStatus: d.status,
        }),
      ),
    );
  }
  history(userId: number) {
    return this.db.getRepository(ConsentEvent).find({
      where: { userId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 500,
    });
  }
  async withdraw(
    manager: EntityManager,
    userId: number | null,
    ids: string[],
    subscriptionId?: string,
  ) {
    for (const documentId of ids) {
      const event = await manager.findOne(ConsentEvent, {
        where: subscriptionId
          ? { subscriptionId, documentId }
          : { userId: userId!, documentId },
        order: { createdAt: 'DESC', id: 'DESC' },
      });
      if (!event || event.action !== 'grant') continue;
      await manager.save(
        ConsentEvent,
        manager.create(ConsentEvent, {
          userId: event.userId,
          subscriptionId: event.subscriptionId,
          documentId: event.documentId,
          version: event.version,
          sha256: event.sha256,
          purpose: event.purpose,
          action: 'withdraw',
          source: 'consent-settings',
          verification: userId ? 'authenticated-session' : 'unsubscribe-token',
          documentStatus: event.documentStatus,
        }),
      );
    }
  }
}

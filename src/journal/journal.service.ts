import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  JournalPhoto,
  JournalPost,
  JournalReview,
  JournalSource,
  JournalStatus,
} from './journal.entities';
import { JournalPageDto } from './journal.dto';
import { VkClient, vkDomain, VkPost } from './vk.client';

@Injectable()
export class JournalService {
  private readonly downloads = new Map<
    string,
    Promise<{ data: Buffer; mime: string }>
  >();
  private importing = false;
  constructor(
    private readonly db: DataSource,
    private readonly vk: VkClient,
  ) {}

  async config() {
    const source = await this.db
      .getRepository(JournalSource)
      .findOneBy({ id: 1 });
    return {
      pageUrl: source ? 'https://vk.com/' + source.domain : '',
      tokenConfigured: this.vk.configured,
    };
  }

  async setSource(pageUrl: string) {
    await this.db
      .getRepository(JournalSource)
      .save({ id: 1, domain: vkDomain(pageUrl) });
    return this.config();
  }

  private async addPhotos(
    manager: EntityManager,
    postId: string,
    input: VkPost,
  ) {
    if (input.photos.length)
      await manager.getRepository(JournalPhoto).insert(
        input.photos.map((photo, position) => ({
          ...photo,
          id: randomUUID(),
          postId,
          position,
        })),
      );
  }

  async importPosts(offset: number) {
    if (this.importing)
      throw new ConflictException(
        'Импорт уже выполняется. Дождитесь его завершения.',
      );
    this.importing = true;
    try {
      const source = await this.db
        .getRepository(JournalSource)
        .findOneBy({ id: 1 });
      if (!source)
        throw new BadRequestException('Сначала сохраните страницу VK.');
      const result = await this.vk.posts(source.domain, offset);
      const added = await this.db.transaction(async (m) => {
        const current = await m
          .getRepository(JournalSource)
          .findOne({ where: { id: 1 }, lock: { mode: 'pessimistic_write' } });
        if (current?.domain !== source.domain)
          throw new ConflictException(
            'Страница VK изменилась. Повторите импорт.',
          );
        let count = 0;
        for (const input of result.posts) {
          const id = randomUUID();
          const inserted = await m
            .createQueryBuilder()
            .insert()
            .into(JournalPost)
            .values({
              id,
              vkOwnerId: input.vkOwnerId,
              vkPostId: input.vkPostId,
              text: input.text,
              sourcePublishedAt: input.sourcePublishedAt,
              otherAttachments: input.otherAttachments,
              status: 'pending',
            })
            .orIgnore()
            .returning('id')
            .execute();
          if (!(inserted.raw as unknown[]).length) continue;
          await this.addPhotos(m, id, input);
          count++;
        }
        return count;
      });
      return {
        added,
        existing: result.posts.length - added,
        skipped: result.skipped,
        nextOffset: result.nextOffset,
        total: result.total,
      };
    } finally {
      this.importing = false;
    }
  }

  private view(post: JournalPost, administrator: boolean) {
    return {
      id: post.id,
      text: post.text,
      sourceUrl: `https://vk.com/wall${post.vkOwnerId}_${post.vkPostId}`,
      sourcePublishedAt: post.sourcePublishedAt,
      publishedAt: post.publishedAt,
      otherAttachments: post.otherAttachments,
      photos: (post.photos ?? [])
        .sort((a, b) => a.position - b.position)
        .map((p) => ({ id: p.id, width: p.width, height: p.height })),
      ...(administrator
        ? {
            status: post.status,
            revision: post.revision,
            importedAt: post.importedAt,
          }
        : {}),
    };
  }

  async list(
    page: JournalPageDto,
    status: JournalStatus = 'published',
    administrator = false,
  ) {
    // A public caller cannot request another status, even if this method is reused.
    const [posts, total] = await this.db
      .getRepository(JournalPost)
      .findAndCount({
        where: { status: administrator ? status : 'published' },
        relations: { photos: true },
        order: { sourcePublishedAt: 'DESC', id: 'DESC' },
        skip: page.offset,
        take: page.limit,
      });
    return {
      items: posts.map((p) => this.view(p, administrator)),
      total,
      nextOffset:
        page.offset + posts.length < total ? page.offset + posts.length : null,
    };
  }

  private async get(id: string, manager = this.db.manager) {
    const post = await manager
      .getRepository(JournalPost)
      .findOne({ where: { id }, relations: { photos: true } });
    if (!post) throw new NotFoundException('Публикация не найдена.');
    return post;
  }

  private checkRevision(post: JournalPost, revision: number) {
    if (post.revision !== revision)
      throw new ConflictException(
        'Публикация уже изменена. Обновите список и проверьте её ещё раз.',
      );
  }

  async photo(postId: string, photoId: string, administrator = false) {
    const repository = this.db.getRepository(JournalPhoto);
    const photo = await repository
      .createQueryBuilder('photo')
      .innerJoin('photo.post', 'post')
      .addSelect(['photo.data', 'photo.mime', 'photo.sourceUrl'])
      .where('photo.id = :photoId AND photo.postId = :postId', {
        photoId,
        postId,
      })
      .andWhere(administrator ? 'TRUE' : 'post.status = :status', {
        status: 'published',
      })
      .getOne();
    if (!photo) throw new NotFoundException('Фотография не найдена.');
    if (photo.data && photo.mime) return { data: photo.data, mime: photo.mime };
    if (!administrator) throw new NotFoundException('Фотография не найдена.');
    let pending = this.downloads.get(photoId);
    if (!pending) {
      pending = this.vk
        .photo(photo.sourceUrl)
        .then(async (image) => {
          const updated = await repository
            .createQueryBuilder()
            .update()
            .set(image)
            .where('id = :photoId AND "postId" = :postId AND data IS NULL', {
              photoId,
              postId,
            })
            .execute();
          if (updated.affected) return image;
          // A second API instance may already have copied (and published) this photo.
          // Never overwrite the reviewed bytes with a later download.
          const existing = await repository
            .createQueryBuilder('photo')
            .addSelect(['photo.data', 'photo.mime'])
            .where('photo.id = :photoId AND photo.postId = :postId', {
              photoId,
              postId,
            })
            .getOne();
          if (existing?.data && existing.mime)
            return { data: existing.data, mime: existing.mime };
          throw new ConflictException(
            'Публикация обновилась. Откройте её повторно.',
          );
        })
        .finally(() => this.downloads.delete(photoId));
      this.downloads.set(photoId, pending);
    }
    return pending;
  }

  async moderate(
    id: string,
    revision: number,
    status: JournalStatus,
    administratorId: number,
  ) {
    const snapshot = await this.get(id);
    this.checkRevision(snapshot, revision);
    if (status === 'published') {
      // Store all images before making a post visible. The visitor never fetches VK media.
      for (const photo of snapshot.photos) await this.photo(id, photo.id, true);
    }
    await this.db.transaction(async (m) => {
      const post = await m
        .getRepository(JournalPost)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!post) throw new NotFoundException();
      this.checkRevision(post, revision);
      await m.getRepository(JournalPost).update(id, {
        status,
        revision: revision + 1,
        publishedAt: status === 'published' ? new Date() : null,
      });
      await m
        .getRepository(JournalReview)
        .insert({ postId: id, administratorId, revision, action: status });
    });
    return this.view(await this.get(id), true);
  }

  async refresh(id: string, revision: number, administratorId: number) {
    const snapshot = await this.get(id);
    this.checkRevision(snapshot, revision);
    if (snapshot.status === 'published')
      throw new ConflictException(
        'Сначала снимите пост с публикации, затем обновите и одобрите его заново.',
      );
    const input = await this.vk.post(snapshot.vkOwnerId, snapshot.vkPostId);
    await this.db.transaction(async (m) => {
      const post = await m
        .getRepository(JournalPost)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!post) throw new NotFoundException();
      this.checkRevision(post, revision);
      await m.getRepository(JournalPhoto).delete({ postId: id });
      await m.getRepository(JournalPost).update(id, {
        text: input.text,
        sourcePublishedAt: input.sourcePublishedAt,
        otherAttachments: input.otherAttachments,
        status: 'pending',
        publishedAt: null,
        revision: revision + 1,
      });
      await this.addPhotos(m, id, input);
      await m
        .getRepository(JournalReview)
        .insert({ postId: id, administratorId, revision, action: 'refresh' });
    });
    return this.view(await this.get(id), true);
  }
}

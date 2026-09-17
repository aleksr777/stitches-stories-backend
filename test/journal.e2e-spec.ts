import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { JournalService } from '../src/journal/journal.service';
import {
  JournalPhoto,
  JournalPost,
  JournalReview,
  journalEntities,
} from '../src/journal/journal.entities';
import { VkClient, VkPost } from '../src/journal/vk.client';

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'VK approval persistence in PostgreSQL',
  () => {
    const schema = 'journal_test_' + randomUUID().replace(/-/g, '');
    let control: DataSource;
    let db: DataSource;
    let journal: JournalService;
    const image = {
      data: Buffer.from([255, 216, 255, 217]),
      mime: 'image/jpeg',
    };
    const client = {
      configured: true,
      posts: jest.fn(),
      photo: jest.fn(),
      post: jest.fn(),
    };
    let input: VkPost;
    const page = { offset: 0, limit: 12 };
    beforeAll(async () => {
      control = await new DataSource({ type: 'postgres', url }).initialize();
      await control.query(`CREATE SCHEMA "${schema}"`);
      db = await new DataSource({
        type: 'postgres',
        url,
        schema,
        entities: journalEntities,
        synchronize: true,
      }).initialize();
      journal = new JournalService(db, client as unknown as VkClient);
      await journal.setSource('https://vk.com/craft_studio');
    });
    beforeEach(async () => {
      await db
        .getRepository(JournalPhoto)
        .createQueryBuilder()
        .delete()
        .execute();
      await db
        .getRepository(JournalPost)
        .createQueryBuilder()
        .delete()
        .execute();
      await db
        .getRepository(JournalReview)
        .createQueryBuilder()
        .delete()
        .execute();
      jest.resetAllMocks();
      input = {
        vkOwnerId: '-123',
        vkPostId: '10',
        text: 'Новая работа',
        sourcePublishedAt: new Date('2026-01-01T12:00:00Z'),
        otherAttachments: [],
        photos: [
          {
            sourceUrl: 'https://sun9.userapi.com/image.jpg',
            width: 10,
            height: 20,
          },
        ],
      };
      client.posts.mockResolvedValue({
        posts: [input],
        skipped: 0,
        total: 1,
        nextOffset: null,
      });
      client.photo.mockResolvedValue(image);
      client.post.mockResolvedValue(input);
    });
    afterAll(async () => {
      if (db?.isInitialized) await db.destroy();
      if (control?.isInitialized) {
        await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await control.destroy();
      }
    });
    const pending = async () => {
      await journal.importPosts(0);
      return (await journal.list(page, 'pending', true)).items[0];
    };
    it('imports privately and deduplicates across separate server instances', async () => {
      const other = new JournalService(db, client as unknown as VkClient);
      const results = await Promise.all([
        journal.importPosts(0),
        other.importPosts(0),
      ]);
      expect(results.reduce((sum, r) => sum + r.added, 0)).toBe(1);
      expect((await journal.list(page)).items).toEqual([]);
      expect((await journal.list(page, 'pending')).items).toEqual([]);
      const post = (await journal.list(page, 'pending', true)).items[0];
      expect(JSON.stringify(post)).not.toContain('userapi.com');
      await expect(
        journal.photo(post.id, post.photos[0].id),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(client.photo).not.toHaveBeenCalled();
    });
    it('publishes only after explicit approval; public photos use the stored copy', async () => {
      const post = await pending();
      await journal.moderate(post.id, post.revision!, 'published', 42);
      expect((await journal.list(page)).items).toHaveLength(1);
      client.photo.mockRejectedValue(new Error('VK offline'));
      expect(await journal.photo(post.id, post.photos[0].id)).toEqual(image);
      expect(client.photo).toHaveBeenCalledTimes(1);
      const review = await db
        .getRepository(JournalReview)
        .findOneByOrFail({ postId: post.id });
      expect(review.administratorId).toBe(42);
      expect(review.action).toBe('published');
    });
    it('does not overwrite reviewed photos when another API instance completes a late download', async () => {
      const post = await pending();
      let started!: () => void;
      let finish!: (value: { data: Buffer; mime: string }) => void;
      const downloading = new Promise<void>((resolve) => {
        started = resolve;
      });
      const delayed = new Promise<{ data: Buffer; mime: string }>((resolve) => {
        finish = resolve;
      });
      const otherClient = {
        ...client,
        photo: () => {
          started();
          return delayed;
        },
      };
      const other = new JournalService(db, otherClient as unknown as VkClient);
      const late = other.photo(post.id, post.photos[0].id, true);
      await downloading;
      await journal.moderate(post.id, post.revision!, 'published', 42);
      finish({ data: Buffer.from('different bytes'), mime: 'image/jpeg' });
      expect(await late).toEqual(image);
      expect(await journal.photo(post.id, post.photos[0].id)).toEqual(image);
    });
    it('leaves a post private if any photo cannot be copied', async () => {
      const post = await pending();
      client.photo.mockRejectedValue(new Error('photo unavailable'));
      await expect(
        journal.moderate(post.id, post.revision!, 'published', 42),
      ).rejects.toThrow();
      expect((await journal.list(page)).total).toBe(0);
      expect(await db.getRepository(JournalReview).count()).toBe(0);
    });
    it('preserves rejection during reimport and prevents stale approval from another tab', async () => {
      const post = await pending();
      await journal.moderate(post.id, post.revision!, 'rejected', 42);
      expect((await journal.importPosts(0)).added).toBe(0);
      expect((await journal.list(page, 'rejected', true)).total).toBe(1);
      await expect(
        journal.moderate(post.id, post.revision!, 'published', 42),
      ).rejects.toBeInstanceOf(ConflictException);
      expect((await journal.list(page)).total).toBe(0);
    });
    it('withdraws both the post and photos, then requires a new review after refreshing VK', async () => {
      const post = await pending();
      const published = await journal.moderate(
        post.id,
        post.revision!,
        'published',
        42,
      );
      await expect(
        journal.refresh(post.id, published.revision!, 42),
      ).rejects.toBeInstanceOf(ConflictException);
      const withdrawn = await journal.moderate(
        post.id,
        published.revision!,
        'pending',
        42,
      );
      await expect(
        journal.photo(post.id, post.photos[0].id),
      ).rejects.toBeInstanceOf(NotFoundException);
      client.post.mockResolvedValue({ ...input, text: 'Обновлённый текст' });
      const refreshed = await journal.refresh(post.id, withdrawn.revision!, 42);
      expect(refreshed.text).toBe('Обновлённый текст');
      expect(refreshed.status).toBe('pending');
      expect(refreshed.photos[0].id).not.toBe(post.photos[0].id);
      expect((await journal.list(page)).total).toBe(0);
      await expect(
        journal.moderate(post.id, withdrawn.revision!, 'published', 42),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  },
);

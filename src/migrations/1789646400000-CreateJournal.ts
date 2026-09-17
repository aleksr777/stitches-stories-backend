import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateJournal1789646400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE journal_source (id integer PRIMARY KEY CHECK(id = 1), domain varchar(100) NOT NULL)`,
    );
    await q.query(
      `CREATE TABLE journal_post (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "vkOwnerId" bigint NOT NULL, "vkPostId" bigint NOT NULL, text text NOT NULL, "sourcePublishedAt" timestamptz NOT NULL, status varchar(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','rejected')), revision integer NOT NULL DEFAULT 1, "otherAttachments" jsonb NOT NULL DEFAULT '[]', "importedAt" timestamptz NOT NULL DEFAULT now(), "publishedAt" timestamptz, UNIQUE("vkOwnerId", "vkPostId"))`,
    );
    await q.query(
      `CREATE INDEX journal_post_status_date ON journal_post(status, "sourcePublishedAt")`,
    );
    await q.query(
      `CREATE TABLE journal_photo (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "postId" uuid NOT NULL REFERENCES journal_post(id) ON DELETE CASCADE, position integer NOT NULL, "sourceUrl" text NOT NULL, width integer NOT NULL, height integer NOT NULL, data bytea, mime varchar(32), UNIQUE("postId", position))`,
    );
    await q.query(
      `CREATE TABLE journal_review (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "postId" uuid NOT NULL, "administratorId" integer NOT NULL, revision integer NOT NULL, action varchar(16) NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now())`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'journal_review',
      'journal_photo',
      'journal_post',
      'journal_source',
    ])
      await q.query('DROP TABLE ' + table);
  }
}

import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  jsonb,
  primaryKey,
  integer,
  boolean,
  unique,
} from "drizzle-orm/pg-core";
import type { AdapterAccount } from "next-auth/adapters";

export const scheduledPostStatus = pgEnum("scheduled_post_status", [
  "queued",
  "submitted",
  "scheduled",
  "posted",
  "error",
  "cancelled",
]);

export const scheduledPosts = pgTable(
  "scheduled_post",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    draftId: text("draft_id").notNull(),
    platform: text("platform").notNull(),
    caption: text("caption").notNull(),
    mediaUrls: jsonb("media_urls").notNull().default([]),
    links: jsonb("links").notNull().default([]),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: scheduledPostStatus("status").notNull().default("queued"),
    publisherBackend: text("publisher_backend").notNull(),
    publisherWorkspaceId: text("publisher_workspace_id"),
    publisherPostId: text("publisher_post_id"),
    publisherErrorDetail: jsonb("publisher_error_detail"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("scheduled_post_source_draft_id_unique").on(t.source, t.draftId)]
);

export const publishAttempts = pgTable("publish_attempt", {
  id: uuid("id").defaultRandom().primaryKey(),
  scheduledPostId: uuid("scheduled_post_id")
    .notNull()
    .references(() => scheduledPosts.id, { onDelete: "cascade" }),
  attemptedAt: timestamp("attempted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  publisherBackend: text("publisher_backend").notNull(),
  ok: boolean("ok").notNull(),
  httpStatus: integer("http_status"),
  detail: text("detail"),
  externalId: text("external_id"),
});

export const socialProfiles = pgTable(
  "social_profile",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publisherBackend: text("publisher_backend").notNull(),
    publisherProfileId: text("publisher_profile_id").notNull(),
    network: text("network").notNull(),
    displayName: text("display_name"),
    workspaceId: text("workspace_id"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("social_profile_backend_profile_unique").on(
      t.publisherBackend,
      t.publisherProfileId
    ),
  ]
);

export const webhookSources = pgTable("webhook_source", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  hmacSecret: text("hmac_secret").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** NextAuth tables. Standard @auth/drizzle-adapter shape. */
export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date", withTimezone: true }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccount["type"]>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ]
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

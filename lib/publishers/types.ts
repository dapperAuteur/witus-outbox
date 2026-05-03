import "server-only";

export const PLATFORMS = [
  "twitter",
  "instagram",
  "facebook",
  "linkedin",
  "youtube",
  "bluesky",
  "tiktok",
  "pinterest",
] as const;

export type Platform = (typeof PLATFORMS)[number];

export const TERMINAL_STATUSES = ["posted", "error"] as const;
export type PublisherTerminalStatus = (typeof TERMINAL_STATUSES)[number];

export interface PostInput {
  caption: string;
  mediaUrls: string[];
  socialProfileIds: string[];
  scheduledAt: Date;
}

export type CreatePostResult =
  | { ok: true; externalId: string }
  | { ok: false; status: number; detail: string };

export interface PublisherSocialProfile {
  publisherProfileId: string;
  network: Platform | string;
  displayName: string | null;
  workspaceId: string | null;
}

export interface PublisherPostStatus {
  externalId: string;
  status: PublisherTerminalStatus | "scheduled" | "draft" | "pending_approval";
  errorDetail: string | null;
  postedAt: Date | null;
}

export interface PublisherAdapter {
  readonly backend: string;

  /** True when real credentials are present and this adapter will hit the network. */
  readonly isLive: boolean;

  listProfiles(): Promise<PublisherSocialProfile[]>;

  createPost(input: PostInput): Promise<CreatePostResult>;

  getPost(externalId: string): Promise<PublisherPostStatus | null>;

  getPostsByStatus(
    statuses: readonly PublisherTerminalStatus[],
    page: number
  ): Promise<{ posts: PublisherPostStatus[]; hasMore: boolean }>;

  updateScheduledAt(externalId: string, scheduledAt: Date): Promise<void>;

  deletePost(externalId: string): Promise<void>;
}

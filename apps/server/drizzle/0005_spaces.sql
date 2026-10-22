CREATE TABLE "space_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"changes" jsonb,
	"reason" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_bans" (
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"banned_by" uuid,
	"reason" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_bans_space_id_user_id_pk" PRIMARY KEY("space_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "space_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_category_overwrites" (
	"category_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"allow" integer DEFAULT 0 NOT NULL,
	"deny" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "space_category_overwrites_category_id_target_type_target_id_pk" PRIMARY KEY("category_id","target_type","target_id"),
	CONSTRAINT "space_category_overwrites_type_ck" CHECK ("space_category_overwrites"."target_type" in ('role', 'member')),
	CONSTRAINT "space_category_overwrites_bits_ck" CHECK (("space_category_overwrites"."allow" & "space_category_overwrites"."deny") = 0)
);
--> statement-breakpoint
CREATE TABLE "space_channel_overwrites" (
	"chat_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"allow" integer DEFAULT 0 NOT NULL,
	"deny" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "space_channel_overwrites_chat_id_target_type_target_id_pk" PRIMARY KEY("chat_id","target_type","target_id"),
	CONSTRAINT "space_channel_overwrites_type_ck" CHECK ("space_channel_overwrites"."target_type" in ('role', 'member')),
	CONSTRAINT "space_channel_overwrites_bits_ck" CHECK (("space_channel_overwrites"."allow" & "space_channel_overwrites"."deny") = 0)
);
--> statement-breakpoint
CREATE TABLE "space_invites" (
	"code" text PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"channel_id" uuid,
	"created_by" uuid,
	"max_uses" integer DEFAULT 0 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_member_roles" (
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "space_member_roles_space_id_user_id_role_id_pk" PRIMARY KEY("space_id","user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "space_members" (
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"nickname" text,
	"sort_name" text NOT NULL,
	"joined_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"timed_out_until" timestamp (3) with time zone,
	"server_mute" boolean DEFAULT false NOT NULL,
	"server_deaf" boolean DEFAULT false NOT NULL,
	"notify_level" text,
	"muted_until" timestamp (3) with time zone,
	"suppress_everyone" boolean DEFAULT false NOT NULL,
	CONSTRAINT "space_members_space_id_user_id_pk" PRIMARY KEY("space_id","user_id"),
	CONSTRAINT "space_members_notify_ck" CHECK ("space_members"."notify_level" is null or "space_members"."notify_level" in ('all', 'mentions', 'none'))
);
--> statement-breakpoint
CREATE TABLE "space_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"position" integer NOT NULL,
	"permissions" integer DEFAULT 0 NOT NULL,
	"hoist" boolean DEFAULT false NOT NULL,
	"mentionable" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_roles_color_ck" CHECK ("space_roles"."color" is null or "space_roles"."color" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "space_roles_perm_ck" CHECK ("space_roles"."permissions" >= 0),
	CONSTRAINT "space_roles_default_ck" CHECK ("space_roles"."is_default" = ("space_roles"."position" = 0))
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon_media_id" uuid,
	"banner_media_id" uuid,
	"owner_id" uuid NOT NULL,
	"created_by" uuid,
	"system_channel_id" uuid,
	"rules_channel_id" uuid,
	"afk_channel_id" uuid,
	"afk_timeout_sec" integer DEFAULT 300 NOT NULL,
	"default_notify_level" text DEFAULT 'mentions' NOT NULL,
	"is_discoverable" boolean DEFAULT false NOT NULL,
	"vanity_code" text,
	"member_count" integer DEFAULT 0 NOT NULL,
	"perm_version" integer DEFAULT 0 NOT NULL,
	"legacy_community_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_notify_ck" CHECK ("spaces"."default_notify_level" in ('all', 'mentions'))
);
--> statement-breakpoint
ALTER TABLE "chats" DROP CONSTRAINT "chats_type_ck";--> statement-breakpoint
ALTER TABLE "chat_members" ADD COLUMN "notify_level" text;--> statement-breakpoint
ALTER TABLE "chat_members" ADD COLUMN "last_sent_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "slowmode_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "nsfw" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "user_limit" integer;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "permissions_synced" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "mention_everyone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "mention_role_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "space_audit_log" ADD CONSTRAINT "space_audit_log_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_audit_log" ADD CONSTRAINT "space_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_bans" ADD CONSTRAINT "space_bans_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_bans" ADD CONSTRAINT "space_bans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_bans" ADD CONSTRAINT "space_bans_banned_by_users_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_categories" ADD CONSTRAINT "space_categories_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_category_overwrites" ADD CONSTRAINT "space_category_overwrites_category_id_space_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."space_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_channel_overwrites" ADD CONSTRAINT "space_channel_overwrites_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_invites" ADD CONSTRAINT "space_invites_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_invites" ADD CONSTRAINT "space_invites_channel_id_chats_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_invites" ADD CONSTRAINT "space_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_member_roles" ADD CONSTRAINT "space_member_roles_role_id_space_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."space_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_member_roles" ADD CONSTRAINT "space_member_roles_member_fk" FOREIGN KEY ("space_id","user_id") REFERENCES "public"."space_members"("space_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_roles" ADD CONSTRAINT "space_roles_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_icon_media_id_media_id_fk" FOREIGN KEY ("icon_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_banner_media_id_media_id_fk" FOREIGN KEY ("banner_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_system_channel_id_chats_id_fk" FOREIGN KEY ("system_channel_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_rules_channel_id_chats_id_fk" FOREIGN KEY ("rules_channel_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_afk_channel_id_chats_id_fk" FOREIGN KEY ("afk_channel_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_audit_log_space_idx" ON "space_audit_log" USING btree ("space_id","created_at");--> statement-breakpoint
CREATE INDEX "space_audit_log_created_idx" ON "space_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "space_categories_space_idx" ON "space_categories" USING btree ("space_id","position");--> statement-breakpoint
CREATE INDEX "space_channel_overwrites_target_idx" ON "space_channel_overwrites" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "space_invites_space_idx" ON "space_invites" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "space_invites_expires_idx" ON "space_invites" USING btree ("expires_at") WHERE "space_invites"."expires_at" is not null;--> statement-breakpoint
CREATE INDEX "space_member_roles_role_idx" ON "space_member_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "space_members_user_idx" ON "space_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "space_members_sort_idx" ON "space_members" USING btree ("space_id","sort_name","user_id");--> statement-breakpoint
CREATE INDEX "space_members_sort_prefix_idx" ON "space_members" USING btree ("space_id","sort_name" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "space_roles_space_idx" ON "space_roles" USING btree ("space_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "space_roles_default_uq" ON "space_roles" USING btree ("space_id") WHERE "space_roles"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_vanity_code_uq" ON "spaces" USING btree ("vanity_code");--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_legacy_community_uq" ON "spaces" USING btree ("legacy_community_id");--> statement-breakpoint
CREATE INDEX "spaces_owner_idx" ON "spaces" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "spaces_icon_idx" ON "spaces" USING btree ("icon_media_id") WHERE "spaces"."icon_media_id" is not null;--> statement-breakpoint
CREATE INDEX "spaces_banner_idx" ON "spaces" USING btree ("banner_media_id") WHERE "spaces"."banner_media_id" is not null;--> statement-breakpoint
CREATE INDEX "spaces_discoverable_idx" ON "spaces" USING btree ("member_count") WHERE "spaces"."is_discoverable";--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_category_id_space_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."space_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_members_joined_seq_idx" ON "chat_members" USING btree ("chat_id","joined_seq") WHERE "chat_members"."joined_seq" > 0;--> statement-breakpoint
CREATE INDEX "chats_space_idx" ON "chats" USING btree ("space_id","position") WHERE "chats"."space_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_mentions_idx" ON "messages" USING btree ("chat_id","seq") WHERE "messages"."mention_everyone" or "messages"."mentions" <> '{}'::uuid[] or "messages"."mention_role_ids" <> '{}'::uuid[];--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_space_ck" CHECK (("chats"."space_id" is not null) = ("chats"."type" in ('space_text', 'space_voice')));--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_space_cols_ck" CHECK ("chats"."type" in ('space_text', 'space_voice') or ("chats"."category_id" is null and "chats"."position" is null and "chats"."topic" is null and "chats"."user_limit" is null));--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_space_invite_ck" CHECK ("chats"."type" not in ('space_text', 'space_voice') or "chats"."invite_code" is null);--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_slowmode_ck" CHECK ("chats"."slowmode_seconds" between 0 and 21600);--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_type_ck" CHECK ("chats"."type" in ('direct', 'group', 'channel', 'space_text', 'space_voice'));
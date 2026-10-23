CREATE TABLE "channel_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_channel_id" uuid NOT NULL,
	"target_channel_id" uuid NOT NULL,
	"webhook_id" uuid,
	"created_by" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"space_id" uuid,
	"category" text NOT NULL,
	"details" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp (3) with time zone,
	"resolved_by" uuid,
	CONSTRAINT "reports_target_ck" CHECK ("reports"."target_type" in ('message', 'user', 'space')),
	CONSTRAINT "reports_status_ck" CHECK ("reports"."status" in ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "space_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"source_space_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"snapshot" jsonb NOT NULL,
	"created_by" uuid,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_ignores" (
	"user_id" uuid NOT NULL,
	"ignored_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_ignores_user_id_ignored_id_pk" PRIMARY KEY("user_id","ignored_id")
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"kind" text DEFAULT 'incoming' NOT NULL,
	"name" text NOT NULL,
	"avatar_media_id" uuid,
	"token_hash" text,
	"source_channel_id" uuid,
	"created_by" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhooks_kind_ck" CHECK ("webhooks"."kind" in ('incoming', 'follower')),
	CONSTRAINT "webhooks_follower_ck" CHECK (("webhooks"."kind" = 'follower') = ("webhooks"."source_channel_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_system_sender_ck";--> statement-breakpoint
ALTER TABLE "chat_members" ADD COLUMN "request_state" text;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "is_news" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "voice_status" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "webhook_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "author_override" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "embeds" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "flags" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "crosspost_of" uuid;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "allow_dms" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_follows" ADD CONSTRAINT "channel_follows_source_channel_id_chats_id_fk" FOREIGN KEY ("source_channel_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_follows" ADD CONSTRAINT "channel_follows_target_channel_id_chats_id_fk" FOREIGN KEY ("target_channel_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_follows" ADD CONSTRAINT "channel_follows_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_follows" ADD CONSTRAINT "channel_follows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_templates" ADD CONSTRAINT "space_templates_source_space_id_spaces_id_fk" FOREIGN KEY ("source_space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_templates" ADD CONSTRAINT "space_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ignores" ADD CONSTRAINT "user_ignores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ignores" ADD CONSTRAINT "user_ignores_ignored_id_users_id_fk" FOREIGN KEY ("ignored_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_channel_id_chats_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_avatar_media_id_media_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_source_channel_id_chats_id_fk" FOREIGN KEY ("source_channel_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_follows_pair_uq" ON "channel_follows" USING btree ("source_channel_id","target_channel_id");--> statement-breakpoint
CREATE INDEX "channel_follows_target_idx" ON "channel_follows" USING btree ("target_channel_id");--> statement-breakpoint
CREATE INDEX "reports_space_idx" ON "reports" USING btree ("space_id","status","created_at") WHERE "reports"."space_id" is not null;--> statement-breakpoint
CREATE INDEX "reports_reporter_idx" ON "reports" USING btree ("reporter_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "space_templates_code_uq" ON "space_templates" USING btree ("code");--> statement-breakpoint
CREATE INDEX "space_templates_source_idx" ON "space_templates" USING btree ("source_space_id");--> statement-breakpoint
CREATE INDEX "user_ignores_ignored_idx" ON "user_ignores" USING btree ("ignored_id");--> statement-breakpoint
CREATE INDEX "webhooks_channel_idx" ON "webhooks" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "webhooks_space_idx" ON "webhooks" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "webhooks_source_idx" ON "webhooks" USING btree ("source_channel_id") WHERE "webhooks"."source_channel_id" is not null;--> statement-breakpoint
CREATE INDEX "webhooks_avatar_idx" ON "webhooks" USING btree ("avatar_media_id") WHERE "webhooks"."avatar_media_id" is not null;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_crosspost_of_messages_id_fk" FOREIGN KEY ("crosspost_of") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_members_requests_idx" ON "chat_members" USING btree ("user_id","request_state") WHERE "chat_members"."request_state" is not null;--> statement-breakpoint
CREATE INDEX "messages_crosspost_of_idx" ON "messages" USING btree ("crosspost_of") WHERE "messages"."crosspost_of" is not null;--> statement-breakpoint
CREATE INDEX "messages_webhook_idx" ON "messages" USING btree ("webhook_id") WHERE "messages"."webhook_id" is not null;--> statement-breakpoint
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_request_ck" CHECK ("chat_members"."request_state" is null or "chat_members"."request_state" in ('pending', 'ignored'));--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_news_ck" CHECK (not "chats"."is_news" or "chats"."type" = 'space_text');--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_voice_status_ck" CHECK ("chats"."voice_status" is null or "chats"."type" in ('space_voice', 'space_stage'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_system_sender_ck" CHECK (("messages"."type" = 'system') = ("messages"."sender_id" is null and "messages"."author_override" is null));
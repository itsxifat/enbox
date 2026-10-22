CREATE TABLE "automod_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"exempt_role_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"exempt_channel_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"creator_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automod_rules_trigger_ck" CHECK ("automod_rules"."trigger_type" in ('keyword', 'spam_links', 'mention_spam', 'preset'))
);
--> statement-breakpoint
CREATE TABLE "space_event_interests" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_event_interests_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "space_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"channel_id" uuid,
	"creator_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"entity_type" text NOT NULL,
	"location" text,
	"start_at" timestamp (3) with time zone NOT NULL,
	"end_at" timestamp (3) with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"image_media_id" uuid,
	"interested_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_events_entity_ck" CHECK ("space_events"."entity_type" in ('voice', 'external')),
	CONSTRAINT "space_events_status_ck" CHECK ("space_events"."status" in ('scheduled', 'active', 'completed', 'canceled'))
);
--> statement-breakpoint
ALTER TABLE "chats" DROP CONSTRAINT "chats_type_ck";--> statement-breakpoint
ALTER TABLE "chats" DROP CONSTRAINT "chats_space_ck";--> statement-breakpoint
ALTER TABLE "chats" DROP CONSTRAINT "chats_space_cols_ck";--> statement-breakpoint
ALTER TABLE "chats" DROP CONSTRAINT "chats_space_invite_ck";--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "forum_tags" jsonb;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "forum_settings" jsonb;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "applied_tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "onboarded_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "discovery_category" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "discovery_tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "welcome_screen" jsonb;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "onboarding" jsonb;--> statement-breakpoint
ALTER TABLE "automod_rules" ADD CONSTRAINT "automod_rules_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automod_rules" ADD CONSTRAINT "automod_rules_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_event_interests" ADD CONSTRAINT "space_event_interests_event_id_space_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."space_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_event_interests" ADD CONSTRAINT "space_event_interests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_events" ADD CONSTRAINT "space_events_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_events" ADD CONSTRAINT "space_events_channel_id_chats_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_events" ADD CONSTRAINT "space_events_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_events" ADD CONSTRAINT "space_events_image_media_id_media_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automod_rules_space_idx" ON "automod_rules" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "space_event_interests_user_idx" ON "space_event_interests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "space_events_space_idx" ON "space_events" USING btree ("space_id","start_at");--> statement-breakpoint
CREATE INDEX "space_events_open_idx" ON "space_events" USING btree ("start_at") WHERE "space_events"."status" in ('scheduled', 'active');--> statement-breakpoint
CREATE INDEX "space_events_image_idx" ON "space_events" USING btree ("image_media_id") WHERE "space_events"."image_media_id" is not null;--> statement-breakpoint
CREATE INDEX "spaces_discovery_idx" ON "spaces" USING btree ("member_count") WHERE "spaces"."is_discoverable";--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_type_ck" CHECK ("chats"."type" in ('direct', 'group', 'channel', 'space_text', 'space_voice', 'space_thread', 'space_forum'));--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_space_ck" CHECK (("chats"."space_id" is not null) = ("chats"."type" in ('space_text', 'space_voice', 'space_thread', 'space_forum')));--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_space_cols_ck" CHECK ("chats"."type" in ('space_text', 'space_voice', 'space_forum') or ("chats"."category_id" is null and "chats"."position" is null and "chats"."topic" is null and "chats"."user_limit" is null));--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_space_invite_ck" CHECK ("chats"."type" not in ('space_text', 'space_voice', 'space_thread', 'space_forum') or "chats"."invite_code" is null);
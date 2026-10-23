CREATE TABLE "space_active_daily" (
	"space_id" uuid NOT NULL,
	"day" date NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "space_active_daily_space_id_day_user_id_pk" PRIMARY KEY("space_id","day","user_id")
);
--> statement-breakpoint
CREATE TABLE "space_channel_stats_daily" (
	"space_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"day" date NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "space_channel_stats_daily_channel_id_day_pk" PRIMARY KEY("channel_id","day")
);
--> statement-breakpoint
CREATE TABLE "space_member_channels" (
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"shown" boolean NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_member_channels_user_id_channel_id_pk" PRIMARY KEY("user_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "space_stats_daily" (
	"space_id" uuid NOT NULL,
	"day" date NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"joins" integer DEFAULT 0 NOT NULL,
	"leaves" integer DEFAULT 0 NOT NULL,
	"voice_minutes" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "space_stats_daily_space_id_day_pk" PRIMARY KEY("space_id","day")
);
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "onboarding_answers" jsonb;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "guide_done" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "invites_paused_until" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "dms_paused_until" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "safety_alerts_channel_id" uuid;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "raid_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "guide" jsonb;--> statement-breakpoint
ALTER TABLE "space_active_daily" ADD CONSTRAINT "space_active_daily_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_active_daily" ADD CONSTRAINT "space_active_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_channel_stats_daily" ADD CONSTRAINT "space_channel_stats_daily_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_channel_stats_daily" ADD CONSTRAINT "space_channel_stats_daily_channel_id_chats_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_member_channels" ADD CONSTRAINT "space_member_channels_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_member_channels" ADD CONSTRAINT "space_member_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_member_channels" ADD CONSTRAINT "space_member_channels_channel_id_chats_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_stats_daily" ADD CONSTRAINT "space_stats_daily_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_channel_stats_space_idx" ON "space_channel_stats_daily" USING btree ("space_id","day");--> statement-breakpoint
CREATE INDEX "space_member_channels_space_idx" ON "space_member_channels" USING btree ("space_id","user_id");--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_safety_alerts_channel_id_chats_id_fk" FOREIGN KEY ("safety_alerts_channel_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_sender_created_idx" ON "messages" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE INDEX "space_audit_log_target_idx" ON "space_audit_log" USING btree ("space_id","target_id","created_at") WHERE "space_audit_log"."target_id" is not null;
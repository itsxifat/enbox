CREATE TABLE "message_attachments" (
	"message_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"media_id" uuid NOT NULL,
	"description" text,
	CONSTRAINT "message_attachments_message_id_position_pk" PRIMARY KEY("message_id","position")
);
--> statement-breakpoint
CREATE TABLE "space_sounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"volume" real DEFAULT 1 NOT NULL,
	"media_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_sounds_volume_ck" CHECK ("space_sounds"."volume" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "space_stickers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"emoji" text,
	"media_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_backup_codes" (
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp (3) with time zone,
	CONSTRAINT "user_backup_codes_user_id_code_hash_pk" PRIMARY KEY("user_id","code_hash")
);
--> statement-breakpoint
ALTER TABLE "chats" DROP CONSTRAINT "chats_type_ck";--> statement-breakpoint
ALTER TABLE "chats" DROP CONSTRAINT "chats_space_ck";--> statement-breakpoint
ALTER TABLE "chats" DROP CONSTRAINT "chats_space_cols_ck";--> statement-breakpoint
ALTER TABLE "chats" DROP CONSTRAINT "chats_space_invite_ck";--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "is_group_dm" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sticker_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_pending_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "voice_states" ADD COLUMN "suppressed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_states" ADD COLUMN "request_to_speak_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_sounds" ADD CONSTRAINT "space_sounds_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_sounds" ADD CONSTRAINT "space_sounds_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_sounds" ADD CONSTRAINT "space_sounds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_stickers" ADD CONSTRAINT "space_stickers_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_stickers" ADD CONSTRAINT "space_stickers_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_stickers" ADD CONSTRAINT "space_stickers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_backup_codes" ADD CONSTRAINT "user_backup_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_attachments_media_idx" ON "message_attachments" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "space_sounds_space_idx" ON "space_sounds" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "space_sounds_media_idx" ON "space_sounds" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_stickers_name_uq" ON "space_stickers" USING btree ("space_id",lower("name"));--> statement-breakpoint
CREATE INDEX "space_stickers_media_idx" ON "space_stickers" USING btree ("media_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sticker_id_space_stickers_id_fk" FOREIGN KEY ("sticker_id") REFERENCES "public"."space_stickers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_sticker_idx" ON "messages" USING btree ("sticker_id") WHERE "messages"."sticker_id" is not null;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_type_ck" CHECK ("chats"."type" in ('direct', 'group', 'channel', 'space_text', 'space_voice', 'space_thread', 'space_forum', 'space_stage'));--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_space_ck" CHECK (("chats"."space_id" is not null) = ("chats"."type" in ('space_text', 'space_voice', 'space_thread', 'space_forum', 'space_stage')));--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_space_cols_ck" CHECK ("chats"."type" in ('space_text', 'space_voice', 'space_forum', 'space_stage') or ("chats"."category_id" is null and "chats"."position" is null and "chats"."topic" is null and "chats"."user_limit" is null));--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_space_invite_ck" CHECK ("chats"."type" not in ('space_text', 'space_voice', 'space_thread', 'space_forum', 'space_stage') or "chats"."invite_code" is null);
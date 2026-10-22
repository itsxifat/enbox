CREATE TABLE "friend_requests" (
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_requests_from_id_to_id_pk" PRIMARY KEY("from_id","to_id")
);
--> statement-breakpoint
CREATE TABLE "space_emojis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"media_id" uuid NOT NULL,
	"animated" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_emojis_name_ck" CHECK ("space_emojis"."name" ~ '^[A-Za-z0-9_]{2,32}$')
);
--> statement-breakpoint
ALTER TABLE "chats" DROP CONSTRAINT "chats_type_ck";--> statement-breakpoint
ALTER TABLE "chats" DROP CONSTRAINT "chats_space_ck";--> statement-breakpoint
ALTER TABLE "message_reactions" DROP CONSTRAINT "message_reactions_message_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji");--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "thread_starter_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "thread_archived_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "thread_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "thread_auto_archive_minutes" integer;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "thread_message_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD COLUMN "emoji_id" uuid;--> statement-breakpoint
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_from_id_users_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_to_id_users_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_emojis" ADD CONSTRAINT "space_emojis_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_emojis" ADD CONSTRAINT "space_emojis_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_emojis" ADD CONSTRAINT "space_emojis_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friend_requests_to_idx" ON "friend_requests" USING btree ("to_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "space_emojis_name_uq" ON "space_emojis" USING btree ("space_id",lower("name"));--> statement-breakpoint
CREATE INDEX "space_emojis_media_idx" ON "space_emojis" USING btree ("media_id");--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_parent_id_chats_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_thread_starter_id_messages_id_fk" FOREIGN KEY ("thread_starter_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chats_parent_idx" ON "chats" USING btree ("parent_id","last_message_at") WHERE "chats"."parent_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "chats_thread_starter_uq" ON "chats" USING btree ("thread_starter_id") WHERE "chats"."thread_starter_id" is not null;--> statement-breakpoint
CREATE INDEX "chats_thread_open_idx" ON "chats" USING btree ("last_message_at") WHERE "chats"."type" = 'space_thread' and "chats"."thread_archived_at" is null;--> statement-breakpoint
CREATE INDEX "message_reactions_emoji_idx" ON "message_reactions" USING btree ("message_id","emoji","created_at");--> statement-breakpoint
CREATE INDEX "messages_mentions_gin" ON "messages" USING gin ("mentions");--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_thread_ck" CHECK (("chats"."parent_id" is not null) = ("chats"."type" = 'space_thread'));--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_type_ck" CHECK ("chats"."type" in ('direct', 'group', 'channel', 'space_text', 'space_voice', 'space_thread'));--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_space_ck" CHECK (("chats"."space_id" is not null) = ("chats"."type" in ('space_text', 'space_voice', 'space_thread')));
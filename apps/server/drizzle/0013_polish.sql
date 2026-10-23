CREATE TABLE "thread_follows" (
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_follows_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "message_reactions" ADD COLUMN "burst" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "message_reactions" DROP CONSTRAINT "message_reactions_message_id_user_id_emoji_pk";--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_user_id_emoji_burst_pk" PRIMARY KEY("message_id","user_id","emoji","burst");--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "thread_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "forwarded_from" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "poll_ends_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "poll_closed_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "tag" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "tag_badge" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "tag_color" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tag_space_id" uuid;--> statement-breakpoint
ALTER TABLE "thread_follows" ADD CONSTRAINT "thread_follows_thread_id_chats_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_follows" ADD CONSTRAINT "thread_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_follows" ADD CONSTRAINT "thread_follows_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thread_follows_user_idx" ON "thread_follows" USING btree ("user_id","space_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tag_space_id_spaces_id_fk" FOREIGN KEY ("tag_space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chats_thread_pinned_uq" ON "chats" USING btree ("parent_id") WHERE "chats"."thread_pinned";--> statement-breakpoint
CREATE INDEX "messages_poll_open_idx" ON "messages" USING btree ("poll_ends_at") WHERE "messages"."poll_ends_at" is not null and "messages"."poll_closed_at" is null;--> statement-breakpoint
CREATE INDEX "users_tag_space_idx" ON "users" USING btree ("tag_space_id") WHERE "users"."tag_space_id" is not null;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_tag_ck" CHECK (("spaces"."tag" is null) = ("spaces"."tag_badge" is null) and ("spaces"."tag" is null) = ("spaces"."tag_color" is null) and ("spaces"."tag" is null or char_length("spaces"."tag") between 2 and 4) and ("spaces"."tag_color" is null or "spaces"."tag_color" ~ '^#[0-9a-f]{6}$'));
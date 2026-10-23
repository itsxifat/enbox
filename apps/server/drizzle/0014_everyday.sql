CREATE TABLE "friend_invites" (
	"code" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"max_uses" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_bookmarks" (
	"user_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"remind_at" timestamp (3) with time zone,
	"reminded_at" timestamp (3) with time zone,
	CONSTRAINT "message_bookmarks_user_id_message_id_pk" PRIMARY KEY("user_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferences_updated_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "friend_invites" ADD CONSTRAINT "friend_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_bookmarks" ADD CONSTRAINT "message_bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_bookmarks" ADD CONSTRAINT "message_bookmarks_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_bookmarks" ADD CONSTRAINT "message_bookmarks_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friend_invites_user_idx" ON "friend_invites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_bookmarks_user_idx" ON "message_bookmarks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "message_bookmarks_due_idx" ON "message_bookmarks" USING btree ("remind_at") WHERE "message_bookmarks"."remind_at" is not null and "message_bookmarks"."reminded_at" is null;
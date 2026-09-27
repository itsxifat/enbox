ALTER TABLE "media" ADD COLUMN "animated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "frame_count" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "metadata_stripped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banner_media_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pronouns" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_color" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "accent_color" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "availability" text DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "availability_until" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "presence_note_text" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "presence_note_emoji" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "presence_note_expires_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_banner_media_id_media_id_fk" FOREIGN KEY ("banner_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_banner_idx" ON "users" USING btree ("banner_media_id") WHERE "users"."banner_media_id" is not null;--> statement-breakpoint
CREATE INDEX "users_availability_until_idx" ON "users" USING btree ("availability_until") WHERE "users"."availability_until" is not null;--> statement-breakpoint
CREATE INDEX "users_presence_note_expires_idx" ON "users" USING btree ("presence_note_expires_at") WHERE "users"."presence_note_expires_at" is not null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_profile_color_ck" CHECK ("users"."profile_color" is null or "users"."profile_color" ~ '^#[0-9a-f]{6}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_accent_color_ck" CHECK ("users"."accent_color" is null or "users"."accent_color" ~ '^#[0-9a-f]{6}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_availability_ck" CHECK ("users"."availability" in ('online', 'idle', 'dnd', 'invisible'));--> statement-breakpoint
UPDATE "media" SET "animated" = true WHERE "kind" = 'image' AND "mime_type" = 'image/gif';
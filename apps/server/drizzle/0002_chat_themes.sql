ALTER TABLE "chat_members" ADD COLUMN "theme" jsonb;--> statement-breakpoint
ALTER TABLE "chat_members" ADD COLUMN "wallpaper_media_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "theme" jsonb;--> statement-breakpoint
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_wallpaper_media_id_media_id_fk" FOREIGN KEY ("wallpaper_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_members_wallpaper_idx" ON "chat_members" USING btree ("wallpaper_media_id") WHERE "chat_members"."wallpaper_media_id" is not null;
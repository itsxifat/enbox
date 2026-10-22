CREATE TABLE "user_notes" (
	"owner_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"note" text NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_notes_owner_id_subject_id_pk" PRIMARY KEY("owner_id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "avatar_media_id" uuid;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "banner_media_id" uuid;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "pronouns" text;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "profile_color" text;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "accent_color" text;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "avatar_decoration" text;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "profile_effect" text;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "nameplate" text;--> statement-breakpoint
ALTER TABLE "space_roles" ADD COLUMN "color_style" text DEFAULT 'solid' NOT NULL;--> statement-breakpoint
ALTER TABLE "space_roles" ADD COLUMN "color_secondary" text;--> statement-breakpoint
ALTER TABLE "space_roles" ADD COLUMN "icon_emoji" text;--> statement-breakpoint
ALTER TABLE "space_roles" ADD COLUMN "icon_media_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_decoration" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_effect" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "nameplate" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name_style" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rail_layout" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notes" ADD CONSTRAINT "user_notes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notes" ADD CONSTRAINT "user_notes_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_notes_subject_idx" ON "user_notes" USING btree ("subject_id");--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_avatar_media_id_media_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_banner_media_id_media_id_fk" FOREIGN KEY ("banner_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_roles" ADD CONSTRAINT "space_roles_icon_media_id_media_id_fk" FOREIGN KEY ("icon_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_members_avatar_idx" ON "space_members" USING btree ("avatar_media_id") WHERE "space_members"."avatar_media_id" is not null;--> statement-breakpoint
CREATE INDEX "space_members_banner_idx" ON "space_members" USING btree ("banner_media_id") WHERE "space_members"."banner_media_id" is not null;--> statement-breakpoint
CREATE INDEX "space_roles_icon_idx" ON "space_roles" USING btree ("icon_media_id") WHERE "space_roles"."icon_media_id" is not null;--> statement-breakpoint
ALTER TABLE "space_roles" ADD CONSTRAINT "space_roles_color2_ck" CHECK ("space_roles"."color_secondary" is null or "space_roles"."color_secondary" ~ '^#[0-9a-f]{6}$');--> statement-breakpoint
ALTER TABLE "space_roles" ADD CONSTRAINT "space_roles_style_ck" CHECK ("space_roles"."color_style" in ('solid', 'gradient', 'holographic'));
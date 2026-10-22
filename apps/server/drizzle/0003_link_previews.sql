CREATE TABLE "link_previews" (
	"url" text PRIMARY KEY NOT NULL,
	"domain" text,
	"site_name" text,
	"title" text,
	"description" text,
	"theme_color" text,
	"image_key" text,
	"image_width" integer,
	"image_height" integer,
	"fetched_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "link_previews_fetched_idx" ON "link_previews" USING btree ("fetched_at");
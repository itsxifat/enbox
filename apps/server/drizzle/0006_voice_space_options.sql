CREATE TABLE "voice_states" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"socket_id" text NOT NULL,
	"node_id" text NOT NULL,
	"self_mute" boolean DEFAULT false NOT NULL,
	"self_deaf" boolean DEFAULT false NOT NULL,
	"self_video" boolean DEFAULT false NOT NULL,
	"self_stream" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "bitrate" integer;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "suppress_roles" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "hide_muted_channels" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "system_flags" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "verification_level" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "explicit_filter" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_states" ADD CONSTRAINT "voice_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_states" ADD CONSTRAINT "voice_states_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_states" ADD CONSTRAINT "voice_states_channel_id_chats_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_states_channel_idx" ON "voice_states" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "voice_states_space_idx" ON "voice_states" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "voice_states_node_idx" ON "voice_states" USING btree ("node_id");
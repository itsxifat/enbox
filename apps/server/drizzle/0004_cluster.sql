CREATE TABLE "cluster_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_participants" ADD COLUMN "socket_id" text;--> statement-breakpoint
ALTER TABLE "call_participants" ADD COLUMN "node_id" text;--> statement-breakpoint
CREATE INDEX "cluster_nodes_heartbeat_idx" ON "cluster_nodes" USING btree ("heartbeat_at");
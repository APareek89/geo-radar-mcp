ALTER TABLE "brands" ALTER COLUMN "owner" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "brands" ALTER COLUMN "owner" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_name_owner_unique" ON "brands" USING btree ("name","owner");
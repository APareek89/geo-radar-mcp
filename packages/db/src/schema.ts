import { pgTable, uuid, text, timestamp, real, date } from "drizzle-orm/pg-core";

/**
 * Postgres schema (Drizzle). Mirrors PRD §7. `text().array()` maps to Postgres
 * `text[]`, which cleanly holds the domains[]/mentions[]/cited_domains[] columns.
 */

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  domains: text("domains").array().notNull().default([]),
  owner: text("owner"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const competitors = pgTable("competitors", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  domains: text("domains").array().notNull().default([]),
});

export const promptSets = pgTable("prompt_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  prompts: text("prompts").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const panelRuns = pgTable("panel_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  promptSetId: text("prompt_set_id"),
  panel: text("panel").array().notNull().default([]),
  // queued | running | completed | failed
  status: text("status").notNull().default("queued"),
  costUsd: real("cost_usd").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const answers = pgTable("answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => panelRuns.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  prompt: text("prompt").notNull(),
  rawAnswer: text("raw_answer").notNull(),
  mentions: text("mentions").array().notNull().default([]),
  citedDomains: text("cited_domains").array().notNull().default([]),
  sentiment: text("sentiment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sovHistory = pgTable("sov_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  runId: uuid("run_id"),
  date: date("date").notNull(),
  sov: real("sov").notNull(),
  citationShare: real("citation_share"),
  sentimentScore: real("sentiment_score"),
});

export const hallucinations = pgTable("hallucinations", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => panelRuns.id, { onDelete: "cascade" }),
  claim: text("claim").notNull(),
  contradictsFact: text("contradicts_fact").notNull(),
  severity: text("severity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

---
name: db_query
description: Execute SQL queries against the Supabase database to fetch metrics, check logs, view tables, or query monitor states.
tags: [database, db, query, sql, postgres, supabase]
triggers: [database query, select, sql, table schema, select from, postgres]
---

# Database Query Skill

Use this skill when you need to run read/write queries against the Supabase Postgres instance. Under the hood, this routes to `databaseTools.executeQuery()`.

## Usage Guidelines
- Provide valid SQL statements.
- Avoid unsafe operations unless specifically authorized by admin constraints.

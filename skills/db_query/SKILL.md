---
name: db_query
description: Execute SQL queries against the Supabase database to fetch metrics, check logs, view tables, or query monitor states.
tags: [database, db, query, sql, postgres, supabase]
triggers: [database query, select, sql, table schema, select from, postgres]
---

# Database Query Skill

Use this skill when you need to run read/write queries against the Supabase Postgres instance. Under the hood, this routes to `databaseTools.executeQuery()`.

## Usage Guidelines
- - Always verify table names *first* by running `SELECT tablename FROM pg_tables WHERE schemaname = 'public';` and use the exact name returned in your subsequent query. Table names are case-sensitive, may have prefixes, and might not be intuitive (e.g., 'user_memory' instead of 'memories'). This prevents 'relation does not exist' errors.
- Provide valid SQL statements.
- Avoid unsafe operations unless specifically authorized by admin constraints.

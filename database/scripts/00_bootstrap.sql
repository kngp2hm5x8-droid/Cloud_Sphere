-- Run ONCE as a PostgreSQL superuser (on Homebrew installs this is your macOS user):
--   psql postgres -v migrator_pw="'choose-a-password'" -v app_pw="'choose-another'" \
--        -f database/scripts/00_bootstrap.sql
-- To redo: DROP DATABASE cloudsphere; DROP ROLE cloudsphere_app; DROP ROLE cloudsphere_migrator;

CREATE ROLE cloudsphere_migrator LOGIN PASSWORD :migrator_pw;  -- owns the schema, runs migrations
CREATE ROLE cloudsphere_app      LOGIN PASSWORD :app_pw;       -- used by the API: DML only, no DDL

CREATE DATABASE cloudsphere OWNER cloudsphere_migrator;

\connect cloudsphere

REVOKE ALL ON DATABASE cloudsphere FROM PUBLIC;
GRANT CONNECT ON DATABASE cloudsphere TO cloudsphere_app;

ALTER SCHEMA public OWNER TO cloudsphere_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO cloudsphere_app;

-- Objects created later by the migrator are automatically usable (DML) by the app role.
ALTER DEFAULT PRIVILEGES FOR ROLE cloudsphere_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cloudsphere_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cloudsphere_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cloudsphere_app;

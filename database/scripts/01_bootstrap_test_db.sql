-- Creates the throwaway TEST database used by `npm test`. Run ONCE as a PostgreSQL superuser, after 00_bootstrap.sql
-- (it reuses the same two roles, so it needs no passwords):
--   psql postgres -f database/scripts/01_bootstrap_test_db.sql
-- Then:  cd backend && npm run migrate:test
--
-- The test suite empties this database before every run. It refuses to run against any database
-- whose name does not end in "_test", so your development data in "cloudsphere" is never touched.

CREATE DATABASE cloudsphere_test OWNER cloudsphere_migrator;

\connect cloudsphere_test

REVOKE ALL ON DATABASE cloudsphere_test FROM PUBLIC;
GRANT CONNECT ON DATABASE cloudsphere_test TO cloudsphere_app;

ALTER SCHEMA public OWNER TO cloudsphere_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO cloudsphere_app;

ALTER DEFAULT PRIVILEGES FOR ROLE cloudsphere_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cloudsphere_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cloudsphere_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cloudsphere_app;

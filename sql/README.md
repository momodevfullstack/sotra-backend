# SQL scripts

The local `create_auth_tables.sql` and `reset_test_data.sql` files are intentionally
not published:

- The authentication setup script creates accounts with a shared default password.
- The test-data reset script deletes application data.

Keep local copies out of GitHub. Create accounts with unique credentials and use a
reviewed, backed-up database procedure for any data cleanup.

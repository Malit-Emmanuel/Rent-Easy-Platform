# S10: Role grants are audited

Every grant or removal of a privileged platform role (reviewer, support, super_admin) is now written to the hash-chained audit trail by the database itself (trigger `platform_roles_audit`, migration 0019). It catches grants made by hand in SQL as well as any future screen. The automatic "tenant" role given at sign-up is not logged.

Events: `identity.platform_role_granted` and `identity.platform_role_revoked`. Subject: the user. Metadata: the role and the database login. No phone numbers or names.

## Making a grant by hand (do it this way)
In one transaction, name who is doing it, then change the role:

    BEGIN;
    SET LOCAL zuri.actor_id = '<user id of the person making the change>';
    INSERT INTO identity.platform_roles (user_id, role) VALUES ('<user id>', 'super_admin');
    COMMIT;

Without the first line the event is still recorded, with no actor. A bad value never blocks the change.

## Checks
Database rules `db/tests/rules_s10.sql` (6 passed): grant recorded, actor recorded, removal recorded, tenant not logged, bad actor setting harmless, audit chain still verifies. API suite: 341 of 341 pass.

## Not done
There is still no screen for granting roles; it stays a deliberate manual step. Past grants (including the temporary super_admin on the account ending 477) are in the trail only by hand-written entry.

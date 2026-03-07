-- Force-confirm all existing unconfirmed users (sandbox only).
UPDATE auth.users
SET email_confirmed_at = NOW()
WHERE email_confirmed_at IS NULL;

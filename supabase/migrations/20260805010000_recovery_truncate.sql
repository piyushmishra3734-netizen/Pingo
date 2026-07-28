-- The audit trail has to outlive the device that appears in it.
--
-- `revoke insert, update, delete` left TRUNCATE in place, and TRUNCATE empties
-- a table wholesale. A device that opened a recovery request could therefore
-- erase every record that it had -- which is precisely the evidence the delay
-- exists to create. Caught by reading the granted privileges back rather than
-- by trusting the revoke to have covered it.
revoke truncate on public.recovery_requests from authenticated, anon;
revoke truncate on public.recovery_packages from authenticated, anon;

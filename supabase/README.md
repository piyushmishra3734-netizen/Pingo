# Supabase configuration

Auth configuration for PINGO, kept in the repository so it is reviewable and
reproducible rather than living only in a dashboard nobody can diff.

`config.toml` drives `supabase start` locally and `supabase config push` on a
linked project. The hosted project's dashboard has to match it — the settings
below are the ones that will break the flow if they drift.

---

## There is no OTP in this product

Both credential doors are **identifier + password**. Nothing sends a code, and
nothing sends a confirmation link. The email templates that existed for the old
six-digit flow have been deleted along with the screens that used them.

That is a real security trade, not just a simplification. **An email address or
phone number on an account is now a claim, not a verified fact.** Anything that
would depend on that proof needs a verification step of its own:

| Feature | Why it needs verification first |
| --- | --- |
| Contact discovery by number ([§ 12](../docs/01-onboarding-auth.md#12-contacts)) | Matching on unverified numbers lets anyone be found as anyone |
| Email reset link ([§ 14](../docs/01-onboarding-auth.md#14-forgot-password--triage)) | A reset sent to an unproven address is an account-takeover primitive |

Neither is built yet, so nothing currently relies on the missing proof.

---

## Phone sign-in does not use Supabase's phone provider

It cannot. Supabase refuses to enable that provider without SMS credentials —
Twilio, Messagebird, Textlocal or Vonage, with no "none" option — and it holds
that line **even with phone confirmations off**, when not a single SMS would
ever be sent. A paid SMS account to send zero messages is not a reasonable
dependency.

So a phone account is a real Supabase user keyed on a derived address:

```
+91 98765 43210  →  919876543210@phone.pingo.chat
```

The derivation is deterministic, so sign-up, sign-in and the § 17 duplicate
check behave exactly as they do for email — underneath, they *are* the email
path. The number itself is stored on the account as `user_metadata.pingo_phone`
and that is what the product displays; the derived address is plumbing and is
never shown to a user.

**`phone.pingo.chat` is reserved.** The email door rejects any address in that
domain with `invalid_identifier`. Without that check, typing
`919876543210@phone.pingo.chat` into the email screen would let anyone take over
a phone account. Verified: the rejection holds even when the password is
correct.

**Authentication never reads the metadata.** A user can edit their own
`user_metadata`, so if sign-in trusted it, anyone could point their account at
someone else's number. The address is always re-derived from what was typed;
metadata is display only.

### Migrating to the native provider later

If SMS is ever budgeted for, enable the phone provider and backfill: copy
`user_metadata.pingo_phone` into `auth.users.phone`, then re-point
`SupabasePasswordAuth` at `{ phone, password }`. Existing accounts keep their
ids, so nothing downstream breaks.

---

## Settings the flow depends on

**Authentication → Sign In / Providers**

| Provider | Setting | Required | If it is wrong |
| --- | --- | --- | --- |
| Email | Enabled | **on** | Every email *and phone* call fails `provider_disabled` |
| Email | Confirm email | **off** | `signUp` returns no session; the user is stranded one step from Home |
| Phone | Enabled | **not needed** | Nothing calls it — see the section above |
| Google | Enabled | **on** | The Google row leads to a provider error |
| Google | Client ID / Secret | set | From Google Cloud → Credentials → OAuth 2.0 Client ID |

`SupabaseAuthService.assertSession` converts a confirmation-required response
into an explicit `identity_unconfirmed` error. Without that, a `session: null`
reads as success and presents as a UI bug for a day before anyone checks the
dashboard.

### Google redirect URLs

**Authentication → URL Configuration → Redirect URLs** must include the return
address, or Google's callback lands nowhere:

```
http://localhost:5173/auth/google
```

And in Google Cloud → Credentials, the OAuth client's **Authorised redirect
URI** is Supabase's callback, not ours:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

Getting these two backwards is the usual cause of `redirect_uri_mismatch`.

### Checking it took

```
curl -s "$VITE_SUPABASE_URL/auth/v1/settings" -H "apikey: $VITE_SUPABASE_ANON_KEY"
```

Expected: `"email": true`, `"google": true`, `"mailer_autoconfirm": true`.
`"phone"` may be `false` — the flow does not use it.

`mailer_autoconfirm` is the inverse of the dashboard's "Confirm email" toggle —
`true` means confirmation is **off**, which is what this flow needs.

---

## Notes for later phases

- **SMS costs money even with confirmations off.** Phone sign-up sends nothing
  today, so no SMS provider is needed. Adding phone *verification* later means
  Twilio or similar, and a per-message bill.
- **Reset password** and **Reauthentication** templates are untouched — account
  recovery ([§ 14–16](../docs/01-onboarding-auth.md#14-forgot-password--triage))
  is not built, so their default content is not reachable from the product.
- **Editing email templates requires custom SMTP** on a hosted project. Nothing
  currently depends on a custom template, which is why that is no longer a
  blocker.

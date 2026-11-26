# Connect review moderation

1. In your Supabase project, run [reviews.sql](reviews.sql) once in the SQL Editor.
2. In Authentication → Users, create your admin account with an email and password, then copy its User UID. Turn off public user signups in Authentication settings if this project is dedicated to the site.
3. In the SQL Editor, grant that user access. Replace the placeholder below with the User UID.

   ```sql
   insert into review_private.admins (user_id) values ('YOUR_USER_UID');
   ```

4. Fill in the project URL and its `sb_publishable_…` key in [reviews-config.js](../reviews-config.js). Use the publishable key in the website. Keep the admin password and any secret or service-role keys out of the repository.
5. Publish the site files through your usual host. Open `testimonials.html`, submit a test review, and verify that it stays private. Sign in at `admin.html`, approve it, then reload Testimonials in a signed-out browser. Check that only the first name, last initial, city, rating, and review appear.

## Upgrade the dashboard and connect email

1. In the same Supabase project, run [dashboard.sql](dashboard.sql) once in the SQL Editor, after `reviews.sql`. It imports the three existing testimonials from the page so they can be managed in the dashboard. Removing a review hides it from Testimonials and keeps it in the Removed history.
2. In Resend, verify a sending domain and create a sending API key for that domain. In Supabase Vault, add these three secrets. Store the key in Vault only.

   | Vault name | Value |
   | --- | --- |
   | `brodie_resend_api_key` | Your Resend sending API key |
   | `brodie_email_from` | A sender on your verified domain |
   | `brodie_email_to` | The inbox for both types of notifications, such as `brodie@placerwest.com` |

3. With the upgraded local site, submit a test review and a test quote using sample information. Verify each appears in the dashboard and that both emails arrive. The quote email contains the submitted quote details. Review emails alert you to sign in to the dashboard. Check Resend's logs if a message does not arrive. Submissions remain saved even when email delivery fails.
4. Sign in and test approving, rejecting, and removing a sample review. Refresh Testimonials in a signed-out browser to confirm that a removed review disappears. Publish the site through your usual host when ready.

The new quote form uses the dashboard after the migration and all three Vault values are present. Before that it uses Formspree. The new email triggers apply to future submissions. Older submissions already in Formspree stay in that inbox.

## Enable quote stages and follow-up notes

Run [quote-workflow.sql](quote-workflow.sql) once in the same project's SQL Editor, after `dashboard.sql`. Existing and incoming quotes start at **New**. Stage and follow-up notes are writable only by dashboard admins. They stay in the dashboard and are excluded from quote emails.

Open **Quote Requests**, expand **Stage and follow-up notes** on a sample request, and save a stage change and a note. Refresh the dashboard to confirm both changes persisted. Use the **Quote stage** filter to find requests at a particular stage.

Run [quote-deletion.sql](quote-deletion.sql) once in the same SQL Editor to enable **Delete request** for dashboard admins. Deletion removes the request and its notes from Supabase. Previously sent notification emails remain in the recipient inbox.

## Connect Google Analytics reports

1. In Google Cloud, enable the **Google Analytics Data API** and create a dedicated service account. Create a JSON key for that account. In Google Analytics, open **Admin → Property access management** for property `565833245` and add the service account email as a **Viewer**. [Google Analytics Data API setup](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart)
2. In the **BrodieInsures** Supabase project, open **Edge Functions → Secrets**. Paste the complete downloaded JSON file as `GA4_SERVICE_ACCOUNT_JSON`. Keep the JSON key out of chat and the repo. [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
3. Open **Edge Functions → Deploy a new function → Via Editor**, name the function `website-analytics`, and replace the starter code with [index.ts](functions/website-analytics/index.ts). Deploy it, then open its Details tab and turn off the legacy gateway JWT check for this function. The function validates the signed-in caller and review-admin role through Supabase before requesting any Google data. [Supabase dashboard deployment](https://supabase.com/docs/guides/functions/quickstart-dashboard) · [Supabase JWT verification troubleshooting](https://supabase.com/kb/troubleshooting/edge-function-401-error-response)
4. Sign in to the local admin dashboard and scroll to **Website traffic**. Compare the 30-day figures with the same completed date range in Google Analytics, and try the 7- and 90-day filters.

The current [index.ts](functions/website-analytics/index.ts) requests California city, country, and event reports alongside the core traffic metrics. The dashboard also accepts these reports from the previous deployment.

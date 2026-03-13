# Live Test Script — Platform Readiness Verification

Version: 1.0
Date: 13 March 2026
Audience: Non-technical testers, operations staff, client reviewers

---

## How to use this document

Each test below is self-contained. Follow the steps exactly as written. Record whether the test passed or failed. If it failed, record what you saw instead of what was expected. Screenshots are always helpful.

You do not need to run the tests in order, but some tests depend on earlier ones. Where that is the case, it is noted under "What you need before starting."

---

## TEST 1: Sign up with a new account

What this is testing: That a brand-new user can create an account using their email and a password.

Why this matters: If sign-up does not work, nobody can use the platform. This is the first thing any new user will do.

Who should run this test: Anyone. Use a real email address you can access.

What you need before starting: A web browser. An email address that has never been used on this platform before.

Steps to follow:
1. Open the platform home page.
2. Click the "Sign In" or "Get Started" button.
3. On the sign-in page, look for a link that says "Sign up" or "Create account." Click it.
4. Enter your email address.
5. Enter a password. It must be at least 8 characters. You should see a strength indicator appear as you type.
6. Click the sign-up button.
7. You should see a message telling you to check your email for a verification link.

What should happen if the system is working properly: You see a confirmation message on screen saying a verification email has been sent. You should NOT be logged in yet.

What to record if it does not work properly: Record the exact error message shown. Record whether the password strength indicator appeared. Record whether you were logged in immediately without verifying your email.

Pass / fail rule: Pass if a confirmation message is shown and you are not logged in. Fail if you are logged in without email verification, or if the sign-up button produces an error.

---

## TEST 2: Email verification

What this is testing: That the verification email arrives and that clicking the link in it actually confirms your account.

Why this matters: Email verification proves the user owns the email address. Without it, anyone could sign up with someone else's email.

Who should run this test: The same person who ran Test 1, using the same email.

What you need before starting: You must have completed Test 1. You need access to the email inbox you signed up with.

Steps to follow:
1. Open your email inbox.
2. Look for an email from the platform. Check your spam or junk folder if you do not see it within 5 minutes.
3. Open the email.
4. Click the verification link in the email.
5. You should be taken back to the platform and either signed in automatically or shown a message that your email is verified.

What should happen if the system is working properly: The verification link opens the platform. You are either signed in or told your email is now confirmed. You can now sign in normally.

What to record if it does not work properly: Record whether the email arrived. Record how long it took. Record what happened when you clicked the link. If the link showed an error, record the exact error message. Take a screenshot.

Pass / fail rule: Pass if the email arrives within 10 minutes and the link successfully verifies your account. Fail if no email arrives, the link is broken, or the link produces an error.

---

## TEST 3: Sign in with verified account

What this is testing: That a user with a verified email can sign in and see their dashboard.

Why this matters: If sign-in does not work after verification, the user is locked out.

Who should run this test: The same person who completed Tests 1 and 2.

What you need before starting: A verified account from Test 2.

Steps to follow:
1. Open the platform home page.
2. Click "Sign In."
3. Enter the email and password you used to sign up.
4. Click the sign-in button.
5. You should be taken to your dashboard.

What should happen if the system is working properly: You see a dashboard with your organisation name or a welcome message. The page loads without errors.

What to record if it does not work properly: Record the exact error message. Record whether the page loaded but showed nothing. Record whether you were stuck on a loading screen.

Pass / fail rule: Pass if you reach the dashboard. Fail if you see an error, a blank page, or a loading screen that never finishes.

---

## TEST 4: Sign out

What this is testing: That clicking sign out actually ends your session and prevents access to protected pages.

Why this matters: If sign-out does not work, the next person who uses the same computer could access your account.

Who should run this test: Anyone who is currently signed in.

What you need before starting: You must be signed in.

Steps to follow:
1. Find the sign-out option. It may be in a sidebar, a menu, or under your profile icon.
2. Click "Sign Out."
3. You should be taken to the home page or the sign-in page.
4. Now try to go directly to the dashboard by typing the dashboard address into your browser address bar.
5. You should be redirected to the sign-in page.

What should happen if the system is working properly: After signing out, you cannot access the dashboard or any protected page. You are always redirected to sign in.

What to record if it does not work properly: Record whether you could still see the dashboard after signing out. Record whether any data was visible. Take a screenshot.

Pass / fail rule: Pass if you are redirected to sign-in when trying to access protected pages. Fail if you can see any protected content after signing out.

---

## TEST 5: Password reset request

What this is testing: That a user who has forgotten their password can request a reset link by email.

Why this matters: Forgotten passwords are the most common support request. If this does not work, users are locked out.

Who should run this test: Anyone with a registered account.

What you need before starting: A registered email address. Access to the email inbox.

Steps to follow:
1. Go to the sign-in page.
2. Click "Forgot password" or "Reset password."
3. Enter your registered email address.
4. Click the submit or send button.
5. You should see a confirmation message with instructions about checking your inbox and spam folder.
6. The message should mention that the link expires in 1 hour.

What should happen if the system is working properly: A confirmation message appears on screen. The message includes guidance about checking spam and the link expiry time. An email arrives in your inbox within a few minutes.

What to record if it does not work properly: Record what message you saw. Record whether the email arrived. Record how long it took.

Pass / fail rule: Pass if the confirmation message appears with clear guidance and the email arrives. Fail if no email arrives within 10 minutes or the on-screen message is vague or missing.

---

## TEST 6: Password reset completion

What this is testing: That clicking the reset link lets you set a new password and sign in with it.

Why this matters: If the reset link does not work, users cannot recover their accounts.

Who should run this test: The same person who ran Test 5.

What you need before starting: The reset email from Test 5.

Steps to follow:
1. Open the reset email.
2. Click the reset link.
3. You should be taken to a page where you can enter a new password.
4. Enter a new password that is at least 8 characters long.
5. You should see a password strength indicator.
6. Submit the new password.
7. You should see a success message.
8. Now sign out and sign back in using the new password.

What should happen if the system is working properly: The new password is accepted. You can sign in with it. The old password no longer works.

What to record if it does not work properly: Record the exact error. Record whether the strength indicator appeared. Record whether you could still sign in with the old password.

Pass / fail rule: Pass if the new password works and the old one does not. Fail if the reset fails, the old password still works, or you see an error.

---

## TEST 7: Password change from settings

What this is testing: That a signed-in user can change their password from inside the platform.

Why this matters: Users need to be able to change their password without going through the reset flow.

Who should run this test: Anyone who is currently signed in.

What you need before starting: You must be signed in.

Steps to follow:
1. Go to your account settings. Look in the sidebar or under your profile icon.
2. Find the "Security" or "Password" section.
3. Enter a new password.
4. Submit the change.
5. Sign out.
6. Sign back in using the new password.

What should happen if the system is working properly: The password change is confirmed. You can sign in with the new password.

What to record if it does not work properly: Record the error message. Record whether you were signed out unexpectedly during the change.

Pass / fail rule: Pass if you can sign in with the new password. Fail if the change fails or you are locked out.

---

## TEST 8: Session expiry

What this is testing: That the platform correctly handles an expired session by warning the user and redirecting to sign-in.

Why this matters: In enterprise and compliance systems, expired sessions must not silently continue. The user must know their session ended and must sign in again.

Who should run this test: A tester comfortable waiting or simulating expiry.

What you need before starting: You must be signed in. You may need to wait for the session to expire naturally or ask a developer to shorten the session timeout for testing.

Steps to follow:
1. Sign in to the platform.
2. Leave the browser open without doing anything until the session expires. This may take 1 hour or more depending on configuration.
3. After the session expires, try to click on something or navigate to a different page.
4. You should see a warning message that says your session has expired.
5. You should be redirected to the sign-in page.

What should happen if the system is working properly: A toast or alert message appears saying your session has expired and you are being redirected. You are taken to the sign-in page. After signing in, you are returned to the page you were on before expiry.

What to record if it does not work properly: Record whether the expiry message appeared. Record whether you were redirected. Record whether you lost your place after signing back in.

Pass / fail rule: Pass if the expiry message appears and you are redirected with return-to-page preserved. Fail if the session silently continues, if you see a blank page, or if you lose your place.

---

## TEST 9: Onboarding after first sign-in

What this is testing: That a new user sees an onboarding guide or wizard after their first sign-in.

Why this matters: New users need to know how to get started. Without onboarding, they may not understand how to use the platform.

Who should run this test: A new user who has just completed sign-up and email verification.

What you need before starting: A freshly verified account that has never signed in before.

Steps to follow:
1. Sign in with your new account.
2. You should see a welcome screen, onboarding wizard, or quickstart guide.
3. Read through the steps. They should explain the key actions: creating an API key, searching for counterparties, and creating a match.
4. If there is a "dismiss" or "skip" button, click it.
5. You should now see the main dashboard.

What should happen if the system is working properly: A clear onboarding guide appears on first sign-in. It explains the key steps. It can be dismissed. After dismissal, you see the dashboard.

What to record if it does not work properly: Record whether the onboarding appeared. Record whether it was confusing or incomplete. Record whether dismissing it caused any issues.

Pass / fail rule: Pass if onboarding appears and is clear. Fail if no onboarding appears or if it cannot be dismissed.

---

## TEST 10: API key creation

What this is testing: That a user can create an API key and copy it.

Why this matters: API keys are required to use the platform programmatically. If they cannot be created or copied, the platform cannot be integrated.

Who should run this test: Any signed-in user with admin or member permissions.

What you need before starting: You must be signed in.

Steps to follow:
1. Navigate to the API Keys section in your dashboard.
2. Click "Create API Key" or similar.
3. Enter a name for the key, such as "Test Key."
4. Select scopes if prompted. Choose at least "search" and "match."
5. Click Create.
6. You should see the key displayed. This is the only time the full key will be shown.
7. Click the "Copy" button next to the key.
8. Paste the key into a text editor to confirm it was copied correctly.

What should happen if the system is working properly: The key is created and displayed once. The copy button works. After closing the dialog or navigating away, the full key is no longer visible.

What to record if it does not work properly: Record whether the key was shown. Record whether the copy button worked. Record whether the key was still visible after navigating away.

Pass / fail rule: Pass if the key is shown once, can be copied, and is hidden after navigating away. Fail if the key cannot be created, cannot be copied, or remains visible permanently.

---

## TEST 11: Counterparty search

What this is testing: That a user can search for potential trading partners and see results.

Why this matters: Search is the first step in the commercial workflow. If search does not work, no matches can be created.

Who should run this test: Any signed-in user.

What you need before starting: You must be signed in and on the dashboard.

Steps to follow:
1. Navigate to the Search section.
2. Enter a search term such as "maize exporter south africa."
3. Click Search or press Enter.
4. Wait for results to appear. This may take up to 30 seconds because the system checks external data sources.
5. You should see a list of results, or a clear message saying no results were found.

What should happen if the system is working properly: Results appear within 30 seconds, or a clear "no results" message is shown. The search area does not freeze or show a permanent loading spinner.

What to record if it does not work properly: Record the search term you used. Record whether a loading indicator appeared. Record whether the spinner never stopped. Record any error message.

Pass / fail rule: Pass if results appear or a clear "no results" message is shown within 30 seconds. Fail if the page freezes, shows a permanent spinner, or shows an unhelpful error.

---

## TEST 12: Search interruption and recovery

What this is testing: That if a user starts a search and then navigates away before it finishes, the platform does not break.

Why this matters: Users frequently click away before a slow search completes. The platform must handle this gracefully.

Who should run this test: Any signed-in user.

What you need before starting: You must be signed in.

Steps to follow:
1. Start a search with any term.
2. While the loading spinner is still showing, click on a different section in the sidebar (e.g., Matches or Settings).
3. Wait a few seconds.
4. Navigate back to the Search section.
5. Try a new search.

What should happen if the system is working properly: Navigating away does not cause an error. When you return to Search, it is in a clean state. A new search works normally.

What to record if it does not work properly: Record whether an error appeared when you navigated away. Record whether the search section was broken when you returned.

Pass / fail rule: Pass if navigation away is clean and a new search works. Fail if errors appear or the search section is broken.

---

## TEST 13: Match creation

What this is testing: That a user can create a new match between a buyer and a seller.

Why this matters: Matches are the core commercial record of the platform. If they cannot be created, the platform has no value.

Who should run this test: Any signed-in user with an API key.

What you need before starting: You must be signed in. You should have an API key (from Test 10). If the match can be created through the user interface rather than the API, follow the UI flow.

Steps to follow:
1. Navigate to the Matches section or find the "Create Match" option.
2. Fill in the required fields: buyer, seller, commodity, quantity, price.
3. Click Create or Submit.
4. You should see a confirmation that the match was created.
5. The new match should appear in your matches list.
6. Click on the match to open its details page.
7. The details page should show the information you entered.

What should happen if the system is working properly: The match is created successfully. It appears in the list. Its details page shows accurate information including a unique ID and a hash value.

What to record if it does not work properly: Record the exact error. Record what fields you filled in. Record whether the match appeared in the list.

Pass / fail rule: Pass if the match is created and visible with correct details. Fail if creation fails or details are wrong.

---

## TEST 14: Duplicate match prevention

What this is testing: That the platform prevents the same match from being created twice if the user accidentally clicks the submit button more than once.

Why this matters: Duplicate records are a serious problem in compliance and commercial systems. Each match should be unique.

Who should run this test: Any signed-in user.

What you need before starting: You must be signed in and ready to create a match.

Steps to follow:
1. Start creating a match with specific details.
2. Click the Create or Submit button.
3. Immediately click it again before the first request finishes.
4. Wait for both requests to complete.
5. Check the matches list.

What should happen if the system is working properly: Only one match is created. The second click is either blocked (button disabled after first click) or the server rejects the duplicate using an idempotency check.

What to record if it does not work properly: Record whether two identical matches appeared in the list. Record whether the button was disabled after the first click.

Pass / fail rule: Pass if only one match is created. Fail if two identical matches appear.

---

## TEST 15: Match details page

What this is testing: That the match details page shows complete and accurate information about a match.

Why this matters: This page is the source of truth for a commercial record. It must be accurate and complete.

Who should run this test: Any signed-in user who has at least one match.

What you need before starting: At least one match must exist (from Test 13).

Steps to follow:
1. Navigate to the Matches section.
2. Click on a match to open its details.
3. Check that the following are displayed: match ID, buyer, seller, commodity, quantity, price, status, creation date, and evidence hash.
4. Check that there are tabs or sections for deal terms, documents, notes, timeline, and disputes.

What should happen if the system is working properly: All fields are populated with the correct data. No fields show "undefined," "null," or are blank when they should have values. All tabs are accessible.

What to record if it does not work properly: Record which fields are missing or show incorrect values. Take a screenshot.

Pass / fail rule: Pass if all fields show correct data and all tabs work. Fail if any critical field is missing, shows "undefined," or tabs do not load.

---

## TEST 16: Deal terms — create and save

What this is testing: That a user can enter and save deal terms (payment terms, delivery terms, inspection terms) for a match.

Why this matters: Deal terms are a legally relevant record. They must save correctly and be retrievable.

Who should run this test: Any signed-in user with a match.

What you need before starting: A match must exist.

Steps to follow:
1. Open a match details page.
2. Navigate to the Deal Terms tab or section.
3. Enter payment terms such as "30 days LC."
4. Enter delivery terms such as "FOB Durban."
5. Enter inspection terms such as "SGS at load port."
6. Click Save or Submit.
7. Navigate away from the page.
8. Navigate back to the same match and open Deal Terms again.

What should happen if the system is working properly: The terms you entered are saved and shown when you return. Nothing is lost.

What to record if it does not work properly: Record which fields were lost. Record any error message.

Pass / fail rule: Pass if all terms are saved and displayed correctly on return. Fail if any terms are lost or wrong.

---

## TEST 17: Deal terms — version history

What this is testing: That when deal terms are updated, the previous version is preserved and visible.

Why this matters: In a dispute or audit, it is critical to know what the terms were at each point in time.

Who should run this test: A user who has already saved deal terms (Test 16).

What you need before starting: Deal terms must already exist for a match.

Steps to follow:
1. Open the deal terms for a match.
2. Change one of the terms, such as changing "30 days LC" to "60 days LC."
3. Save the changes.
4. Check whether you can see the previous version or a version history.

What should happen if the system is working properly: The new terms are saved. The previous version is still accessible or visible in a history view. Each version is numbered.

What to record if it does not work properly: Record whether the old terms were overwritten without a trace. Record whether a version history is visible.

Pass / fail rule: Pass if previous versions are preserved. Fail if old terms are silently overwritten with no history.

---

## TEST 18: Deal terms — conflict handling (two users editing at the same time)

What this is testing: That if two users edit the same deal terms at the same time, the platform does not silently lose one person's changes.

Why this matters: In a team environment, concurrent editing is common. Silent data loss is unacceptable.

Who should run this test: Two users in the same organisation. Both must be signed in on separate browsers or devices.

What you need before starting: A match with existing deal terms. Two user accounts in the same organisation.

Steps to follow:
1. User A opens the deal terms for a specific match.
2. User B opens the deal terms for the same match on a different browser.
3. User A changes the payment terms to "45 days LC" and clicks Save.
4. User B changes the payment terms to "90 days LC" and clicks Save (without refreshing first).
5. Both users refresh the page.

What should happen if the system is working properly: Only one set of changes should be saved. Ideally, User B should be warned that the terms were changed since they loaded the page. At minimum, the saved record should be consistent — not a mix of the two edits.

What to record if it does not work properly: Record what each user sees after refreshing. Record whether the saved data is a mix of both edits. Record whether any warning was shown.

Pass / fail rule: Pass if one consistent version is saved and no data is silently mixed. Fail if the record is corrupted or both edits are partially applied.

---

## TEST 19: Document upload

What this is testing: That a user can upload a document against a match.

Why this matters: Documents such as invoices, certificates, and contracts are critical evidence in trade transactions.

Who should run this test: Any signed-in user with a match.

What you need before starting: A match must exist. Have a small PDF or image file ready to upload (under 10 MB).

Steps to follow:
1. Open a match details page.
2. Navigate to the Documents tab or section.
3. Click "Upload Document" or similar.
4. Select a file from your computer.
5. Choose a document type if prompted (e.g., "Commercial Invoice").
6. Click Upload.
7. The document should appear in the documents list.

What should happen if the system is working properly: The document uploads successfully. It appears in the list with the correct filename, type, and upload date.

What to record if it does not work properly: Record the error message. Record the file type and size. Record whether the upload button became stuck or the spinner never stopped.

Pass / fail rule: Pass if the document appears in the list with correct details. Fail if the upload fails or the document does not appear.

---

## TEST 20: Invalid file upload

What this is testing: That the platform rejects files that are too large, empty, or of an unsupported type.

Why this matters: Accepting invalid files can cause storage issues, security risks, or corrupted records.

Who should run this test: Any signed-in user with a match.

What you need before starting: A match must exist. Prepare the following test files: an empty file (0 bytes), a very large file (over 50 MB if possible), and a file with an unusual extension like ".exe" or ".bat."

Steps to follow:
1. Open the documents section of a match.
2. Try to upload the empty file. Record what happens.
3. Try to upload the oversized file. Record what happens.
4. Try to upload the file with the unusual extension. Record what happens.

What should happen if the system is working properly: Each invalid file is rejected with a clear error message explaining why. The upload does not silently succeed.

What to record if it does not work properly: Record whether any invalid file was accepted. Record the error message for each rejection.

Pass / fail rule: Pass if all invalid files are rejected with clear messages. Fail if any invalid file is silently accepted.

---

## TEST 21: Document access and revocation

What this is testing: That documents can be shared with specific users or organisations and that access can be revoked.

Why this matters: Trade documents contain commercially sensitive information. Access must be controlled and auditable.

Who should run this test: Two users, ideally in different organisations.

What you need before starting: A match with at least one uploaded document. Two user accounts.

Steps to follow:
1. User A uploads a document to a match.
2. User A shares the document with User B's organisation.
3. User B signs in and checks whether they can see or download the document.
4. User A revokes access.
5. User B refreshes the page and checks whether they can still see the document.

What should happen if the system is working properly: User B can access the document after sharing. After revocation, User B can no longer see or download it. Access logs record both the share and the revocation.

What to record if it does not work properly: Record whether User B could access the document before sharing. Record whether revocation actually removed access. Record whether access logs exist.

Pass / fail rule: Pass if sharing grants access and revocation removes it. Fail if access is not properly controlled.

---

## TEST 22: Confirm intent

What this is testing: That a user can confirm their intent to proceed with a match, which is the most important commercial action on the platform.

Why this matters: Confirming intent is a binding commercial action. It must work reliably, deduct credits, and create an auditable record.

Who should run this test: Any signed-in user with a match and sufficient credits.

What you need before starting: A match in an eligible state. Your organisation must have an active licence and sufficient credits. If you do not have credits, run the billing test first (Test 27).

Steps to follow:
1. Open a match details page.
2. Find the "Confirm Intent" or "Settle" button.
3. Click it.
4. You should see a confirmation dialog asking you to confirm the action.
5. Confirm the action.
6. Wait for the result.

What should happen if the system is working properly: The match status changes to "intent declared" or "settled." Your credit balance is reduced. An audit log entry is created. The match timeline shows the event.

What to record if it does not work properly: Record the exact error message. Note especially if it says "LICENCE_REQUIRED" — this means the licence setup is incomplete. Record your credit balance before and after.

Pass / fail rule: Pass if the status changes, credits are deducted, and an audit trail entry exists. Fail if the action fails, credits are not deducted, or no audit record is created.

---

## TEST 23: Confirm intent — insufficient credits

What this is testing: That the platform correctly blocks intent confirmation when the user does not have enough credits.

Why this matters: Allowing an action without charging for it is a commercial error. The system must enforce credit requirements.

Who should run this test: A user with zero or very low credits.

What you need before starting: An account with no credits or fewer credits than required for confirmation. A match in an eligible state.

Steps to follow:
1. Check your credit balance and confirm it is zero or too low.
2. Open a match and try to confirm intent.
3. The system should block the action and show a clear message about insufficient credits.
4. The match status should NOT change.

What should happen if the system is working properly: The action is blocked. A clear message explains that you need more credits. A link or button directs you to the billing page.

What to record if it does not work properly: Record whether the action was allowed despite no credits. Record the message shown.

Pass / fail rule: Pass if the action is blocked with a clear message. Fail if intent is confirmed without sufficient credits.

---

## TEST 24: Bulk confirm intent

What this is testing: That a user can confirm intent on multiple matches at once.

Why this matters: Efficiency feature for users managing many matches. Must work reliably and show clear progress.

Who should run this test: A user with at least 3 matches in an eligible state.

What you need before starting: Multiple matches. Sufficient credits.

Steps to follow:
1. Navigate to the matches list.
2. Select multiple matches using checkboxes or a select-all option.
3. Click the "Bulk Confirm" or "Confirm Selected" button.
4. A dialog should appear showing how many matches will be confirmed.
5. Confirm the action.
6. Watch the progress indicator.
7. After completion, check each match to verify the status changed.

What should happen if the system is working properly: All selected matches are confirmed. The progress indicator shows completion. Each match has the correct status and audit trail. Credits are deducted for each match.

What to record if it does not work properly: Record how many matches were selected versus how many were actually confirmed. Record whether the progress indicator was clear. Record whether any matches were left in an inconsistent state.

Pass / fail rule: Pass if all selected matches are confirmed with correct audit trails. Fail if any match is left in an inconsistent state or if the progress indicator was misleading.

---

## TEST 25: Credit balance display

What this is testing: That the credit balance shown on screen is always accurate and up-to-date.

Why this matters: If the balance is wrong, users may think they have credits they do not have, or they may be unable to act when they should be able to.

Who should run this test: Any signed-in user.

What you need before starting: Note your current credit balance.

Steps to follow:
1. Note your credit balance.
2. Perform an action that costs credits (e.g., confirm intent or run a search).
3. Check your credit balance again immediately.
4. Refresh the page.
5. Check the balance again.

What should happen if the system is working properly: The balance decreases by the correct amount after the action. It remains correct after refresh.

What to record if it does not work properly: Record the balance before, the expected deduction, the balance after, and the balance after refresh.

Pass / fail rule: Pass if the balance is accurate immediately after the action and after refresh. Fail if the balance is stale or wrong.

---

## TEST 26: Billing page — view credit packages

What this is testing: That the billing page shows available credit packages with clear pricing.

Why this matters: Users need to understand what they are buying before they pay.

Who should run this test: Any signed-in user.

What you need before starting: You must be signed in.

Steps to follow:
1. Navigate to the Billing page from the sidebar or settings.
2. You should see a list of credit packages with prices in South African Rand (ZAR).
3. Each package should clearly state how many credits it includes and the price.

What should happen if the system is working properly: The billing page loads. Packages are clearly listed with prices. A "Buy" or "Purchase" button is available for each package.

What to record if it does not work properly: Record whether the page loaded. Record whether prices were shown. Record whether any package was missing a price.

Pass / fail rule: Pass if packages and prices are clearly displayed. Fail if the page is empty, prices are missing, or the page does not load.

---

## TEST 27: Billing — successful payment

What this is testing: That purchasing credits through the payment flow works end-to-end.

Why this matters: This is how the platform makes money. If payments fail, the business cannot operate.

Who should run this test: A user authorised to make test payments. Use a test card if available.

What you need before starting: Access to the billing page. A test payment method.

Steps to follow:
1. Note your current credit balance.
2. Go to the Billing page.
3. Select a credit package.
4. Click Buy or Purchase.
5. You should be redirected to a payment page (Paystack).
6. Complete the payment using a test card.
7. After payment, you should be redirected back to the platform.
8. You should see a success message.
9. Check your credit balance. It should have increased by the amount in the package you purchased.

What should happen if the system is working properly: Payment completes. You are redirected back. A success message appears. Credits are added to your balance immediately.

What to record if it does not work properly: Record where the process failed. Record the error message. Record your balance before and after.

Pass / fail rule: Pass if credits are added to your balance after successful payment. Fail if the payment succeeds but credits are not added, or if you are not redirected back.

---

## TEST 28: Billing — payment cancellation

What this is testing: That if a user starts a payment and then cancels, no credits are added and no charge is made.

Why this matters: A cancelled payment must not result in credits being added or money being taken.

Who should run this test: Any signed-in user.

What you need before starting: Access to the billing page.

Steps to follow:
1. Note your credit balance.
2. Go to the Billing page.
3. Select a credit package and click Buy.
4. On the payment page, click Cancel or close the browser tab.
5. Return to the platform.
6. Check your credit balance.

What should happen if the system is working properly: Your balance has not changed. You see a message indicating the payment was cancelled. No charge was made.

What to record if it does not work properly: Record whether credits were added despite cancellation. Record any error messages.

Pass / fail rule: Pass if balance is unchanged and no charge was made. Fail if credits were added or a charge occurred.

---

## TEST 29: Billing — payment failure

What this is testing: That if a payment fails (e.g., declined card), no credits are added and the user is informed.

Why this matters: A failed payment must not result in credits.

Who should run this test: A user with a test card that will be declined.

What you need before starting: A payment method that will fail.

Steps to follow:
1. Note your credit balance.
2. Attempt to purchase credits using the failing payment method.
3. The payment should fail.
4. Return to the platform.
5. Check your credit balance.

What should happen if the system is working properly: The balance is unchanged. A clear error message is shown with guidance on what to do next, including a support email address.

What to record if it does not work properly: Record whether credits were added despite failure. Record the error message.

Pass / fail rule: Pass if balance is unchanged and a clear error message is shown. Fail if credits were added or no error message appears.

---

## TEST 30: Billing — double payment protection

What this is testing: That if the payment system sends a duplicate confirmation (which can happen with webhooks), credits are only added once.

Why this matters: Double-crediting is a serious financial error.

Who should run this test: This test may require developer assistance to simulate a duplicate webhook. If you can test by rapidly clicking the buy button twice, do that.

What you need before starting: Access to the billing page.

Steps to follow:
1. Note your credit balance.
2. Purchase a credit package.
3. Note the new balance.
4. If possible, ask a developer to re-send the same payment webhook.
5. Check the balance again.

What should happen if the system is working properly: Credits are added only once, regardless of how many times the webhook is received.

What to record if it does not work properly: Record the balance at each step. Record whether credits were added more than once.

Pass / fail rule: Pass if credits are added exactly once. Fail if credits are doubled.

---

## TEST 31: Dispute — raise a dispute

What this is testing: That a user can raise a dispute against a match.

Why this matters: Disputes are a critical governance mechanism. If they cannot be raised, users have no recourse.

Who should run this test: Any signed-in user with a match.

What you need before starting: A match must exist.

Steps to follow:
1. Open a match details page.
2. Navigate to the Disputes tab or section.
3. Click "Raise Dispute" or similar.
4. Enter a reason for the dispute.
5. Submit the dispute.
6. The dispute should appear in the disputes list for that match.
7. The match status should reflect that a dispute is active.

What should happen if the system is working properly: The dispute is created with the correct reason. It appears in the disputes list. The match status indicates a dispute is active. Settlement is blocked while the dispute is active.

What to record if it does not work properly: Record the error. Record whether the dispute appeared. Record whether the match status changed.

Pass / fail rule: Pass if the dispute is created, visible, and blocks settlement. Fail if the dispute cannot be created or does not block settlement.

---

## TEST 32: Dispute — resolution

What this is testing: That a dispute can be resolved and settlement is unblocked afterward.

Why this matters: Disputes must have a resolution path. If they cannot be resolved, matches are permanently stuck.

Who should run this test: A user with appropriate permissions (admin or the user who raised the dispute).

What you need before starting: An active dispute from Test 31.

Steps to follow:
1. Open the match with the active dispute.
2. Navigate to the Disputes section.
3. Click on the dispute.
4. Click "Resolve" or a similar resolution option.
5. Enter a resolution outcome or notes.
6. Submit the resolution.
7. Confirm that the dispute status changes to "resolved."
8. Try to confirm intent on the match. It should now be possible.

What should happen if the system is working properly: The dispute is resolved. The match is no longer blocked. Settlement can proceed.

What to record if it does not work properly: Record whether the resolution option was available. Record whether settlement remained blocked after resolution.

Pass / fail rule: Pass if the dispute is resolved and settlement is unblocked. Fail if the dispute cannot be resolved or settlement remains blocked.

---

## TEST 33: Team invite

What this is testing: That an admin user can invite a new team member to their organisation.

Why this matters: Organisations need to add staff. If invitations do not work, teams cannot be built.

Who should run this test: An admin user.

What you need before starting: You must be signed in as an admin. You need a second email address for the invitee.

Steps to follow:
1. Navigate to the Team Management section in your account settings.
2. Click "Invite Member" or similar.
3. Enter the invitee's email address.
4. Select a role (e.g., "Member").
5. Click Send.
6. The invitee should receive an email with instructions to join.

What should happen if the system is working properly: The invitation is sent. The invitee appears in the team list as "pending." The invitee receives an email.

What to record if it does not work properly: Record whether the invite was sent. Record whether the invitee received the email. Record any errors.

Pass / fail rule: Pass if the invitation is sent and the invitee receives it. Fail if the invite fails or no email arrives.

---

## TEST 34: Team member access and permissions

What this is testing: That a team member with the "member" role can see their organisation's data but cannot perform admin-only actions.

Why this matters: Permission boundaries are critical for enterprise trust. A member must not be able to delete API keys, manage team members, or access admin settings.

Who should run this test: Two users — one admin, one member — in the same organisation.

What you need before starting: An admin account and a member account in the same organisation.

Steps to follow:
1. Sign in as the member.
2. Verify you can see the dashboard, matches, search, and your profile.
3. Try to access the Team Management section. You should either not see it or be blocked.
4. Try to access admin settings. You should be blocked.
5. Try to delete an API key created by the admin. You should be blocked.
6. Sign in as the admin and verify you CAN perform all these actions.

What should happen if the system is working properly: The member can view data but cannot perform admin actions. The admin can perform all actions.

What to record if it does not work properly: Record which admin actions the member was able to perform. This is a security issue.

Pass / fail rule: Pass if the member is blocked from admin actions. Fail if the member can perform any admin-only action.

---

## TEST 35: Admin access

What this is testing: That the admin panel is only accessible to users with admin privileges.

Why this matters: The admin panel contains sensitive system-wide data. Unauthorised access is a serious security breach.

Who should run this test: One admin user and one non-admin user.

What you need before starting: An admin account and a non-admin account.

Steps to follow:
1. Sign in as the non-admin user.
2. Try to navigate to the admin panel by typing the admin URL directly into the browser.
3. You should be redirected away or see an access-denied message.
4. Sign in as the admin user.
5. Navigate to the admin panel. You should see it normally.

What should happen if the system is working properly: Non-admin users cannot access the admin panel. They are redirected to the dashboard.

What to record if it does not work properly: Record whether the non-admin user could see any admin content.

Pass / fail rule: Pass if non-admin is blocked. Fail if non-admin can see admin content.

---

## TEST 36: Data export — full export

What this is testing: That a user can export their data (matches, audit logs, etc.) as a complete download.

Why this matters: Data portability is required for compliance and enterprise use. Exports must be complete and accurate.

Who should run this test: Any signed-in user with existing data.

What you need before starting: At least a few matches and audit log entries.

Steps to follow:
1. Navigate to the data export section (may be in Settings or Account).
2. Click "Export" or "Download."
3. A file should download.
4. Open the file.
5. Check that the data matches what you see on screen.

What should happen if the system is working properly: The file downloads. It contains all your data. It is properly formatted (JSON or CSV). It is not truncated — if you have 50 records, the file should contain all 50.

What to record if it does not work properly: Record whether the file downloaded. Record whether it was empty or incomplete. Record how many records you expected versus how many were in the file.

Pass / fail rule: Pass if the file is complete and accurate. Fail if it is truncated, empty, or contains wrong data.

---

## TEST 37: CSV export from list views

What this is testing: That the CSV download from list views (matches, audit logs) produces a correctly formatted file.

Why this matters: CSV files are used for reporting, auditing, and integration with other tools. They must be correctly formatted.

Who should run this test: Any signed-in user with data.

What you need before starting: At least a few records in the list you are exporting.

Steps to follow:
1. Navigate to a list view (e.g., Matches).
2. Click the "Export CSV" or "Download" button.
3. Open the downloaded file in a spreadsheet program (Excel, Google Sheets).
4. Check that all columns are properly separated.
5. Check that special characters (commas, quotes, line breaks in data) are properly handled and do not break the formatting.
6. Check whether the export contains only the current page or all records.

What should happen if the system is working properly: The CSV file opens correctly in a spreadsheet. All columns align. Special characters are properly escaped. The file indicates if it only contains a subset of records.

What to record if it does not work properly: Record whether columns were misaligned. Record whether special characters broke the format. Record how many records were exported versus how many exist.

Pass / fail rule: Pass if the file is correctly formatted and complete (or clearly indicates partial export). Fail if the format is broken or data is silently truncated.

---

## TEST 38: Audit trail visibility

What this is testing: That important actions create audit log entries that are visible to the user.

Why this matters: Audit trails are essential for compliance, dispute resolution, and trust. Every important action must be recorded.

Who should run this test: Any signed-in user who has performed actions.

What you need before starting: You should have already performed several actions (created matches, uploaded documents, confirmed intent, etc.).

Steps to follow:
1. Navigate to the Audit Logs section.
2. Look for entries corresponding to your recent actions.
3. Check that each entry includes: the action type, who performed it, when it happened, and what it was performed on.
4. For a match creation, verify the audit log records the match ID.
5. For a dispute, verify the audit log records the dispute creation.

What should happen if the system is working properly: Every important action has a corresponding audit log entry. Entries are in chronological order. Each entry contains enough detail to understand what happened.

What to record if it does not work properly: Record which actions are missing from the audit log. Record whether entries are incomplete.

Pass / fail rule: Pass if all important actions are logged with sufficient detail. Fail if any critical action is missing from the log.

---

## TEST 39: Cross-organisation data isolation

What this is testing: That users in one organisation cannot see data belonging to a different organisation.

Why this matters: This is the most important security property of a multi-tenant platform. If Organisation A can see Organisation B's matches, documents, or billing data, the platform is fundamentally broken.

Who should run this test: Two users in different organisations.

What you need before starting: Two accounts in different organisations. Each organisation should have at least one match.

Steps to follow:
1. Sign in as User A (Organisation Alpha).
2. Note the matches, documents, and audit logs visible.
3. Sign out.
4. Sign in as User B (Organisation Beta).
5. Note the matches, documents, and audit logs visible.
6. Verify that User B cannot see any of Organisation Alpha's data.
7. Verify that User A cannot see any of Organisation Beta's data.
8. Try to access a match belonging to the other organisation by entering its URL directly.

What should happen if the system is working properly: Each user only sees their own organisation's data. Attempting to access the other organisation's data by URL results in an error or redirect — NOT the data being shown.

What to record if it does not work properly: Record exactly what data from the other organisation was visible. This is a critical security issue.

Pass / fail rule: Pass if complete isolation is maintained. Fail if any cross-organisation data is visible. This is a critical failure.

---

## TEST 40: Multi-user testing (same organisation)

What this is testing: That two users in the same organisation can both work on the platform at the same time without interfering with each other.

Why this matters: Teams work simultaneously. The platform must handle this without data conflicts.

Who should run this test: Two users in the same organisation.

What you need before starting: Two accounts in the same organisation.

Steps to follow:
1. Both users sign in at the same time on separate browsers or devices.
2. User A creates a match.
3. User B refreshes their matches list. The new match should appear.
4. User B opens the match and adds deal terms.
5. User A refreshes the match details. The deal terms should appear.
6. Both users check the audit log. Both actions should be logged.

What should happen if the system is working properly: Both users can work simultaneously. Changes made by one user are visible to the other after refresh. Audit logs reflect both users' actions.

What to record if it does not work properly: Record whether changes were visible across users. Record any errors.

Pass / fail rule: Pass if both users can work simultaneously and see each other's changes. Fail if changes are lost or not visible.

---

## TEST 41: Error states

What this is testing: That when something goes wrong, the platform shows a clear, helpful error message — not a blank screen, a cryptic error, or nothing at all.

Why this matters: Errors happen. The user must know what went wrong and what to do about it.

Who should run this test: Any signed-in user.

What you need before starting: You must be signed in.

Steps to follow:
1. Try to access a match that does not exist by entering a made-up match ID in the URL.
2. You should see a "not found" message, not a blank screen or crash.
3. Try to submit a form with required fields left empty.
4. You should see validation messages on the empty fields.
5. Disconnect your internet connection and try to perform an action.
6. You should see a network error message, not a silent failure.

What should happen if the system is working properly: Each error scenario shows a clear, specific message. The user is never left guessing.

What to record if it does not work properly: Record which error showed a blank screen, a crash, or no message at all.

Pass / fail rule: Pass if all error scenarios show clear messages. Fail if any scenario shows a blank screen, crash, or silent failure.

---

## TEST 42: Empty states

What this is testing: That when there is no data to display (e.g., no matches, no documents), the platform shows a helpful empty state — not a blank area.

Why this matters: A blank section makes users think the page is broken. An empty state with guidance helps users understand what to do next.

Who should run this test: A new user with no data, or test specific sections that have no data.

What you need before starting: A section with no data (e.g., a new account with no matches).

Steps to follow:
1. Navigate to each major section: Matches, Documents, Audit Logs, Billing, Team.
2. If any section has no data, check whether it shows a helpful message like "No matches yet" or "Get started by creating your first match."
3. There should NOT be a completely blank area.

What should happen if the system is working properly: Every section without data shows a clear empty state message with guidance on what to do next.

What to record if it does not work properly: Record which sections show blank areas instead of empty states.

Pass / fail rule: Pass if all empty sections show helpful messages. Fail if any section is completely blank when empty.

---

## TEST 43: Loading states

What this is testing: That when data is loading, the user sees a loading indicator — not a blank page or stale data.

Why this matters: Without loading indicators, users do not know whether the platform is working or broken.

Who should run this test: Any signed-in user.

What you need before starting: You must be signed in.

Steps to follow:
1. Navigate to each major section.
2. Watch for loading indicators (spinners, skeleton loaders, progress bars) as pages load.
3. On a slow connection (you can simulate this in your browser's developer tools), check that loading indicators appear and persist until data loads.

What should happen if the system is working properly: Every page shows a loading indicator while data is being fetched. The indicator disappears when data appears.

What to record if it does not work properly: Record which pages show blank content during loading.

Pass / fail rule: Pass if all pages show loading indicators. Fail if any page shows a blank area while loading.

---

## TEST 44: Browser refresh during form entry

What this is testing: That if a user accidentally refreshes the browser while filling out a form, their data is preserved or they are warned.

Why this matters: Losing form data is frustrating and wastes time. Enterprise users expect data to be preserved during interruptions.

Who should run this test: Any signed-in user.

What you need before starting: You must be signed in and navigating to a form (e.g., deal terms).

Steps to follow:
1. Open a form such as deal terms or match creation.
2. Fill in some fields but do NOT submit.
3. Press F5 or click the browser refresh button.
4. Check whether a "you have unsaved changes" warning appears.
5. If the warning appears, click Cancel to stay on the page. Verify your data is still there.
6. If no warning appears, check whether the data was preserved via draft saving.

What should happen if the system is working properly: Either a warning dialog appears before refresh, or the form data is automatically saved as a draft and restored when the page reloads.

What to record if it does not work properly: Record whether the warning appeared. Record whether data was lost.

Pass / fail rule: Pass if data is warned about or preserved. Fail if data is silently lost.

---

## TEST 45: Close browser tab during form entry

What this is testing: That closing the browser tab while filling out a form warns the user about unsaved changes.

Why this matters: Same reason as Test 44. Accidental tab closure is common.

Who should run this test: Any signed-in user.

What you need before starting: You must be signed in and on a form.

Steps to follow:
1. Open a form and fill in some fields.
2. Try to close the browser tab.
3. A browser warning should appear asking if you want to leave.

What should happen if the system is working properly: A "leave page?" warning appears.

What to record if it does not work properly: Record whether the warning appeared or whether the tab closed without warning.

Pass / fail rule: Pass if a warning appears. Fail if the tab closes without warning.

---

## TEST 46: Network disconnection during action

What this is testing: That if the network drops while the user is performing an action (e.g., saving deal terms), the platform handles it gracefully.

Why this matters: Network interruptions happen frequently, especially on mobile. The system must not silently fail.

Who should run this test: A user comfortable with temporarily disconnecting their internet.

What you need before starting: You must be signed in and ready to perform an action.

Steps to follow:
1. Start filling in a form (e.g., deal terms).
2. Disconnect your internet (turn off Wi-Fi or unplug the cable).
3. Click Save or Submit.
4. You should see a network error message within 15 seconds.
5. Reconnect your internet.
6. Try the action again. It should succeed.

What should happen if the system is working properly: The action fails with a clear network error message. Reconnecting and retrying works. No partial or corrupted data is saved.

What to record if it does not work properly: Record whether an error appeared. Record how long it took. Record whether partial data was saved.

Pass / fail rule: Pass if the error is shown within 15 seconds and retry works. Fail if the action silently fails, hangs indefinitely, or saves partial data.

---

## TEST 47: Pagination and large data volumes

What this is testing: That when there are many records (more than one page), the platform correctly paginates and tells the user how many records exist in total.

Why this matters: If the platform silently shows only the first page without telling you there are more, you might think you only have 25 matches when you actually have 200.

Who should run this test: A user with a large number of records (at least 30 matches or audit log entries).

What you need before starting: An account with enough data to span multiple pages.

Steps to follow:
1. Navigate to a list view (Matches, Audit Logs).
2. Check whether the total count is displayed (e.g., "Showing 1-25 of 87").
3. Navigate to the next page.
4. Verify the records are different from the first page.
5. Navigate to the last page.
6. Verify the records end at the expected total.

What should happen if the system is working properly: The total count is displayed. Pagination controls work. Records are correctly divided across pages. The user is never left thinking they are seeing all records when they are only seeing one page.

What to record if it does not work properly: Record whether the total count was shown. Record whether pagination controls were present. Record whether the same records appeared on multiple pages.

Pass / fail rule: Pass if total count is shown and pagination works correctly. Fail if data is silently truncated or pagination is missing.

---

## TEST 48: Full end-to-end journey — single user

What this is testing: The complete lifecycle from sign-up to confirmed intent.

Why this matters: This proves the platform works as a complete product, not just as individual features.

Who should run this test: A new tester who has never used the platform before.

What you need before starting: A fresh email address. A web browser.

Steps to follow:
1. Sign up with a new email (Test 1).
2. Verify your email (Test 2).
3. Sign in (Test 3).
4. Complete onboarding (Test 9).
5. Create an API key (Test 10).
6. Run a search (Test 11).
7. Create a match (Test 13).
8. Add deal terms to the match (Test 16).
9. Upload a document to the match (Test 19).
10. Purchase credits via the billing page (Test 27).
11. Confirm intent on the match (Test 22).
12. Check the audit log for all your actions (Test 38).
13. Export your data (Test 36).

What should happen if the system is working properly: Every step succeeds. Each step builds on the previous one. The final audit log shows a complete history. The data export contains everything.

What to record if it does not work properly: Record the step number where the journey broke. Record the exact error. Record what you had to do to work around it.

Pass / fail rule: Pass if all 13 steps complete without errors. Fail if any step blocks progress.

---

## TEST 49: Full end-to-end journey — two organisations

What this is testing: The complete lifecycle involving two separate organisations interacting on a match.

Why this matters: The platform is designed for two parties to interact. This must work across organisation boundaries.

Who should run this test: Two testers, each in a different organisation.

What you need before starting: Two separate organisation accounts, each with at least one user.

Steps to follow:
1. Org A creates a match involving Org B.
2. Org B signs in and checks whether the match is visible to them.
3. Org A adds deal terms.
4. Org B reviews the deal terms.
5. Org A uploads a document and shares it with Org B.
6. Org B checks whether they can see the document.
7. Org A confirms intent.
8. Org B raises a dispute.
9. The dispute is resolved.
10. Org B confirms intent.
11. Both organisations check their audit logs.

What should happen if the system is working properly: Both organisations can interact with the same match. Data shared between them is visible to both. Data NOT shared remains private. Audit logs in both organisations reflect the full history.

What to record if it does not work properly: Record which step failed and for which organisation. Record any data visibility issues.

Pass / fail rule: Pass if both organisations can complete their respective steps and audit logs are accurate. Fail if any step fails or data isolation is broken.

---

## MINIMUM TESTS THAT MUST PASS BEFORE LIMITED LIVE TESTING

Test 1: Sign up
Test 2: Email verification
Test 3: Sign in
Test 4: Sign out
Test 9: Onboarding
Test 10: API key creation
Test 11: Search
Test 13: Match creation
Test 15: Match details page
Test 16: Deal terms create and save
Test 38: Audit trail visibility
Test 41: Error states
Test 42: Empty states
Test 43: Loading states

---

## MINIMUM TESTS THAT MUST PASS BEFORE SERIOUS CLIENT DEMO

All of the above, plus:

Test 5: Password reset request
Test 6: Password reset completion
Test 14: Duplicate match prevention
Test 19: Document upload
Test 22: Confirm intent
Test 25: Credit balance display
Test 26: Billing page
Test 31: Dispute — raise
Test 32: Dispute — resolve
Test 36: Data export
Test 37: CSV export
Test 47: Pagination
Test 48: Full end-to-end journey — single user

---

## MINIMUM TESTS THAT MUST PASS BEFORE MULTI-USER INTERNAL TESTING

All of the above, plus:

Test 18: Deal terms conflict handling
Test 33: Team invite
Test 34: Team member access and permissions
Test 35: Admin access
Test 39: Cross-organisation data isolation
Test 40: Multi-user same organisation
Test 49: Full end-to-end journey — two organisations

---

## MINIMUM TESTS THAT MUST PASS BEFORE ENTERPRISE-GRADE ROLLOUT

All of the above, plus:

Test 7: Password change
Test 8: Session expiry
Test 12: Search interruption
Test 17: Deal terms version history
Test 20: Invalid file upload
Test 21: Document access and revocation
Test 23: Confirm intent — insufficient credits
Test 24: Bulk confirm intent
Test 27: Billing — successful payment
Test 28: Payment cancellation
Test 29: Payment failure
Test 30: Double payment protection
Test 44: Browser refresh during form entry
Test 45: Close tab during form entry
Test 46: Network disconnection during action

---

## EVIDENCE THE TESTER SHOULD CAPTURE FOR FAILED TESTS

For every test that fails, capture and record the following:

1. The test number and name.
2. The date and time.
3. The browser and device used.
4. The email address of the account used.
5. A screenshot of the error or unexpected result.
6. The exact text of any error message.
7. What you expected to see.
8. What you actually saw.
9. Whether you were able to work around the issue.
10. Whether the issue is repeatable (does it happen every time or only sometimes).

Save screenshots in a folder named "Test Results — [Date]" and name each file with the test number (e.g., "Test-22-confirm-intent-failure.png").

---

## FINAL NOTE TO THE CLIENT

A system that handles KYC verification, trade compliance, commercial intent records, audit trails, financial credits, and dispute resolution cannot be validated by looking at it. It must be proven through live behaviour.

This test script exists because the platform makes promises — promises about data accuracy, security boundaries, financial correctness, and audit completeness. Each test above is designed to verify one of those promises under realistic conditions.

A platform that passes all of these tests is a platform that can be trusted. A platform that fails any of the critical tests — especially cross-organisation data isolation, credit accuracy, or audit trail completeness — must not be presented to clients until those failures are resolved.

The purpose of this testing is not to find cosmetic issues. It is to prove that the system is truthful, recoverable, and hard to break. That is the standard.

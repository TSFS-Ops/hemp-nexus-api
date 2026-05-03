# Platform Test Pack

Prepared: 13 March 2026 (revised 3 May 2026 — USD pricing)
For: Business stakeholders, operations leads, and anyone responsible for sign-off

---

## Before you begin

This document is your testing playbook. It walks you through every important thing the platform does, and tells you exactly how to check whether it works properly.

You do not need any technical background. You just need a computer, a web browser, and about two hours of focused time. Some tests need two people.

Each test is written as a short recipe. Follow it step by step. At the end, you will know whether the test passed or failed. Write down the result. If something goes wrong, capture a screenshot and note what you saw.

Some tests build on earlier ones. Where that is the case, the test will tell you. You can skip ahead, but the full journey tests at the end assume you have done the basics first.

Let's begin.

---

## PART 1 - GETTING IN

---

Test name: Creating a new account

What you are checking: Can a brand-new person sign up and get started?

Why it matters: This is the front door. If it is locked, nothing else matters.

Who should do this: Anyone. Use a real email you can check.

Before you start: You need a web browser and an email address you have never used on this platform.

Do this:
1. Go to the platform home page.
2. Click "Sign In" or "Get Started."
3. Look for a "Sign up" or "Create account" link. Click it.
4. Type in your email address.
5. Choose a password. It needs to be at least 8 characters. As you type, you should see a coloured bar showing how strong your password is.
6. Click the sign-up button.
7. You should see a message telling you to check your email.

What good looks like: A message appears saying a verification email is on its way. You are not signed in yet - you need to verify first.

What bad looks like: You get an error. Or you are signed straight in without verifying your email. Or the password strength bar never appears.

If it fails, write down: The exact error message. Whether the strength bar appeared. Whether you were signed in without verification.

Pass or fail: Pass if you see the verification message and are not signed in. Fail if anything else happens.

---

Test name: Verifying your email

What you are checking: Does the verification email arrive, and does clicking the link actually work?

Why it matters: Email verification proves you own the address. Without it, anyone could pretend to be you.

Who should do this: The same person who just signed up.

Before you start: You need access to the email inbox you used.

Do this:
1. Open your email inbox.
2. Look for an email from the platform. Give it up to 5 minutes. Check spam if you do not see it.
3. Open the email.
4. Click the verification link.
5. You should land back on the platform, either signed in or told your email is now confirmed.

What good looks like: The link works. You can now sign in normally.

What bad looks like: No email arrives. The link gives an error. The link goes to a blank page.

If it fails, write down: Whether the email arrived. How long it took. What happened when you clicked the link. Screenshot the error.

Pass or fail: Pass if the email arrives within 10 minutes and the link works. Fail otherwise.

---

Test name: Signing in

What you are checking: Can you sign in with the account you just verified?

Why it matters: If you verified your email but still cannot get in, you are locked out.

Who should do this: The person who completed sign-up and verification.

Before you start: Your account must be verified.

Do this:
1. Go to the home page.
2. Click "Sign In."
3. Enter your email and password.
4. Click the sign-in button.
5. You should see your dashboard.

What good looks like: The dashboard appears with a welcome message or your organisation name.

What bad looks like: An error message. A blank page. A spinner that never stops.

If it fails, write down: The exact error. Whether anything loaded at all.

Pass or fail: Pass if you reach the dashboard. Fail if you do not.

---

Test name: Signing out

What you are checking: Does signing out actually lock the door behind you?

Why it matters: If someone walks away from a computer and the next person can still get in, that is a security problem.

Who should do this: Anyone who is currently signed in.

Before you start: You need to be signed in.

Do this:
1. Find the sign-out option (in the sidebar, menu, or under your profile picture).
2. Click "Sign Out."
3. You should land on the home page or the sign-in page.
4. Now type the dashboard address directly into the browser bar and press Enter.
5. You should be sent back to the sign-in page - not the dashboard.

What good looks like: After signing out, you cannot reach any private page. The platform always sends you to sign in.

What bad looks like: You can still see the dashboard after signing out.

If it fails, write down: Whether any private content was visible. Take a screenshot.

Pass or fail: Pass if you are blocked from private pages. Fail if you can still see them.

---

## PART 2 - RECOVERING YOUR ACCOUNT

---

Test name: Requesting a password reset

What you are checking: If you forget your password, can you request a reset link?

Why it matters: Forgotten passwords are the single most common support issue. If this does not work, people get locked out.

Who should do this: Anyone with an account.

Before you start: You need your registered email and access to that inbox.

Do this:
1. Go to the sign-in page.
2. Click "Forgot password" or "Reset password."
3. Enter your email.
4. Click Submit.
5. You should see a message telling you to check your email, including a note about checking spam and that the link expires in 1 hour.

What good looks like: A helpful message appears on screen. A reset email arrives within a few minutes.

What bad looks like: No message appears. Or the message is vague. Or no email arrives.

If it fails, write down: What message you saw. Whether the email arrived. How long you waited.

Pass or fail: Pass if the message is clear and the email arrives within 10 minutes. Fail otherwise.

---

Test name: Completing the password reset

What you are checking: Does the reset link actually let you set a new password?

Why it matters: If the link does not work, people cannot recover their accounts.

Who should do this: The person who just requested the reset.

Before you start: You need the reset email.

Do this:
1. Open the reset email.
2. Click the link.
3. You should see a page asking for a new password.
4. Enter a new password (at least 8 characters). You should see a strength indicator.
5. Submit it.
6. You should see a success message.
7. Sign out, then sign back in with the new password.

What good looks like: The new password works. The old one does not.

What bad looks like: The link gives an error. You can still sign in with the old password.

If it fails, write down: The error. Whether the strength indicator appeared. Whether the old password still works.

Pass or fail: Pass if the new password works and the old one is rejected. Fail otherwise.

---

Test name: Changing your password from inside the platform

What you are checking: Can you change your password without going through the "forgot password" flow?

Why it matters: Good security practice means changing passwords regularly.

Who should do this: Anyone who is signed in.

Before you start: You must be signed in.

Do this:
1. Go to your account or security settings (look in the sidebar or under your profile picture).
2. Find the password section.
3. Enter a new password.
4. Save it.
5. Sign out.
6. Sign back in with the new password.

What good looks like: The new password works.

What bad looks like: You get an error during the change. Or you are locked out. Or you get unexpectedly signed out mid-change without warning.

If it fails, write down: The error. Whether you were signed out during the change.

Pass or fail: Pass if you can sign in with the new password. Fail if the change fails or locks you out.

---

Test name: Session expiry

What you are checking: When your session runs out (like being away for too long), does the platform warn you and redirect you to sign in?

Why it matters: In a compliance system, an expired session must not silently stay open. The platform must force you to sign in again.

Who should do this: Someone who can leave the browser open for a while, or who has help from a developer to shorten the timeout.

Before you start: Sign in and leave the browser open.

Do this:
1. Sign in.
2. Walk away and let the session expire (this may take an hour or more).
3. Come back and click on something.
4. You should see a message saying "Your session has expired."
5. You should be sent to the sign-in page.
6. After signing back in, you should return to the page you were on before.

What good looks like: A clear expiry message. Redirect to sign-in. Return to the same page after signing back in.

What bad looks like: The session quietly continues. Or you get a blank page. Or you lose your place.

If it fails, write down: Whether the message appeared. Whether you were redirected. Whether you returned to the right page.

Pass or fail: Pass if you are warned, redirected, and returned to the right page. Fail otherwise.

---

## PART 3 - GETTING STARTED

---

Test name: Onboarding for first-time users

What you are checking: Does the platform show a welcome guide the first time you sign in?

Why it matters: New users need to know how the platform works. Without a guide, they will be lost.

Who should do this: Someone with a brand-new account that has never signed in before.

Before you start: A freshly verified account.

Do this:
1. Sign in for the first time.
2. You should see a welcome screen or quickstart guide.
3. Read through it. It should explain the main things you can do: search for trading partners, create a match, confirm your intent.
4. Click "Skip" or "Dismiss" if available.
5. You should now see the main dashboard.

What good looks like: A clear, friendly guide appears. It can be skipped. The dashboard loads after dismissal.

What bad looks like: No guide appears. Or it cannot be dismissed. Or the dashboard is blank after dismissal.

If it fails, write down: Whether the guide appeared. Whether it could be dismissed. Any issues after dismissal.

Pass or fail: Pass if the guide appears and is easy to follow. Fail if nothing appears or it gets stuck.

---

Test name: Creating an API key

What you are checking: Can you create a key that lets other software connect to the platform on your behalf?

Why it matters: Many organisations use their own tools alongside this platform. API keys are how they connect.

Who should do this: Any signed-in user.

Before you start: You must be signed in.

Do this:
1. Go to the API Keys section in your dashboard.
2. Click "Create API Key" or similar.
3. Give it a name like "Test Key."
4. Choose permissions if asked (pick at least "search" and "match").
5. Click Create.
6. You should see the key displayed. This is the only time you will ever see the full key.
7. Click the Copy button.
8. Paste it into a text document to make sure it copied correctly.

What good looks like: The key appears once. Copy works. After you leave the page, the full key is hidden forever.

What bad looks like: The key does not appear. Copy does not work. The key is still visible after navigating away.

If it fails, write down: Whether the key was shown. Whether copy worked. Whether it stayed visible after leaving.

Pass or fail: Pass if the key is shown once and copies correctly. Fail otherwise.

---

## PART 4 - FINDING COUNTERPARTIES

---

Test name: Running a search

What you are checking: Can you search for potential trading partners and get meaningful results?

Why it matters: Search is the starting point of every deal. No search, no deals.

Who should do this: Any signed-in user.

Before you start: You must be signed in.

Do this:
1. Go to the Search section.
2. Type something like "maize exporter south africa."
3. Click Search or press Enter.
4. Wait for results. This can take up to 30 seconds because the platform checks several sources.
5. You should see a list of results, or a clear message saying nothing was found.

What good looks like: Results appear within 30 seconds. Or a clear "no results found" message appears.

What bad looks like: The spinner never stops. The page freezes. An unhelpful error appears.

If it fails, write down: What you searched for. Whether a spinner appeared. Whether it got stuck. The error message.

Pass or fail: Pass if results or a clear "no results" message appear within 30 seconds. Fail otherwise.

---

Test name: Interrupting a search

What you are checking: If you click away while a search is still running, does the platform handle it cleanly?

Why it matters: People click away from slow-loading pages all the time. The platform should not break when they do.

Who should do this: Any signed-in user.

Before you start: You must be signed in.

Do this:
1. Start a search.
2. While the spinner is still going, click on something else in the sidebar (like Matches or Settings).
3. Wait a moment.
4. Go back to Search.
5. Try a new search.

What good looks like: No errors when you navigate away. Search works normally when you come back.

What bad looks like: An error pops up. Or the search section is stuck when you return.

If it fails, write down: What error appeared. Whether search still worked when you came back.

Pass or fail: Pass if you can navigate away and return without problems. Fail if anything breaks.

---

## PART 5 - MATCHES

---

Test name: Creating a match

What you are checking: Can you create a record linking a buyer and a seller for a specific deal?

Why it matters: Matches are the heart of the platform. Every deal starts here.

Who should do this: Any signed-in user.

Before you start: You must be signed in.

Do this:
1. Go to the Matches section or find "Create Match."
2. Fill in the details: buyer name, seller name, what is being traded, how much, and the price.
3. Click Create or Submit.
4. You should see a confirmation.
5. The new match should appear in your matches list.
6. Click on it. The details page should show exactly what you entered.

What good looks like: The match is created. It appears in the list. The details are correct, including a unique reference number and a security hash.

What bad looks like: You get an error. The match does not appear. The details are wrong.

If it fails, write down: The error. What you entered. Whether the match showed up.

Pass or fail: Pass if the match is created with correct details. Fail if it is not.

---

Test name: Preventing duplicate matches

What you are checking: If you accidentally click the Create button twice, does the system only create one match?

Why it matters: Duplicate records cause confusion, incorrect billing, and compliance problems.

Who should do this: Any signed-in user.

Before you start: You must be signed in.

Do this:
1. Start creating a match.
2. Click the Create button.
3. Immediately click it again before the first request finishes.
4. Check the matches list.

What good looks like: Only one match appears. The button was either disabled after the first click, or the platform caught the duplicate.

What bad looks like: Two identical matches appear.

If it fails, write down: Whether two matches appeared. Whether the button was disabled after the first click.

Pass or fail: Pass if only one match is created. Fail if duplicates appear.

---

Test name: Reviewing match details

What you are checking: Does the match details page show complete and accurate information?

Why it matters: This page is the official record of the deal. It must be right.

Who should do this: Anyone with at least one match.

Before you start: You need an existing match.

Do this:
1. Open the Matches section.
2. Click on a match.
3. Check that you can see: the match reference, buyer, seller, what is being traded, quantity, price, current status, when it was created, and the evidence hash.
4. Check that there are tabs for deal terms, documents, notes, timeline, and disputes.

What good looks like: Every field has the right information. Nothing says "undefined" or "null." All tabs work.

What bad looks like: Fields are missing or wrong. Tabs do not load.

If it fails, write down: Which fields are wrong or missing. Screenshot the page.

Pass or fail: Pass if all information is correct and all tabs work. Fail if anything is missing or broken.

---

## PART 6 - DEAL TERMS

---

Test name: Saving deal terms

What you are checking: Can you enter the commercial terms for a deal and have them saved correctly?

Why it matters: Deal terms are legally significant. If they do not save properly, the record is useless.

Who should do this: Anyone with a match.

Before you start: You need an existing match.

Do this:
1. Open a match.
2. Go to the Deal Terms tab.
3. Enter payment terms (e.g., "30 days letter of credit").
4. Enter delivery terms (e.g., "FOB Durban").
5. Enter inspection terms (e.g., "SGS at load port").
6. Click Save.
7. Navigate away from the page.
8. Come back to the same match and open Deal Terms again.

What good looks like: Everything you entered is still there when you come back.

What bad looks like: Some or all of the terms are missing.

If it fails, write down: Which fields were lost. Any error messages.

Pass or fail: Pass if all terms are saved and still correct on return. Fail if anything is lost.

---

Test name: Checking deal terms history

What you are checking: When you update deal terms, is the old version still available?

Why it matters: If there is ever a disagreement about what the terms were, you need to be able to look back at previous versions.

Who should do this: Someone who already saved deal terms.

Before you start: Deal terms must already exist for a match.

Do this:
1. Open the deal terms.
2. Change one field (e.g., change "30 days" to "60 days").
3. Save.
4. Look for a version history or "previous versions" option.

What good looks like: The new version is saved. The old version is still visible somewhere. Each version is numbered.

What bad looks like: The old version is gone. There is no history.

If it fails, write down: Whether the old terms were overwritten. Whether any history view exists.

Pass or fail: Pass if old versions are kept. Fail if old terms vanish.

---

Test name: Two people editing deal terms at the same time

What you are checking: If two colleagues edit the same deal terms at the same time, does the platform handle it safely?

Why it matters: In a busy team, people sometimes work on the same record. The platform must not silently lose one person's work.

Who should do this: Two people in the same organisation, each on their own computer.

Before you start: A match with existing deal terms. Two accounts.

Do this:
1. Person A opens the deal terms for a match.
2. Person B opens the same deal terms on a different computer.
3. Person A changes payment terms to "45 days" and clicks Save.
4. Person B changes payment terms to "90 days" and clicks Save (without refreshing first).
5. Both people refresh the page.

What good looks like: Only one version is saved. Ideally, Person B was warned that the terms changed since they opened the page. At the very least, the saved record is consistent - not a mix of both edits.

What bad looks like: The record is a confusing mix of both edits. Or one person's work disappears without any warning.

If it fails, write down: What each person sees after refreshing. Whether any warning appeared.

Pass or fail: Pass if the record is consistent. Fail if it is corrupted or mixed.

---

## PART 7 - DOCUMENTS

---

Test name: Uploading a document

What you are checking: Can you attach a document (like an invoice or certificate) to a match?

Why it matters: Trade documents are critical evidence. The platform must handle them reliably.

Who should do this: Anyone with a match.

Before you start: A match must exist. Have a small PDF or image file ready (under 10 MB).

Do this:
1. Open a match.
2. Go to the Documents tab.
3. Click "Upload Document."
4. Choose a file from your computer.
5. Select a document type if asked (e.g., "Commercial Invoice").
6. Click Upload.
7. The document should appear in the list.

What good looks like: The document shows up with the right filename, type, and date.

What bad looks like: The upload fails. The spinner gets stuck. The document does not appear.

If it fails, write down: The error. The file type and size.

Pass or fail: Pass if the document appears correctly. Fail if the upload fails.

---

Test name: Uploading an invalid file

What you are checking: Does the platform reject files that are too large, empty, or potentially dangerous?

Why it matters: Accepting bad files is a security and data quality risk.

Who should do this: Anyone with a match.

Before you start: Prepare three files: an empty file (0 bytes), a very large file (over 50 MB), and something unusual like a .exe file.

Do this:
1. Open the Documents section of a match.
2. Try uploading the empty file. Note what happens.
3. Try uploading the oversized file. Note what happens.
4. Try uploading the .exe file. Note what happens.

What good looks like: Each bad file is rejected with a clear explanation.

What bad looks like: A bad file is silently accepted.

If it fails, write down: Which files were accepted. What error messages appeared.

Pass or fail: Pass if all bad files are rejected. Fail if any are accepted.

---

Test name: Sharing and revoking document access

What you are checking: Can you share a document with another organisation and then take that access away?

Why it matters: Trade documents are confidential. You need to control who sees them.

Who should do this: Two people in different organisations.

Before you start: A match with a document. Two accounts in different organisations.

Do this:
1. Person A uploads a document.
2. Person A shares it with Person B's organisation.
3. Person B signs in and checks whether they can see the document.
4. Person A revokes access.
5. Person B refreshes and checks whether the document is still visible.

What good looks like: Person B can see the document after sharing. After revocation, they cannot.

What bad looks like: Person B can see the document before sharing. Or they can still see it after revocation.

If it fails, write down: Whether access worked correctly at each stage.

Pass or fail: Pass if sharing gives access and revoking takes it away. Fail if access is not controlled properly.

---

## PART 8 - CONFIRMING INTENT

---

Test name: Confirming your intent on a match

What you are checking: Can you formally declare that you intend to proceed with a deal?

Why it matters: This is the most important action on the platform. It creates a binding commercial record, deducts credits, and generates an audit trail.

Who should do this: Anyone with a match and enough credits.

Before you start: A match in an eligible state. Your organisation must have an active licence and enough credits. If you need credits, complete the billing test first.

Do this:
1. Open a match.
2. Find the "Confirm Intent" button.
3. Click it.
4. A confirmation dialog should appear asking you to confirm.
5. Confirm.
6. Wait for the result.

What good looks like: The match status changes to something like "intent declared." Your credit balance goes down. The audit log shows the action. The match timeline shows the event.

What bad looks like: You get an error. Pay special attention if the error says "LICENCE_REQUIRED" - that means the platform's licence setup is not complete. Also check whether your credits were deducted even though the action failed.

If it fails, write down: The exact error. Your credit balance before and after.

Pass or fail: Pass if the status changes, credits are deducted correctly, and the audit trail exists. Fail if the action fails or credits are wrong.

---

Test name: Confirming intent with no credits

What you are checking: Does the platform stop you from confirming intent when you do not have enough credits?

Why it matters: Allowing the action without payment would be a commercial error.

Who should do this: A user with no credits.

Before you start: Make sure your credit balance is zero or too low.

Do this:
1. Check your balance and confirm it is low or zero.
2. Open a match and try to confirm intent.
3. The platform should stop you with a clear message about needing more credits.
4. The match status should not change.

What good looks like: You are blocked. A clear message explains the problem. There is a link to the billing page.

What bad looks like: The action goes through despite no credits. Or there is no message explaining why you were blocked.

If it fails, write down: Whether the action was allowed. What message appeared.

Pass or fail: Pass if the action is blocked with a helpful message. Fail if intent is confirmed without credits.

---

Test name: Confirming intent on several matches at once

What you are checking: Can you confirm intent on multiple matches in one go?

Why it matters: Busy users managing many deals need to be able to do this efficiently.

Who should do this: Someone with at least 3 eligible matches and enough credits.

Before you start: Multiple matches ready for confirmation. Enough credits.

Do this:
1. Go to the matches list.
2. Select several matches using checkboxes.
3. Click the bulk confirm button.
4. A dialog should show how many will be confirmed.
5. Confirm.
6. Watch the progress.
7. After it finishes, check each match to see if the status changed.

What good looks like: All selected matches are confirmed. Progress was clear. Credits were deducted for each. Audit trail entries exist for each.

What bad looks like: Some matches are confirmed but others are not, without explanation. Or the progress was unclear. Or some matches are stuck in a half-finished state.

If it fails, write down: How many were selected versus confirmed. Whether any are in a confusing state.

Pass or fail: Pass if all are confirmed with correct records. Fail if any are left in an inconsistent state.

---

## PART 9 - CREDITS AND BILLING

---

Test name: Checking your credit balance

What you are checking: Is the credit balance on screen always accurate?

Why it matters: If the balance is wrong, you might think you have credits you do not, or be blocked when you should not be.

Who should do this: Any signed-in user.

Before you start: Note your current balance.

Do this:
1. Write down your balance.
2. Do something that uses credits (like confirming intent).
3. Check the balance again immediately.
4. Refresh the page.
5. Check the balance once more.

What good looks like: The balance went down by the right amount. It is the same after refresh.

What bad looks like: The balance did not change. Or it changed by the wrong amount. Or it is different after refresh.

If it fails, write down: Balance before, expected deduction, balance after, balance after refresh.

Pass or fail: Pass if the balance is correct at every step. Fail if it is ever wrong.

---

Test name: Viewing credit packages

What you are checking: Does the billing page show the available packages with clear pricing?

Why it matters: People need to understand what they are buying.

Who should do this: Any signed-in user.

Before you start: Sign in.

Do this:
1. Go to the Billing page.
2. You should see a list of credit packages with prices in US Dollars (USD). The standard tiers are: 1 credit for $1, 10 credits for $10, 50 credits for $45 (a 10% saving), and 200 credits for $160 (a 20% saving).
3. Each package should clearly say how many credits you get and what it costs in USD.

What good looks like: Packages are listed clearly with Buy buttons.

What bad looks like: The page is blank. Prices are missing. There are no Buy buttons.

If it fails, write down: What appeared on the page.

Pass or fail: Pass if packages and prices are clearly shown. Fail if anything is missing or unclear.

---

Test name: Buying credits successfully

What you are checking: Does the full payment process work from start to finish?

Why it matters: This is how the business gets paid.

Who should do this: Someone authorised to make test payments. Use a test card if one is available.

Before you start: Note your current credit balance.

Do this:
1. Write down your balance.
2. Go to the Billing page.
3. Choose a package and click Buy.
4. You will be taken to a payment page.
5. Complete the payment.
6. You should be brought back to the platform with a success message.
7. Check your balance. It should have gone up by the amount in the package.

What good looks like: Payment works. You come back. Balance increases immediately.

What bad looks like: Payment succeeds but credits are not added. Or you are not brought back.

If it fails, write down: Where it broke. The error. Balance before and after.

Pass or fail: Pass if credits appear after payment. Fail if they do not.

---

Test name: Cancelling a payment

What you are checking: If you start a payment and then cancel, are you charged? Are credits added?

Why it matters: Cancelling must not cost you anything.

Who should do this: Any signed-in user.

Before you start: Note your balance.

Do this:
1. Go to the Billing page.
2. Choose a package and click Buy.
3. On the payment page, click Cancel or close the tab.
4. Come back to the platform.
5. Check your balance.

What good looks like: Balance is unchanged. A message says the payment was cancelled.

What bad looks like: Credits were added even though you cancelled.

If it fails, write down: Whether credits changed. Any messages shown.

Pass or fail: Pass if balance is unchanged. Fail if credits were added or money was charged.

---

Test name: Payment failure

What you are checking: If a payment is declined, is the user told clearly and are no credits added?

Why it matters: A declined payment must never result in credits.

Who should do this: Someone with a payment method that will be declined (like a test card designed to fail).

Before you start: Note your balance.

Do this:
1. Try to buy credits with the failing payment method.
2. The payment should fail.
3. Come back to the platform.
4. Check your balance.

What good looks like: Balance is unchanged. A clear message explains what happened and suggests contacting support.

What bad looks like: Credits were added despite the failure.

If it fails, write down: Whether credits changed. The error message.

Pass or fail: Pass if balance is unchanged and there is a clear error. Fail if credits appear.

---

Test name: Protection against being charged twice

What you are checking: If the payment system accidentally sends two confirmations for the same purchase, are credits only added once?

Why it matters: Being charged twice or credited twice is a serious financial error.

Who should do this: This may need a developer to simulate. You can also try by clicking the Buy button twice very quickly.

Before you start: Note your balance.

Do this:
1. Buy a credit package.
2. Note the new balance.
3. If possible, have a developer re-send the same payment confirmation.
4. Check the balance again.

What good looks like: Credits are added exactly once.

What bad looks like: Credits are doubled.

If it fails, write down: Balance at each step.

Pass or fail: Pass if credits are added once. Fail if they are doubled.

---

## PART 10 - DISPUTES

---

Test name: Raising a dispute

What you are checking: Can you formally challenge a match?

Why it matters: Disputes are the safety valve. If a deal goes wrong, you need a way to raise a concern and block further action until it is resolved.

Who should do this: Anyone with a match.

Before you start: You need an existing match.

Do this:
1. Open a match.
2. Go to the Disputes tab.
3. Click "Raise Dispute."
4. Enter a reason.
5. Submit.
6. The dispute should appear in the list.
7. The match status should show a dispute is active.

What good looks like: The dispute is created. It appears in the list. The match can no longer be settled while the dispute is active.

What bad looks like: The dispute cannot be created. Or it does not block settlement.

If it fails, write down: The error. Whether the dispute appeared. Whether settlement was blocked.

Pass or fail: Pass if the dispute is created and blocks settlement. Fail otherwise.

---

Test name: Resolving a dispute

What you are checking: Can a dispute be resolved so the match can move forward again?

Why it matters: If disputes cannot be resolved, matches are permanently stuck.

Who should do this: The person who raised the dispute, or an admin.

Before you start: You need an active dispute.

Do this:
1. Open the match with the dispute.
2. Go to the Disputes tab.
3. Click on the dispute.
4. Click "Resolve."
5. Enter a resolution note.
6. Submit.
7. The dispute status should change to "resolved."
8. Try to confirm intent on the match. It should now be possible.

What good looks like: The dispute is resolved. Settlement is unblocked.

What bad looks like: The resolution option is missing. Or settlement is still blocked after resolution.

If it fails, write down: Whether resolution was available. Whether settlement was unblocked.

Pass or fail: Pass if the dispute is resolved and the match can proceed. Fail otherwise.

---

## PART 11 - TEAMS AND PERMISSIONS

---

Test name: Inviting a team member

What you are checking: Can an admin invite someone new to the organisation?

Why it matters: Organisations need to add staff. If invitations do not work, teams cannot grow.

Who should do this: An admin user.

Before you start: You must be signed in as an admin. Have a second email address ready.

Do this:
1. Go to Team Management in your account settings.
2. Click "Invite Member."
3. Enter the new person's email.
4. Choose their role (e.g., "Member").
5. Click Send.
6. Check whether the person appears as "pending" in the team list.
7. Check whether they receive an email with instructions.

What good looks like: The invite is sent. The person shows as pending. They get an email.

What bad looks like: The invite fails. No email arrives.

If it fails, write down: The error. Whether the email arrived.

Pass or fail: Pass if the invite is sent and the email arrives. Fail otherwise.

---

Test name: Making sure team members have the right access

What you are checking: Can a regular team member see their organisation's data but not do admin things?

Why it matters: People in different roles should have different levels of access. A junior staff member should not be able to delete API keys or manage the team.

Who should do this: Two people - one admin, one regular member - in the same organisation.

Before you start: An admin account and a member account.

Do this:
1. Sign in as the member.
2. Check you can see the dashboard, matches, search, and your own profile.
3. Try to get to Team Management. You should not be able to.
4. Try to get to admin settings. You should be blocked.
5. Try to delete an API key the admin created. You should be blocked.
6. Now sign in as the admin. Confirm you CAN do all of these things.

What good looks like: The member can view data but cannot do admin tasks.

What bad looks like: The member can access admin functions. This is a security problem.

If it fails, write down: Which admin actions the member could perform.

Pass or fail: Pass if the member is blocked from admin actions. Fail if they are not.

---

Test name: Admin panel access control

What you are checking: Can a non-admin get into the admin panel?

Why it matters: The admin panel has system-wide data. Only authorised people should see it.

Who should do this: One admin and one non-admin.

Before you start: Both accounts ready.

Do this:
1. Sign in as the non-admin.
2. Type the admin page address directly into the browser.
3. You should be sent to the dashboard or see an access-denied message.
4. Sign in as the admin.
5. Go to the admin panel normally. It should load fine.

What good looks like: Non-admins cannot access the admin panel.

What bad looks like: Non-admins can see admin content.

If it fails, write down: What the non-admin could see.

Pass or fail: Pass if non-admin is blocked. Fail if they can see anything.

---

## PART 12 - DATA EXPORTS

---

Test name: Exporting your data

What you are checking: Can you download a complete copy of your data?

Why it matters: Data portability is a compliance requirement. The export must be accurate and complete.

Who should do this: Anyone with some data in the system.

Before you start: You need at least a few matches and audit log entries.

Do this:
1. Go to the data export section (look in Settings or Account).
2. Click Export or Download.
3. A file should download.
4. Open it.
5. Compare it to what you see on screen. The numbers should match.

What good looks like: The file downloads. It has all your data. If you have 50 records, all 50 are in the file.

What bad looks like: The file is empty. Or it has fewer records than expected.

If it fails, write down: Whether the file downloaded. How many records you expected versus how many are in the file.

Pass or fail: Pass if the data is complete and correct. Fail if it is missing records.

---

Test name: Downloading a CSV from a list

What you are checking: Does the CSV file open correctly in Excel or Google Sheets?

Why it matters: CSV files are used for reporting and auditing. If the format is broken, the file is useless.

Who should do this: Anyone with data.

Before you start: You need at least a few records.

Do this:
1. Go to a list view (like Matches).
2. Click "Export CSV" or "Download."
3. Open the file in a spreadsheet program.
4. Check that all the columns line up.
5. Check whether special characters (like commas or quotation marks in data) break the formatting.
6. Check whether the file contains only the current page or all your records.

What good looks like: The file opens correctly. Columns are aligned. The file says if it only includes some of your records.

What bad looks like: Columns are jumbled. Or you have 200 records but the file only has 25 without telling you.

If it fails, write down: Whether columns were broken. How many records were in the file versus how many exist.

Pass or fail: Pass if the format is correct and it is honest about how many records are included. Fail if the format is broken or records are silently missing.

---

## PART 13 - AUDIT TRAIL

---

Test name: Checking the audit trail

What you are checking: Are all your important actions recorded in the audit log?

Why it matters: In compliance and trade, you must be able to prove who did what and when. The audit trail is the proof.

Who should do this: Anyone who has performed several actions.

Before you start: You should have created matches, uploaded documents, and trade request (or at least attempted to).

Do this:
1. Go to the Audit Logs section.
2. Look for entries that match your recent actions.
3. For each entry, check that it shows: what happened, who did it, when, and what it related to (e.g., which match).
4. Specifically look for a "match created" entry for a match you created.
5. If you raised a dispute, look for a "dispute created" entry.

What good looks like: Every important thing you did has a log entry. Entries are in time order. Each one has enough detail to understand what happened.

What bad looks like: Some actions are missing. Entries are incomplete.

If it fails, write down: Which actions are missing from the log.

Pass or fail: Pass if all important actions are recorded with enough detail. Fail if any are missing.

---

## PART 14 - SECURITY AND ISOLATION

---

Test name: Making sure organisations cannot see each other's data

What you are checking: Can a user in one organisation see matches, documents, or records belonging to a different organisation?

Why it matters: This is the single most important security test. If Organisation A can see Organisation B's data, the platform cannot be trusted.

Who should do this: Two people, each in a different organisation.

Before you start: Two accounts in two different organisations. Each should have at least one match.

Do this:
1. Sign in as someone from Organisation Alpha.
2. Write down the matches and data you can see.
3. Sign out.
4. Sign in as someone from Organisation Beta.
5. Write down the matches and data you can see.
6. Confirm that nothing from Organisation Alpha is visible.
7. Try typing the web address of one of Organisation Alpha's matches directly into the browser.
8. You should get an error or be redirected - you should absolutely not see the match.

What good looks like: Complete separation. Each organisation only sees its own data. Direct URL access to the other organisation's data is blocked.

What bad looks like: Any data from the other organisation is visible.

If it fails, write down: Exactly what cross-organisation data was visible. This is a critical security failure.

Pass or fail: Pass if complete isolation is maintained. Fail if any data leaks across organisations.

---

## PART 15 - WORKING TOGETHER

---

Test name: Two people working at the same time in the same organisation

What you are checking: Can two colleagues use the platform at the same time without stepping on each other's toes?

Why it matters: Teams work simultaneously. The platform must handle this without losing data.

Who should do this: Two people in the same organisation.

Before you start: Two accounts in the same organisation.

Do this:
1. Both sign in at the same time on different computers.
2. Person A creates a match.
3. Person B refreshes their match list. The new match should appear.
4. Person B opens the match and adds deal terms.
5. Person A refreshes the match details. The deal terms should appear.
6. Both check the audit log. Both actions should be logged.

What good looks like: Both people can work at the same time. Changes show up after refresh. Both actions are in the audit log.

What bad looks like: Changes are invisible to the other person. Or data is lost.

If it fails, write down: Which changes were not visible. Any errors.

Pass or fail: Pass if both can work simultaneously and see each other's changes. Fail if data is lost or invisible.

---

## PART 16 - WHAT HAPPENS WHEN THINGS GO WRONG

---

Test name: Error messages

What you are checking: When something goes wrong, does the platform tell you clearly?

Why it matters: Errors are inevitable. What matters is that the user is never left staring at a blank screen wondering what happened.

Who should do this: Any signed-in user.

Before you start: Sign in.

Do this:
1. Type a made-up match reference into the URL and press Enter. You should see a "not found" message - not a crash or blank page.
2. Try to submit a form with required fields left empty. You should see messages on the empty fields.
3. Turn off your internet and try to do something. You should see a network error message - not silence.

What good looks like: Every error shows a clear, specific message.

What bad looks like: A blank screen. A crash. Or nothing at all - the action just silently fails.

If it fails, write down: Which scenario produced a bad result.

Pass or fail: Pass if all errors show clear messages. Fail if any show a blank screen, crash, or nothing.

---

Test name: Empty pages

What you are checking: When a section has no data yet, does the platform explain that?

Why it matters: A completely blank area looks broken. A message like "No matches yet - create your first one" is helpful.

Who should do this: A new user, or test sections that have no data.

Before you start: Find a section with no data.

Do this:
1. Go through each main section: Matches, Documents, Audit Logs, Billing, Team.
2. If a section has no data, check whether it shows a helpful message.
3. It should NOT be a completely blank area.

What good looks like: Every empty section has a message with guidance.

What bad looks like: A blank area with no explanation.

If it fails, write down: Which sections were blank.

Pass or fail: Pass if all empty sections have messages. Fail if any are blank.

---

Test name: Loading indicators

What you are checking: When data is loading, do you see a spinner or other indicator?

Why it matters: Without a loading indicator, you cannot tell if the platform is working or stuck.

Who should do this: Any signed-in user.

Before you start: Sign in.

Do this:
1. Navigate to each main section.
2. Watch for a spinner, progress bar, or grey placeholder shapes while data loads.
3. The indicator should disappear when the data appears.

What good looks like: Every page shows a loading indicator while fetching data.

What bad looks like: A blank page while data loads.

If it fails, write down: Which pages showed nothing during loading.

Pass or fail: Pass if all pages show loading indicators. Fail if any are blank during loading.

---

Test name: Refreshing the page while filling in a form

What you are checking: If you accidentally hit refresh while entering information, do you lose everything?

Why it matters: Losing your work because of an accidental refresh is frustrating, especially when entering complex deal terms.

Who should do this: Any signed-in user.

Before you start: Go to a form like deal terms.

Do this:
1. Open a form and fill in some fields but do NOT save.
2. Press F5 (or the refresh button).
3. Check whether a "you have unsaved changes" warning appeared.
4. If it did, click Cancel to stay. Check your data is still there.
5. If no warning appeared, check whether the data was automatically saved and restored.

What good looks like: Either a warning stops the refresh, or your data is preserved automatically.

What bad looks like: Everything you entered is silently lost.

If it fails, write down: Whether a warning appeared. Whether data was lost.

Pass or fail: Pass if data is protected. Fail if it is silently lost.

---

Test name: Closing the browser tab while filling in a form

What you are checking: Same as above, but for accidentally closing the tab.

Why it matters: Tab closure is even more common than accidental refresh.

Who should do this: Any signed-in user.

Before you start: Go to a form.

Do this:
1. Fill in some fields.
2. Try to close the browser tab.
3. A "leave page?" warning should appear.

What good looks like: The warning appears.

What bad looks like: The tab closes without warning.

If it fails, write down: Whether the warning appeared.

Pass or fail: Pass if a warning appears. Fail if the tab closes silently.

---

Test name: Losing your internet connection during an action

What you are checking: If your internet drops while you are saving something, does the platform handle it gracefully?

Why it matters: This happens regularly, especially on mobile or unreliable connections.

Who should do this: Someone comfortable turning their internet off and on.

Before you start: Sign in and go to a form.

Do this:
1. Start filling in a form.
2. Turn off your internet.
3. Click Save.
4. You should see a network error within about 15 seconds.
5. Turn your internet back on.
6. Try again. It should work.

What good looks like: A clear error appears quickly. Reconnecting and retrying works. No garbled data is saved.

What bad looks like: The platform hangs forever. Or it silently fails. Or it saves partial, corrupted data.

If it fails, write down: Whether the error appeared. How long it took. Whether the retry worked.

Pass or fail: Pass if you see an error within 15 seconds and retry works. Fail otherwise.

---

Test name: Handling large amounts of data

What you are checking: When there are lots of records, does the platform show them across multiple pages and tell you the total?

Why it matters: If the platform shows you 25 matches but you actually have 200, and there is no indication that more exist, you might make decisions based on incomplete information.

Who should do this: Someone with a lot of data (at least 30 records in one section).

Before you start: An account with enough data to fill more than one page.

Do this:
1. Go to a list view (like Matches or Audit Logs).
2. Look for a count (like "Showing 1–25 of 87").
3. Click Next or go to the next page.
4. Check that the records are different.
5. Go to the last page and check the records end where expected.

What good looks like: The total is shown. Pages work. Records are correctly split across pages.

What bad looks like: No total is shown. Or the same records appear on every page. Or there are no page controls.

If it fails, write down: Whether the total was shown. Whether pages worked.

Pass or fail: Pass if the total is shown and pagination works. Fail if data is silently cut off.

---

## PART 17 - THE FULL JOURNEY

---

Test name: Complete single-user journey

What you are checking: Can one person go from sign-up to trade request without anything breaking?

Why it matters: This proves the platform works as a complete product, not just a collection of separate features.

Who should do this: A fresh tester who has never used the platform before.

Before you start: A new email address and a web browser.

Do this:
1. Sign up with the new email.
2. Verify your email.
3. Sign in.
4. Go through onboarding.
5. Create an API key.
6. Run a search.
7. Create a match.
8. Add deal terms.
9. Upload a document.
10. Buy credits.
11. Confirm intent on the match.
12. Check the audit log for all your actions.
13. Export your data.

What good looks like: Every single step works. Each step builds on the one before. The audit log shows a complete history. The export contains everything.

What bad looks like: The journey breaks at any step.

If it fails, write down: The step number where it broke. The exact error. What you did to try to get past it.

Pass or fail: Pass if all 13 steps work without errors. Fail if any step blocks you.

---

Test name: Complete two-organisation journey

What you are checking: Can two organisations interact through the platform on the same deal?

Why it matters: The platform exists to connect two parties. This must work across organisation boundaries.

Who should do this: Two people, each in a different organisation.

Before you start: Two separate organisation accounts.

Do this:
1. Org A creates a match involving Org B.
2. Org B signs in and checks whether the match is visible.
3. Org A adds deal terms.
4. Org B reviews the deal terms.
5. Org A uploads a document and shares it with Org B.
6. Org B checks whether they can see the document.
7. Org A confirms intent.
8. Org B raises a dispute.
9. The dispute is resolved.
10. Org B confirms intent.
11. Both organisations check their audit logs.

What good looks like: Both sides can participate in the same match. Shared data is visible. Private data stays private. Both audit logs tell the full story.

What bad looks like: Any step fails. Or data leaks across organisations.

If it fails, write down: Which step failed. For which organisation. Any data that should not have been visible.

Pass or fail: Pass if both organisations complete their steps and audit logs are accurate. Fail if any step fails or data isolation breaks.

---

## READINESS GATES

---

Before limited live testing, these must pass:
- Creating a new account
- Email verification
- Signing in
- Signing out
- Onboarding
- API key creation
- Running a search
- Creating a match
- Match details page
- Saving deal terms
- Audit trail
- Error messages
- Empty pages
- Loading indicators

Before a client presentation, add these:
- Password reset (request and completion)
- Duplicate match prevention
- Document upload
- Confirming intent
- Credit balance display
- Billing page
- Raising a dispute
- Resolving a dispute
- Data export
- CSV export
- Pagination
- Complete single-user journey

Before multi-user internal testing, add these:
- Deal terms conflict handling
- Team invite
- Team member access and permissions
- Admin panel access control
- Cross-organisation data isolation
- Two people working at the same time
- Complete two-organisation journey

Before enterprise rollout, add these:
- Password change from settings
- Session expiry
- Search interruption
- Deal terms version history
- Invalid file upload
- Document sharing and revocation
- Confirming intent with no credits
- Bulk confirming intent
- Buying credits successfully
- Cancelling a payment
- Payment failure
- Double payment protection
- Browser refresh during form entry
- Closing tab during form entry
- Network disconnection
- Large data volumes

---

## WHAT TO CAPTURE IF A TEST FAILS

For every failed test, record:

1. The test name.
2. The date and time.
3. Which browser you used (Chrome, Safari, Firefox, etc.) and which device (laptop, phone, tablet).
4. The email address of the account you used.
5. A screenshot of what you saw.
6. The exact words of any error message.
7. What you expected to happen.
8. What actually happened.
9. Whether you found a workaround.
10. Whether it happens every time or only sometimes.

Save screenshots in a folder called "Test Results - [Date]" and name each file after the test (e.g., "Confirming intent - error.png").

---

## A NOTE ON WHAT THIS TEST PACK IS FOR

This platform handles trade compliance, commercial intent records, financial credits, audit trails, and dispute resolution. These are serious things with real consequences.

A platform like this cannot be judged by how it looks. It must be judged by how it behaves - under normal conditions, under pressure, and when things go wrong.

This test pack exists to prove that behaviour. Every test checks a promise the platform makes: that records are accurate, that access is controlled, that money is handled correctly, and that there is always a trail of evidence.

If every test in this pack passes, the platform can be trusted. If critical tests fail - especially around data isolation, credit accuracy, or audit completeness - those failures must be fixed before the platform is shown to clients.

Trust is earned through proof, not polish. This is the proof.

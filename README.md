# Email Response Plotter

Email Response Plotter is a local web application for viewing, searching, analyzing, and replying to emails over IMAP. It supports multiple email accounts, folder selection, sender-frequency analysis, bulk actions, attachments, and email replies.

## Requirements

- Node.js 18 or newer
- An IMAP-enabled email account
- An app password for each account
- IMAP access enabled by the email provider

Gmail accounts are recommended because the application is configured for Gmail's IMAP and SMTP services by default.

## Installation

From the project directory:

```powershell
npm install
```

Start the application:

```powershell
npm start
```

Open the application at:

```text
http://localhost:3000
```

To use another port:

```powershell
$env:PORT=4000
npm start
```

Then open `http://localhost:4000`.

## Environment configuration

Create a `.env` file in the project root. Do not commit this file or share its contents.

### Email account list

Configure all accounts in one JSON environment variable named `EMAIL_ACCOUNTS`.
Each entry is:

```text
[email, app-password, server]
```

The server value is optional and defaults to Gmail:

```dotenv
EMAIL_ACCOUNTS='[["first-account@gmail.com","first-app-password"],["second-account@gmail.com","second-app-password","gmail"],["third@example.com","third-app-password","imap.example.com"]]'
```

Use single quotes around the complete JSON value in `.env`. The application
assigns account IDs in list order (`1`, `2`, `3`, ...). The account selector in
the top-right displays these accounts, and you can switch accounts without
restarting the server.

The old `EMAIL`, `EMAIL1`, `APP_PASSWORD`, and `APP_PASSWORD1` variables are no
longer supported. Remove them after migrating to `EMAIL_ACCOUNTS`.

### IMAP and port options

Gmail is the default when the third value is omitted or set to `gmail`:

```dotenv
EMAIL_ACCOUNTS='[["user@gmail.com","app-password","gmail"]]'
PORT=3000
```

For another provider, set its IMAP host as the third value:

```dotenv
EMAIL_ACCOUNTS='[["user@example.com","app-password","imap.example.com"]]'
PORT=3000
```

The application uses secure IMAP on port `993`. Email sending currently uses
Gmail's Nodemailer service configuration.

### App-password formatting

App passwords are normally shown in groups of characters. Either format is accepted:

```text
EMAIL_ACCOUNTS='[["user@gmail.com","abcd efgh ijkl mnop","gmail"]]'
```

```text
EMAIL_ACCOUNTS='[["user@gmail.com","abcdefghijklmnop","gmail"]]'
```

The application removes whitespace before authenticating. Quoting the value is also supported:

```text
EMAIL_ACCOUNTS='[["user@gmail.com","abcd efgh ijkl mnop","gmail"]]'
```

Do not use the normal account password when two-factor authentication is enabled. Use an app password.

## Creating a Gmail app password

For each Gmail account:

1. Enable two-step verification on the Google account.
2. Open the Google Account security page.
3. Open **App passwords**.
4. Create a password for this application.
5. Copy the generated 16-character password into the matching account entry in
   `EMAIL_ACCOUNTS`.
6. Save `.env`.
7. Restart the application.

If Google does not show the **App passwords** option, the account may be managed by an organization, may not have two-step verification enabled, or may use a security policy that disallows app passwords.

## Security

Never put real email passwords or app passwords in:

- `README.md`
- source files
- screenshots
- chat messages
- Git commits
- public repositories

Keep credentials only in the local `.env` file. If an app password has been exposed, revoke it immediately in Google Account security and create a replacement.

The application uses app passwords rather than storing passwords in the browser. Account credentials remain on the server and are used for IMAP and SMTP operations.

## Main features

### Email folders

The dashboard supports:

- Inbox
- Sent Mail
- Drafts
- Spam
- Trash
- All Mail

Use the folder dropdown to change the active mailbox.

### Email selection from a URL

The `email` query parameter selects an email by its visible position, newest first:

```text
http://localhost:3000/?email=1
```

Examples:

```text
?email=1
```

Opens the newest email.

```text
?email=10
```

Opens the tenth newest email.

The application loads additional pages automatically if the requested email is not in the first page.

### Searching emails

The dashboard search box searches loaded email metadata by:

- Sender address
- Subject
- IMAP UID

When a search query is entered, the application continues loading mailbox pages in the background and updates the results after each page. This allows searches to cover the full selected folder rather than only the initially displayed page.

Search does not currently inspect full message bodies or attachment contents.

### Sender analytics

Open **Sender Analytics** from the sidebar.

The default option analyzes all emails in batches of 10,000:

1. The first 10,000 messages are analyzed.
2. Results are displayed immediately.
3. The next 10,000-message batch starts automatically.
4. Counts are merged by sender across every batch.
5. The table updates until the entire folder is analyzed.

The progress message shows the number of processed emails. You can also choose a one-time analysis of 10,000 emails.

### Bulk email actions

The dashboard supports:

- Selecting individual emails
- Selecting all currently loaded emails
- Selecting the first 100 loaded emails
- Copying selected sender addresses
- Permanently deleting selected emails
- Moving a sender to Spam
- Blocking a sender domain
- Emptying the Trash folder

Deletion and Trash actions are permanent where indicated. Confirm the prompt carefully.

### Reading and replying

Click an email row to open its details drawer. The drawer can display:

- Subject
- Sender
- Recipient
- Date
- HTML content
- Plain-text content
- Attachments

Replies support plain text and one optional attachment. Reply attachments are limited to 10 MB.

## Troubleshooting

### No accounts appear in the account selector

Check that every account has both variables:

```dotenv
EMAIL_ACCOUNTS='[["account@example.com","app-password","gmail"]]'
```

Then restart the server. Environment variables are read when Node.js starts.

### Gmail authentication fails

Check the following:

- Two-step verification is enabled.
- The app password is current.
- The app password belongs to the same account as `EMAILn`.
- There are no accidental line breaks in the value.
- The account allows IMAP access.

Whitespace in app-password values is removed automatically, but the variable name and numeric suffix must be exact.

### IMAP connection timeout

The application uses secure IMAP on port `993`. Check network access and firewall rules. For Gmail, verify that the third account value is `gmail` or omitted:

```text
EMAIL_ACCOUNTS='[["user@gmail.com","app-password","gmail"]]'
```

Restart after changing `.env`.

### The browser shows an old version

Restart the Node.js server and refresh the browser. If necessary, use a hard refresh:

```text
Ctrl+Shift+R
```

### Search is still loading

Full-folder search must fetch mailbox metadata page by page. Large folders can take time and may require multiple IMAP connections. Keep the page open until the progress has finished.

### Analysis stops or fails

Check the server terminal for the specific IMAP error. Large folders are processed in 10,000-message batches, but the provider may still enforce connection, rate, or mailbox limits.

## Project structure

```text
emailresponseplotter/
├── fetchEmails.js          IMAP, email parsing, deletion, and sender analysis
├── server.js               Express server and API routes
├── public/
│   ├── app.js              Browser application logic
│   ├── index.html          Application markup
│   └── style.css           Application styles
├── blocked-domains.json    Persisted blocked domains
├── blocked-senders.json    Persisted blocked senders
├── package.json            Dependencies and start scripts
└── .env                    Local credentials; never commit
```

## API overview

The server exposes these main endpoints:

```text
GET    /api/accounts
POST   /api/accounts/select
GET    /api/emails
GET    /api/emails/:uid
GET    /api/emails/:uid/attachments/:index
POST   /api/emails/:uid/reply
DELETE /api/emails/:uid
DELETE /api/emails/bulk
GET    /api/senders
POST   /api/spam-sender
POST   /api/spam-domain
DELETE /api/trash
```

Sender analysis supports pagination by batch:

```text
/api/senders?folder=INBOX&limit=10000&offset=0
/api/senders?folder=INBOX&limit=10000&offset=10000
```

The server caps a sender-analysis request at 10,000 emails. The frontend requests subsequent offsets automatically for full-folder analysis.

## Development

Start the development server:

```powershell
npm run dev
```

Check one account's IMAP credentials without starting the web server:

```powershell
node .\check-credentials.js user@gmail.com "app-password"
```

The third argument is optional. It defaults to Gmail:

```powershell
node .\check-credentials.js user@example.com "app-password" imap.example.com
```

You can also use the npm script:

```powershell
npm run check-credentials -- user@gmail.com "app-password"
```

Exit codes:

- `0`: credentials were accepted by the IMAP server
- `1`: connection or authentication failed
- `2`: required arguments were omitted

The command removes spaces from app-password values, so both `"abcd efgh ijkl mnop"` and `"abcdefghijklmnop"` work. Avoid sharing the command because the password appears in the terminal command history.

Validate JavaScript syntax:

```powershell
node --check .\fetchEmails.js
node --check .\server.js
node --check .\public\app.js
```

There is currently no automated test suite configured in `package.json`.

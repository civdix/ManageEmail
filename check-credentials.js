import { ImapFlow } from "imapflow";

const [, , email, password, server = "gmail"] = process.argv;

if (!email || !password) {
  console.error(
    "Usage: node check-credentials.js <email> <app-password> [imap-host|gmail]",
  );
  process.exitCode = 2;
} else {
  const host = server.toLowerCase() === "gmail" ? "imap.gmail.com" : server;
  const client = new ImapFlow({
    host,
    port: 993,
    secure: true,
    disableCompression: true,
    logger: false,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
    auth: {
      user: email,
      pass: password.replace(/\s+/g, ""),
    },
  });

  try {
    await client.connect();
    console.log(`Credentials are valid for ${email} via ${host}`);
  } catch (error) {
    console.error(`Credentials failed for ${email} via ${host}: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (client.usable) {
      await client.logout().catch(() => {});
    }
  }
}

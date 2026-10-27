import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";

// Helper helper to build a configured ImapFlow client
function createImapClient() {
  let host = process.env.EMAILHOST || "imap.gmail.com";
  // Auto-resolve common user configuration error (SMTP instead of IMAP)
  if (host.trim().toLowerCase() === "smtp.gmail.com") {
    host = "imap.gmail.com";
  }
  const client = new ImapFlow({
    host: host,
    port: 993,
    secure: true,
    disableCompression: true,
    logger: false,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
    auth: {
      user: process.env.EMAIL,
      pass: (process.env.APP_PASSWORD || "").replace(/\s+/g, ""),
    },
  });
  client.on("error", (error) => {
    console.error("IMAP connection error:", error.message);
  });
  return client;
}

export async function getLatestEmails(folder = "INBOX", page = 1, limit = 50) {
  const client = createImapClient();

  await client.connect();

  const mailbox = await client.mailboxOpen(folder);

  const totalExists = mailbox.exists;
  const limitVal = parseInt(limit, 10);
  const pageVal = parseInt(page, 10);

  const end = totalExists - (pageVal - 1) * limitVal;
  const start = Math.max(1, end - limitVal + 1);

  const emails = [];

  if (end >= 1) {
    for await (const msg of client.fetch(`${start}:${end}`, {
      uid: true,
      envelope: true,
    })) {
      emails.push({
        uid: msg.uid,
        subject: msg.envelope.subject,
        from:
          msg.envelope.from?.[0]?.address ||
          msg.envelope.from?.[0]?.name ||
          "Unknown",
        date: msg.envelope.date,
      });
    }
  }

  await client.logout();

  return {
    emails: emails.reverse(),
    hasMore: start > 1,
    total: totalExists,
  };
}

export async function getEmailDetails(uid, folder = "INBOX") {
  const client = createImapClient();

  await client.connect();
  await client.mailboxOpen(folder);

  const lock = await client.getMailboxLock(folder);
  let emailDetails = null;

  try {
    const message = await client.fetchOne(
      uid.toString(),
      { source: true },
      { uid: true },
    );
    if (message && message.source) {
      const parsed = await simpleParser(message.source);
      emailDetails = {
        uid: parseInt(uid, 10),
        subject: parsed.subject,
        from:
          parsed.from?.text || parsed.from?.value?.[0]?.address || "Unknown",
        to: parsed.to?.text || parsed.to?.value?.[0]?.address || "",
        replyTo:
          parsed.replyTo?.value?.[0]?.address ||
          parsed.from?.value?.[0]?.address ||
          "",
        messageId: parsed.messageId || "",
        references: parsed.references || [],
        date: parsed.date || message.envelope?.date,
        html: parsed.html,
        text: parsed.text,
        textAsHtml: parsed.textAsHtml,
        attachments: (parsed.attachments || []).map((att, index) => ({
          index,
          filename: att.filename || `attachment-${index}`,
          contentType: att.contentType,
          size: att.size,
        })),
      };
    }
  } finally {
    lock.release();
  }

  await client.logout();

  return emailDetails;
}

export async function getEmailAttachment(
  uid,
  attachmentIndex,
  folder = "INBOX",
) {
  const client = createImapClient();

  await client.connect();
  await client.mailboxOpen(folder);

  const lock = await client.getMailboxLock(folder);
  let attachment = null;

  try {
    const message = await client.fetchOne(
      uid.toString(),
      { source: true },
      { uid: true },
    );
    if (message && message.source) {
      const parsed = await simpleParser(message.source);
      const att = parsed.attachments?.[attachmentIndex];
      if (att) {
        attachment = {
          filename: att.filename || `attachment-${attachmentIndex}`,
          contentType: att.contentType,
          content: att.content, // Buffer
        };
      }
    }
  } finally {
    lock.release();
  }

  await client.logout();

  return attachment;
}

export async function deleteEmail(uid, folder = "INBOX") {
  const client = createImapClient();

  await client.connect();
  await client.mailboxOpen(folder);

  const lock = await client.getMailboxLock(folder);

  try {
    await client.messageDelete(uid.toString(), { uid: true });
  } finally {
    lock.release();
  }

  await client.logout();

  return true;
}

export async function deleteEmails(uids, folder = "INBOX") {
  const client = createImapClient();

  await client.connect();
  await client.mailboxOpen(folder);

  const lock = await client.getMailboxLock(folder);

  try {
    await client.messageDelete(uids, { uid: true });
  } finally {
    lock.release();
  }

  await client.logout();

  return true;
}

export async function emptyTrash(folder = "[Gmail]/Trash") {
  const client = createImapClient();

  await client.connect();
  await client.mailboxOpen(folder);

  const lock = await client.getMailboxLock(folder);

  try {
    await client.messageDelete("1:*", { uid: true });
  } finally {
    lock.release();
  }

  await client.logout();

  return true;
}

export async function moveSenderToSpam(senderEmail) {
  const client = createImapClient();

  await client.connect();
  await client.mailboxOpen("INBOX");

  const lock = await client.getMailboxLock("INBOX");

  try {
    const matchingUids =
      (await client.search({ from: senderEmail }, { uid: true })) || [];

    if (matchingUids.length === 0) {
      return 0;
    }

    const moveResult = await client.messageMove(matchingUids, "[Gmail]/Spam", {
      uid: true,
    });
    if (moveResult === false) {
      throw new Error("Gmail could not move the matching emails to Spam");
    }
    return matchingUids.length;
  } finally {
    lock.release();
    await client.logout();
  }
}

export async function moveDomainToSpam(domain) {
  const client = createImapClient();

  await client.connect();
  await client.mailboxOpen("INBOX");

  const lock = await client.getMailboxLock("INBOX");

  try {
    const matchingUids =
      (await client.search({ from: domain }, { uid: true })) || [];

    if (matchingUids.length === 0) {
      return 0;
    }

    const moveResult = await client.messageMove(matchingUids, "[Gmail]/Spam", {
      uid: true,
    });
    if (moveResult === false) {
      throw new Error("Gmail could not move domain emails to Spam");
    }
    return matchingUids.length;
  } finally {
    lock.release();
    await client.logout();
  }
}

export async function sendEmailReply({
  to,
  subject,
  text,
  inReplyTo,
  references,
  attachment,
}) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL,
      pass: (process.env.APP_PASSWORD || "").replace(/\s+/g, ""),
    },
  });

  return transporter.sendMail({
    from: process.env.EMAIL,
    to,
    subject,
    text,
    inReplyTo,
    references,
    attachments: attachment
      ? [
          {
            filename: attachment.originalname,
            content: attachment.buffer,
            contentType: attachment.mimetype,
          },
        ]
      : [],
  });
}

export async function getSenderFrequency(
  folder = "INBOX",
  limit = 10000,
  offset = 0,
) {
  const client = createImapClient();

  await client.connect();
  const mailbox = await client.mailboxOpen(folder);
  const totalExists = mailbox.exists;

  const limitVal = Math.min(10000, Math.max(1, parseInt(limit, 10) || 10000));
  const offsetVal = Math.max(0, parseInt(offset, 10) || 0);
  const end = totalExists - offsetVal;
  const start = Math.max(1, end - limitVal + 1);

  const sendersMap = new Map();

  if (end >= 1) {
    for await (const msg of client.fetch(`${start}:${end}`, {
      envelope: true,
    })) {
      const from = msg.envelope.from?.[0]?.address || "Unknown";
      const name = msg.envelope.from?.[0]?.name || "";
      const current = sendersMap.get(from) || { count: 0, name: name };
      current.count += 1;
      if (name && !current.name) {
        current.name = name;
      }
      sendersMap.set(from, current);
    }
  }

  await client.logout();

  const sortedSenders = Array.from(sendersMap.entries())
    .map(([email, info]) => ({
      email,
      name: info.name,
      count: info.count,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    senders: sortedSenders,
    total: totalExists,
    processed: Math.min(offsetVal + Math.max(0, end - start + 1), totalExists),
    hasMore: start > 1,
  };
}

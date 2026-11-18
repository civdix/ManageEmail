import dotenv from "dotenv";
dotenv.config({ override: true });
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  deleteEmail,
  deleteEmails,
  emptyTrash,
  getLatestEmails,
  getEmailDetails,
  getEmailAttachment,
  getSenderFrequency,
  moveDomainToSpam,
  moveSenderToSpam,
  sendEmailReply,
} from "./fetchEmails.js";

const app = express();
const PORT = process.env.PORT || 3000;
const uploadReplyAttachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
const sessions = new Map();

function parseCookies(req) {
  const cookies = {};
  for (const pair of String(req.headers.cookie || "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function getSession(req) {
  return sessions.get(parseCookies(req).mailplot_session);
}

function requireSession(req, res, next) {
  if (!getSession(req)) {
    return res.status(401).json({ success: false, error: "Authentication required" });
  }
  next();
}
const blockedSendersPath = new URL("./blocked-senders.json", import.meta.url);
const blockedDomainsPath = new URL("./blocked-domains.json", import.meta.url);
let blockedSenders = [];
let blockedDomains = [];
let blockCheckRunning = false;

async function loadBlockedSenders() {
  try {
    const savedSenders = JSON.parse(await readFile(blockedSendersPath, "utf8"));
    blockedSenders = Array.isArray(savedSenders) ? savedSenders : [];
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Could not load blocked senders:", error);
    }
  }
}

async function saveBlockedSenders() {
  await writeFile(
    blockedSendersPath,
    `${JSON.stringify(blockedSenders, null, 2)}\n`,
    "utf8",
  );
}

async function loadBlockedDomains() {
  try {
    const savedDomains = JSON.parse(await readFile(blockedDomainsPath, "utf8"));
    blockedDomains = Array.isArray(savedDomains) ? savedDomains : [];
  } catch (error) {
    if (error.code !== "ENOENT")
      console.error("Could not load blocked domains:", error);
  }
}

async function saveBlockedDomains() {
  await writeFile(
    blockedDomainsPath,
    `${JSON.stringify(blockedDomains, null, 2)}\n`,
    "utf8",
  );
}

async function enforceBlockedSenders() {
  if (
    blockCheckRunning ||
    (blockedSenders.length === 0 && blockedDomains.length === 0)
  )
    return;
  blockCheckRunning = true;

  try {
    for (const senderEmail of blockedSenders) {
      try {
        await moveSenderToSpam(senderEmail);
      } catch (error) {
        console.error(`Could not enforce block for ${senderEmail}:`, error);
      }
    }
    for (const domain of blockedDomains) {
      try {
        await moveDomainToSpam(domain);
      } catch (error) {
        console.error(`Could not enforce block for ${domain}:`, error);
      }
    }
  } finally {
    blockCheckRunning = false;
  }
}

app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Serve static files from the "public" directory
app.use(express.json());
app.use(express.static("public"));

app.get("/api/session", (req, res) => {
  const session = getSession(req);
  res.json(
    session
      ? { success: true, authenticated: true, email: session.account.email }
      : { success: true, authenticated: false },
  );
});

app.post("/api/login", async (req, res) => {
  const email = String(req.body?.email || "").trim();
  const password = String(req.body?.password || "").trim();
  const server = String(req.body?.server || "").trim() || "gmail";
  if (!email || !password) {
    return res.status(400).json({ success: false, error: "Email and app password are required" });
  }

  const account = {
    email,
    password,
    server: server.toLowerCase() === "gmail" ? "imap.gmail.com" : server,
  };

  try {
    await getLatestEmails("INBOX", 1, 1, account);
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: "Login failed. Check the email, app password, and IMAP server.",
    });
  }

  const sessionId = randomUUID();
  sessions.set(sessionId, { account });
  res.setHeader(
    "Set-Cookie",
    `mailplot_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 8}`,
  );
  res.json({ success: true, email });
});

app.post("/api/logout", requireSession, (req, res) => {
  sessions.delete(parseCookies(req).mailplot_session);
  res.setHeader(
    "Set-Cookie",
    "mailplot_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
  );
  res.json({ success: true });
});

app.use("/api", requireSession);

// API endpoint to fetch the list of emails (paginated)
app.get("/api/emails", async (req, res) => {
  const folder = req.query.folder || "INBOX";
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 50;
  const account = getSession(req).account;
  try {
    const result = await getLatestEmails(folder, page, limit, account);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Email connection failed:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch emails",
    });
  }
});

// API endpoint to fetch details of a specific email by UID
app.get("/api/emails/:uid", async (req, res) => {
  const { uid } = req.params;
  const folder = req.query.folder || "INBOX";
  const account = getSession(req).account;
  try {
    const details = await getEmailDetails(uid, folder, account);
    if (!details) {
      return res.status(404).json({ success: false, error: "Email not found" });
    }
    res.json({ success: true, data: details });
  } catch (error) {
    console.error(`Error fetching email details for UID ${uid}:`, error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch email details",
    });
  }
});

// API endpoint to download / view a specific email attachment
app.get("/api/emails/:uid/attachments/:index", async (req, res) => {
  const { uid, index } = req.params;
  const folder = req.query.folder || "INBOX";
  const account = getSession(req).account;
  try {
    const attachment = await getEmailAttachment(
      uid,
      parseInt(index, 10),
      folder,
      account,
    );
    if (!attachment) {
      return res
        .status(404)
        .json({ success: false, error: "Attachment not found" });
    }
    res.setHeader("Content-Type", attachment.contentType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(attachment.filename)}"`,
    );
    res.send(attachment.content);
  } catch (error) {
    console.error(
      `Error fetching attachment index ${index} for UID ${uid}:`,
      error,
    );
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch attachment",
    });
  }
});

app.post(
  "/api/emails/:uid/reply",
  uploadReplyAttachment.single("attachment"),
  async (req, res) => {
    const { uid } = req.params;
    const to = String(req.body?.to || "").trim();
    const text = String(req.body?.text || "").trim();
    const subject = String(req.body?.subject || "").trim();
    const inReplyTo = String(req.body?.inReplyTo || "").trim();
    const count = Number.parseInt(req.body?.count, 10) || 1;
    let references = [];
    try {
      references = JSON.parse(req.body?.references || "[]");
    } catch {
      references = [];
    }
    if (!Array.isArray(references)) references = [];

    const missingFields = [
      !to && "recipient",
      !subject && "subject",
      !text && "reply text",
    ].filter(Boolean);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `${missingFields.join(", ")} ${missingFields.length === 1 ? "is" : "are"} required`,
      });
    }

    if (count < 1 || count > 100) {
      return res.status(400).json({
        success: false,
        error: "Send count must be between 1 and 100",
      });
    }

    try {
      for (let sendIndex = 0; sendIndex < count; sendIndex += 1) {
        await sendEmailReply({
          to,
          subject,
          text,
          inReplyTo,
          references,
          attachment: req.file,
          account: getSession(req).account,
        });
      }
      res.json({ success: true, sentCount: count });
    } catch (error) {
      console.error(`Error sending reply for email UID ${uid}:`, error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to send reply",
      });
    }
  },
);

app.delete("/api/emails/bulk", async (req, res) => {
  const folder = req.query.folder || "INBOX";
  const account = getSession(req).account;
  const uids = Array.isArray(req.body?.uids)
    ? req.body.uids
        .map((uid) => Number.parseInt(uid, 10))
        .filter(Number.isInteger)
    : [];

  if (uids.length === 0) {
    return res
      .status(400)
      .json({ success: false, error: "No emails selected" });
  }

  try {
    await deleteEmails(uids, folder, account);
    res.json({ success: true, deleted: uids.length });
  } catch (error) {
    console.error("Error deleting selected emails:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to delete selected emails",
    });
  }
});

// API endpoint to delete a specific email by UID
app.delete("/api/emails/:uid", async (req, res) => {
  const { uid } = req.params;
  const folder = req.query.folder || "INBOX";
  const account = getSession(req).account;
  try {
    await deleteEmail(uid, folder, account);
    res.json({ success: true });
  } catch (error) {
    console.error(`Error deleting email UID ${uid}:`, error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to delete email",
    });
  }
});

app.delete("/api/trash", async (req, res) => {
  const folder = "[Gmail]/Trash";
  const account = getSession(req).account;
  try {
    await emptyTrash(folder, account);
    res.json({ success: true });
  } catch (error) {
    console.error(`Error emptying trash folder ${folder}:`, error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to empty trash",
    });
  }
});

app.post("/api/spam-sender", async (req, res) => {
  const account = getSession(req).account;
  const senderEmail = String(req.body?.senderEmail || "")
    .trim()
    .toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    return res.status(400).json({
      success: false,
      error: "Enter a valid sender email address",
    });
  }

  try {
    if (!blockedSenders.includes(senderEmail)) {
      blockedSenders.push(senderEmail);
      await saveBlockedSenders();
    }

    const moved = await moveSenderToSpam(senderEmail, account);
    res.json({ success: true, moved, blocked: true });
  } catch (error) {
    console.error(`Error moving emails from ${senderEmail} to Spam:`, error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to move sender emails to Spam",
    });
  }
});

app.post("/api/spam-domain", async (req, res) => {
  const account = getSession(req).account;
  const domain = String(req.body?.domain || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");

  if (
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      domain,
    )
  ) {
    return res.status(400).json({
      success: false,
      error: "Enter a valid domain such as example.com",
    });
  }

  try {
    if (!blockedDomains.includes(domain)) {
      blockedDomains.push(domain);
      await saveBlockedDomains();
    }
    const moved = await moveDomainToSpam(domain, account);
    res.json({ success: true, moved, blocked: true });
  } catch (error) {
    console.error(`Error moving domain emails from ${domain} to Spam:`, error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to block email domain",
    });
  }
});

await loadBlockedSenders();
await loadBlockedDomains();

// API endpoint to analyze sender frequency in a folder
app.get("/api/senders", async (req, res) => {
  const folder = req.query.folder || "INBOX";
  const limit = Math.min(10000, parseInt(req.query.limit, 10) || 10000);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const account = getSession(req).account;
  try {
    const result = await getSenderFrequency(folder, limit, offset, account);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Error analyzing senders:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to analyze senders",
    });
  }
});

// Start the server
app.listen(PORT);

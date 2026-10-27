import dotenv from "dotenv";
dotenv.config({ override: true });
import express from "express";
import multer from "multer";
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
const configuredAccounts = Object.keys(process.env)
  .filter((key) => /^EMAIL\d*$/.test(key))
  .map((key) => key.replace("EMAIL", ""))
  .filter(
    (suffix) =>
      process.env[`EMAIL${suffix}`] && process.env[`APP_PASSWORD${suffix}`],
  )
  .sort((a, b) => (a === "" ? -1 : b === "" ? 1 : Number(a) - Number(b)))
  .map((suffix) => ({
    id: suffix === "" ? "default" : suffix,
    email: process.env[`EMAIL${suffix}`],
    password: process.env[`APP_PASSWORD${suffix}`],
  }));
let activeAccountId =
  configuredAccounts[configuredAccounts.length - 1]?.id || "default";
let lastConnectedAccountId = null;

function selectAccount(accountId) {
  const account = configuredAccounts.find((item) => item.id === accountId);
  if (!account) return false;
  process.env.EMAIL = account.email;
  process.env.APP_PASSWORD = account.password;
  activeAccountId = account.id;
  return true;
}

selectAccount(activeAccountId);
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

app.get("/api/accounts", (req, res) => {
  res.json({
    success: true,
    activeAccountId,
    accounts: configuredAccounts.map(({ id, email }) => ({ id, email })),
  });
});

app.post("/api/accounts/select", (req, res) => {
  const accountId = String(req.body?.accountId || "");
  if (!selectAccount(accountId)) {
    return res
      .status(404)
      .json({ success: false, error: "Email account not found" });
  }
  res.json({ success: true, activeAccountId });
});

// API endpoint to fetch the list of emails (paginated)
app.get("/api/emails", async (req, res) => {
  const folder = req.query.folder || "INBOX";
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 50;
  try {
    const result = await getLatestEmails(folder, page, limit);
    if (page === 1 && lastConnectedAccountId !== activeAccountId) {
      console.log(`Connected successfully: ${process.env.EMAIL}`);
      lastConnectedAccountId = activeAccountId;
    }
    res.json({ success: true, ...result });
  } catch (error) {
    console.error(`Email connection failed for ${process.env.EMAIL}:`, error);
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
  try {
    const details = await getEmailDetails(uid, folder);
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
  try {
    const attachment = await getEmailAttachment(
      uid,
      parseInt(index, 10),
      folder,
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
    await deleteEmails(uids, folder);
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
  try {
    await deleteEmail(uid, folder);
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
  try {
    await emptyTrash(folder);
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

    const moved = await moveSenderToSpam(senderEmail);
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
    const moved = await moveDomainToSpam(domain);
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
setInterval(enforceBlockedSenders, 60 * 1000);
enforceBlockedSenders();

// API endpoint to analyze sender frequency in a folder
app.get("/api/senders", async (req, res) => {
  const folder = req.query.folder || "INBOX";
  const limit = Math.min(10000, parseInt(req.query.limit, 10) || 10000);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  try {
    const result = await getSenderFrequency(folder, limit, offset);
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

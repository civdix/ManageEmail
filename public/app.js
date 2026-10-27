// Global Application State
let state = {
  emails: [],
  searchQuery: "",
  selectedUid: null,
  currentPage: 1,
  limit: 50,
  hasMore: true,
  isLoadingMore: false,
  folder: "INBOX",
  currentFetchId: 0,
  replyMessageId: "",
  replyReferences: [],
  selectedUids: new Set(),
  accountId: "",
};
let searchLoadTimer = null;
let searchLoadRun = 0;

// DOM Elements
const refreshBtn = document.getElementById("refresh-btn");
const accountSelect = document.getElementById("account-select");
const searchInput = document.getElementById("search-input");
const emailsTbody = document.getElementById("emails-tbody");
const statTotal = document.getElementById("stat-total");
const statLastSync = document.getElementById("stat-last-sync");
const folderSelect = document.getElementById("folder-select");
const limitSelect = document.getElementById("limit-select");
const selectionSelect = document.getElementById("selection-select");
const selectAllCheckbox = document.getElementById("select-all-checkbox");
const deleteSelectedBtn = document.getElementById("delete-selected-btn");
const copySelectedBtn = document.getElementById("copy-selected-btn");
const emptyTrashBtn = document.getElementById("empty-trash-btn");
const spamSenderForm = document.getElementById("spam-sender-form");
const spamSenderInput = document.getElementById("spam-sender-input");
const spamSenderBtn = document.getElementById("spam-sender-btn");
const spamDomainForm = document.getElementById("spam-domain-form");
const spamDomainInput = document.getElementById("spam-domain-input");
const spamDomainBtn = document.getElementById("spam-domain-btn");
const tableTitle = document.getElementById("table-title");
const attachmentsRow = document.getElementById("drawer-attachments-row");
const detailAttachments = document.getElementById("detail-attachments");
const replyForm = document.getElementById("reply-form");
const replyToInput = document.getElementById("reply-to");
const replySubjectInput = document.getElementById("reply-subject");
const replyTextInput = document.getElementById("reply-text");
const replyAttachmentInput = document.getElementById("reply-attachment");
const replyCountInput = document.getElementById("reply-count");
const sendReplyBtn = document.getElementById("send-reply-btn");
const replyStatus = document.getElementById("reply-status");
const requestedEmailParam = new URLSearchParams(window.location.search).get(
  "email",
);
const requestedEmailNumber =
  requestedEmailParam === null ? null : Number(requestedEmailParam);
let urlEmailSelectionAttempted = false;

// Navigation DOM Elements
const navDashboard = document.getElementById("nav-dashboard");
const navSenders = document.getElementById("nav-senders");
const dashboardPage = document.getElementById("dashboard-page");
const sendersPage = document.getElementById("senders-page");
const fetchSendersBtn = document.getElementById("fetch-senders-btn");

// Drawer Elements
const detailDrawer = document.getElementById("detail-drawer");
const drawerOverlay = document.getElementById("drawer-overlay");
const closeDrawerBtn = document.getElementById("close-drawer-btn");
const detailUidBadge = document.getElementById("detail-uid-badge");
const detailSubject = document.getElementById("detail-subject");
const detailFrom = document.getElementById("detail-from");
const detailTo = document.getElementById("detail-to");
const detailDate = document.getElementById("detail-date");
const deleteEmailBtn = document.getElementById("delete-email-btn");
const emailIframe = document.getElementById("email-body-iframe");
const emailTextPre = document.getElementById("email-body-text");
const tabButtons = document.querySelectorAll(".tab-btn");

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  if (folderSelect) {
    state.folder = folderSelect.value;
    const selectedOption =
      folderSelect.options[folderSelect.selectedIndex].text;
    tableTitle.textContent = `${selectedOption} Emails`;
    const syncText = refreshBtn.querySelector("span");
    if (syncText) {
      syncText.textContent = `Sync ${selectedOption}`;
    }
    updateEmptyTrashButton();
  }
  if (limitSelect) {
    state.limit = parseInt(limitSelect.value, 10) || 50;
  }
  setupEventListeners();
  loadAccounts().then(fetchEmails);
});

// Event Listeners Configuration
function setupEventListeners() {
  // Sync / Refresh trigger
  refreshBtn.addEventListener("click", fetchEmails);

  accountSelect.addEventListener("change", switchAccount);

  if (emptyTrashBtn) {
    emptyTrashBtn.addEventListener("click", emptyTrash);
  }

  if (spamSenderForm) {
    spamSenderForm.addEventListener("submit", sendSenderToSpam);
  }
  if (spamDomainForm) {
    spamDomainForm.addEventListener("submit", blockDomain);
  }
  selectionSelect.addEventListener("change", handleSelectionPreset);
  selectAllCheckbox.addEventListener("change", toggleAllLoadedEmails);
  deleteSelectedBtn.addEventListener("click", deleteSelectedEmails);
  copySelectedBtn.addEventListener("click", copySelectedEmails);

  // Live search filter
  searchInput.addEventListener("input", (e) => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    searchLoadRun += 1;
    if (searchLoadTimer) {
      clearTimeout(searchLoadTimer);
      searchLoadTimer = null;
    }
    renderEmails();
    if (state.searchQuery) {
      const runId = searchLoadRun;
      searchLoadTimer = setTimeout(() => {
        loadAllEmailsForSearch(runId);
      }, 250);
    }
  });

  // Folder selection trigger
  folderSelect.addEventListener("change", (e) => {
    state.folder = e.target.value;

    // Update dashboard title dynamically
    const selectedOption =
      folderSelect.options[folderSelect.selectedIndex].text;
    tableTitle.textContent = `${selectedOption} Emails`;

    // Update Sync button label to reflect selected folder
    const syncText = refreshBtn.querySelector("span");
    if (syncText) {
      syncText.textContent = `Sync ${selectedOption}`;
    }

    updateEmptyTrashButton();

    fetchEmails();
  });

  // Limit selection trigger
  if (limitSelect) {
    limitSelect.addEventListener("change", (e) => {
      state.limit = parseInt(e.target.value, 10) || 50;
      fetchEmails();
    });
  }

  // Toggle navigation panels
  if (navDashboard && navSenders) {
    navDashboard.addEventListener("click", (e) => {
      e.preventDefault();
      navDashboard.classList.add("active");
      navSenders.classList.remove("active");

      dashboardPage.style.display = "flex";
      sendersPage.style.display = "none";

      // Restore original top bar header
      const h1 = document.querySelector(".header-title h1");
      const subtitle = document.querySelector(".header-title .subtitle");
      if (h1) h1.textContent = "Email Plotter";
      if (subtitle)
        subtitle.textContent =
          "Monitor and read incoming inbox emails in real-time.";
      if (refreshBtn) refreshBtn.style.display = "inline-flex";

      // If empty, trigger auto sync
      if (state.emails.length === 0) {
        fetchEmails();
      }
    });

    navSenders.addEventListener("click", (e) => {
      e.preventDefault();
      navSenders.classList.add("active");
      navDashboard.classList.remove("active");

      sendersPage.style.display = "flex";
      dashboardPage.style.display = "none";

      // Update top bar title for analytics
      const h1 = document.querySelector(".header-title h1");
      const subtitle = document.querySelector(".header-title .subtitle");
      if (h1) h1.textContent = "Sender Analytics";
      if (subtitle)
        subtitle.textContent =
          "Analyze and rank unique senders in your mailbox.";
      if (refreshBtn) refreshBtn.style.display = "none";

      // Close drawer if it was open
      closeDrawer();
    });
  }

  // Trigger Sender Analytics
  if (fetchSendersBtn) {
    fetchSendersBtn.addEventListener("click", fetchSenders);
  }

  // Close Drawer Actions
  closeDrawerBtn.addEventListener("click", closeDrawer);
  drawerOverlay.addEventListener("click", closeDrawer);
  if (deleteEmailBtn) {
    deleteEmailBtn.addEventListener("click", deleteCurrentEmail);
  }
  if (replyForm) {
    replyForm.addEventListener("submit", sendReply);
  }

  // Escape key closes drawer
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });

  // Infinite Scroll trigger on table wrapper
  const tableWrapper = document.querySelector(".table-wrapper");
  tableWrapper.addEventListener("scroll", () => {
    // Only trigger infinite scroll if dashboard page is active
    if (dashboardPage && dashboardPage.style.display !== "none") {
      const { scrollTop, scrollHeight, clientHeight } = tableWrapper;
      // Trigger fetch when user scrolls within 100px of bottom
      if (scrollHeight - scrollTop - clientHeight < 100) {
        fetchNextPage();
      }
    }
  });

  // Tab Switching inside Details Drawer
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");

      // Toggle active state on buttons
      tabButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Toggle active state on tab bodies
      document.querySelectorAll(".tab-content").forEach((content) => {
        content.classList.remove("active");
      });
      document.getElementById(targetTab).classList.add("active");
    });
  });
}

async function loadAccounts() {
  try {
    const response = await fetch("/api/accounts", { cache: "no-store" });
    const json = await response.json();
    if (!response.ok || !json.success)
      throw new Error(json.error || "Failed to load accounts");

    accountSelect.innerHTML = "";
    json.accounts.forEach((account) => {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = account.email;
      accountSelect.appendChild(option);
    });
    accountSelect.value = json.activeAccountId;
    state.accountId = json.activeAccountId;
  } catch (error) {
    console.error("Error loading email accounts:", error);
  }
}

async function switchAccount() {
  const accountId = accountSelect.value;
  accountSelect.disabled = true;
  try {
    const response = await fetch("/api/accounts/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
      cache: "no-store",
    });
    const json = await response.json();
    if (!response.ok || !json.success)
      throw new Error(json.error || "Failed to switch account");
    state.accountId = accountId;
    closeDrawer();
    await fetchEmails();
  } catch (error) {
    console.error("Error switching email account:", error);
    alert(error.message || "Failed to switch account");
  } finally {
    accountSelect.disabled = false;
  }
}

// Fetch email metadata list from server (Initial sync or refresh)
async function fetchEmails() {
  state.currentPage = 1;
  state.hasMore = true;
  state.isLoadingMore = false;
  state.emails = [];
  state.selectedUids.clear();

  const fetchId = ++state.currentFetchId;

  showTableLoading();
  try {
    const response = await fetch(
      `/api/emails?folder=${encodeURIComponent(state.folder)}&page=1&limit=${state.limit}`,
      {
        cache: "no-store",
      },
    );
    const json = await response.json();

    if (fetchId !== state.currentFetchId) return;

    if (json.success && Array.isArray(json.emails)) {
      state.emails = json.emails;
      state.hasMore = json.hasMore;
      renderEmails();
      updateStats(json.total);
      await selectEmailFromUrl();
      if (state.searchQuery) {
        searchLoadRun += 1;
        loadAllEmailsForSearch(searchLoadRun);
      }
    } else {
      showTableError(json.error || "Failed to load emails");
    }
  } catch (error) {
    if (fetchId !== state.currentFetchId) return;
    console.error("API error fetching emails:", error);
    showTableError("Network error. Make sure Express server is running.");
  }
}

async function loadAllEmailsForSearch(runId) {
  while (runId === searchLoadRun && state.searchQuery && state.hasMore) {
    const loadedPage = state.currentPage;
    const loadedCount = state.emails.length;
    await fetchNextPage();

    if (runId !== searchLoadRun || !state.searchQuery) return;
    renderEmails();

    if (
      state.currentPage === loadedPage &&
      state.emails.length === loadedCount
    ) {
      return;
    }
  }
}

// Fetch next page of emails (Infinite Scroll)
async function fetchNextPage() {
  if (state.isLoadingMore || !state.hasMore) return;

  state.isLoadingMore = true;
  const nextPage = state.currentPage + 1;
  const fetchId = state.currentFetchId;

  // Append loading spinner row at the bottom of the table
  const bottomLoadingRow = document.createElement("tr");
  bottomLoadingRow.className = "table-loading-row-bottom";
  bottomLoadingRow.innerHTML = `
        <td colspan="5">
            <div class="bottom-spinner-container">
                <div class="bottom-spinner"></div>
                <span>Loading more emails...</span>
            </div>
        </td>
    `;
  emailsTbody.appendChild(bottomLoadingRow);

  try {
    const response = await fetch(
      `/api/emails?folder=${encodeURIComponent(state.folder)}&page=${nextPage}&limit=${state.limit}`,
      {
        cache: "no-store",
      },
    );
    const json = await response.json();

    if (fetchId !== state.currentFetchId) return;

    // Remove bottom loading indicator
    bottomLoadingRow.remove();

    if (json.success && Array.isArray(json.emails)) {
      state.currentPage = nextPage;
      state.emails = state.emails.concat(json.emails);
      state.hasMore = json.hasMore;

      // Append only new items to avoid flickering / scroll jumping
      appendNewEmails(json.emails);
      updateStats(json.total);
    } else {
      console.error("Failed to load more emails:", json.error);
    }
  } catch (error) {
    if (fetchId !== state.currentFetchId) return;
    console.error("API error fetching next page:", error);
    if (bottomLoadingRow.parentNode) {
      bottomLoadingRow.remove();
    }
  } finally {
    if (fetchId === state.currentFetchId) {
      state.isLoadingMore = false;
    }
  }
}

async function selectEmailFromUrl() {
  if (urlEmailSelectionAttempted) return;

  if (
    !Number.isInteger(requestedEmailNumber) ||
    requestedEmailNumber < 1
  ) {
    urlEmailSelectionAttempted = true;
    if (window.location.search.includes("email=")) {
      console.warn("The email URL parameter must be a positive whole number.");
    }
    return;
  }

  while (state.emails.length < requestedEmailNumber && state.hasMore) {
    const loadedEmailCount = state.emails.length;
    await fetchNextPage();
    if (state.emails.length === loadedEmailCount) {
      break;
    }
  }

  const email = state.emails[requestedEmailNumber - 1];
  if (!email) {
    urlEmailSelectionAttempted = true;
    console.warn(
      `Email ${requestedEmailNumber} is not available in the selected folder.`,
    );
    return;
  }

  const row = Array.from(emailsTbody.querySelectorAll("tr")).find(
    (candidate) => candidate.dataset.uid === String(email.uid),
  );
  if (row) {
    urlEmailSelectionAttempted = true;
    await openEmailDetails(email.uid, row);
  }
}

// Update Dashboard Statistics Card
function updateStats(totalCount) {
  statTotal.textContent =
    totalCount !== undefined ? totalCount : state.emails.length;
  const now = new Date();
  statLastSync.textContent = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Render list of email items in the table
function renderEmails() {
  emailsTbody.innerHTML = "";

  const filtered = state.emails.filter((email) => {
    const fromMatch = (email.from || "")
      .toLowerCase()
      .includes(state.searchQuery);
    const subjectMatch = (email.subject || "")
      .toLowerCase()
      .includes(state.searchQuery);
    const uidMatch = String(email.uid).includes(state.searchQuery);
    return fromMatch || subjectMatch || uidMatch;
  });

  if (filtered.length === 0) {
    showTableEmpty();
    return;
  }

  appendNewEmails(filtered);
}

// Append new email list rows to table body
function appendNewEmails(emailList) {
  emailList.forEach((email) => {
    const tr = document.createElement("tr");
    tr.setAttribute("data-uid", email.uid);

    // Check if currently active selected row
    if (state.selectedUid === email.uid) {
      tr.classList.add("active-row");
    }

    tr.innerHTML = `
          <td class="td-checkbox"><input class="email-select-checkbox" type="checkbox" data-uid="${email.uid}" aria-label="Select email ${email.uid}" ${state.selectedUids.has(email.uid) ? "checked" : ""}></td>
            <td class="td-uid">#${email.uid}</td>
            <td class="td-from" title="${escapeHtml(email.from)}">${escapeHtml(email.from)}</td>
            <td class="td-subject" title="${escapeHtml(email.subject || "(No Subject)")}">
                ${escapeHtml(email.subject || "(No Subject)")}
            </td>
            <td class="td-date">${formatDate(email.date)}</td>
        `;

    tr.addEventListener("click", () => openEmailDetails(email.uid, tr));
    const checkbox = tr.querySelector(".email-select-checkbox");
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedUids.add(email.uid);
      else state.selectedUids.delete(email.uid);
      updateSelectionUi();
    });
    emailsTbody.appendChild(tr);
  });
  updateSelectionUi();
}

async function handleSelectionPreset() {
  const selection = selectionSelect.value;
  if (selection === "clear") {
    state.selectedUids.clear();
  } else if (selection === "all") {
    state.emails.forEach((email) => state.selectedUids.add(email.uid));
  } else if (selection === "first100") {
    while (state.emails.length < 100 && state.hasMore) {
      await fetchNextPage();
    }
    state.emails
      .slice(0, 100)
      .forEach((email) => state.selectedUids.add(email.uid));
  }

  selectionSelect.value = "";
  renderEmails();
  updateSelectionUi();
}

function toggleAllLoadedEmails() {
  if (selectAllCheckbox.checked) {
    state.emails.forEach((email) => state.selectedUids.add(email.uid));
  } else {
    state.emails.forEach((email) => state.selectedUids.delete(email.uid));
  }
  renderEmails();
  updateSelectionUi();
}

function updateSelectionUi() {
  const selectedCount = state.selectedUids.size;
  deleteSelectedBtn.disabled = selectedCount === 0;
  copySelectedBtn.disabled = selectedCount === 0;
  deleteSelectedBtn.querySelector("span").textContent =
    `Delete Selected (${selectedCount})`;
  const loadedCount = state.emails.length;
  const selectedLoadedCount = state.emails.filter((email) =>
    state.selectedUids.has(email.uid),
  ).length;
  selectAllCheckbox.checked =
    loadedCount > 0 && selectedLoadedCount === loadedCount;
  selectAllCheckbox.indeterminate =
    selectedLoadedCount > 0 && selectedLoadedCount < loadedCount;
}

async function copySelectedEmails() {
  const selectedSenders = state.emails
    .filter((email) => state.selectedUids.has(email.uid))
    .map((email) => email.from)
    .filter(Boolean);
  const uniqueSenders = [...new Set(selectedSenders)];
  if (uniqueSenders.length === 0) return;

  try {
    await navigator.clipboard.writeText(uniqueSenders.join("\n"));
    copySelectedBtn.querySelector("span").textContent = "Copied";
    setTimeout(() => {
      copySelectedBtn.querySelector("span").textContent = "Copy Selected";
    }, 1500);
  } catch (error) {
    console.error("Could not copy selected email addresses:", error);
    alert("Could not copy the selected email addresses.");
  }
}

async function deleteSelectedEmails() {
  const uids = Array.from(state.selectedUids);
  if (uids.length === 0) return;
  if (
    !window.confirm(
      `Permanently delete ${uids.length} selected email${uids.length === 1 ? "" : "s"}?`,
    )
  )
    return;

  deleteSelectedBtn.disabled = true;
  try {
    const response = await fetch(
      `/api/emails/bulk?folder=${encodeURIComponent(state.folder)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uids }),
        cache: "no-store",
      },
    );
    const json = await response.json();
    if (!response.ok || !json.success)
      throw new Error(json.error || "Failed to delete selected emails");
    state.selectedUids.clear();
    await fetchEmails();
  } catch (error) {
    console.error("Error deleting selected emails:", error);
    alert(error.message || "Failed to delete selected emails");
    updateSelectionUi();
  }
}

// Load and display details for a specific email
async function openEmailDetails(uid, rowElement) {
  state.selectedUid = uid;

  // Clear previous highlights and select current row
  document.querySelectorAll("#emails-tbody tr").forEach((tr) => {
    tr.classList.remove("active-row");
  });
  rowElement.classList.add("active-row");

  // Open Drawer & Overlay loading states
  detailDrawer.classList.add("open");
  drawerOverlay.classList.add("active");

  // Populate placeholder info
  detailUidBadge.textContent = `UID: ${uid}`;
  detailSubject.textContent = "Loading Email...";
  detailFrom.textContent = "Loading...";
  detailTo.textContent = "Loading...";
  detailDate.textContent = "Loading...";
  replyToInput.value = "";
  replySubjectInput.value = "";
  replyTextInput.value = "";
  replyAttachmentInput.value = "";
  replyCountInput.value = "1";
  replyStatus.textContent = "";
  state.replyMessageId = "";
  state.replyReferences = [];

  // Clear and hide attachments container during load
  if (attachmentsRow) attachmentsRow.style.display = "none";
  if (detailAttachments) detailAttachments.innerHTML = "";

  // Reset iframe and plain text blocks
  writeToIframe(
    "<html><body style='font-family:sans-serif;color:#666;padding:20px;'>Loading content...</body></html>",
  );
  emailTextPre.textContent = "Loading plain text content...";

  // Set default tab back to HTML Format
  tabButtons.forEach((b) => b.classList.remove("active"));
  tabButtons[0].classList.add("active");
  document
    .querySelectorAll(".tab-content")
    .forEach((content) => content.classList.remove("active"));
  document.getElementById("tab-html").classList.add("active");

  try {
    const response = await fetch(
      `/api/emails/${uid}?folder=${encodeURIComponent(state.folder)}`,
      {
        cache: "no-store",
      },
    );
    const json = await response.json();

    if (json.success && json.data) {
      const data = json.data;

      // Double check in case the user clicked another email before loading finished
      if (state.selectedUid !== uid) return;

      detailSubject.textContent = data.subject || "(No Subject)";
      detailFrom.textContent = data.from || "Unknown";
      detailTo.textContent = data.to || "";
      detailDate.textContent = formatDate(data.date);
      replyToInput.value = data.replyTo || "";
      replySubjectInput.value = data.subject
        ? data.subject.toLowerCase().startsWith("re:")
          ? data.subject
          : `Re: ${data.subject}`
        : "Re: (No Subject)";
      replyTextInput.value = "";
      state.replyMessageId = data.messageId || "";
      state.replyReferences = data.references || [];

      // Write HTML content into sandboxed Iframe
      let htmlBody = data.html || data.textAsHtml;
      if (!htmlBody && data.text) {
        // Generate a styled text body if only raw text is available
        htmlBody = `
                    <html>
                    <head>
                        <style>
                            body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #1e293b; padding: 24px; margin: 0; }
                            pre { white-space: pre-wrap; font-family: inherit; font-size: 14px; margin: 0; }
                        </style>
                    </head>
                    <body><pre>${escapeHtml(data.text)}</pre></body>
                    </html>
                `;
      } else if (!htmlBody) {
        htmlBody = `<html><body style='font-family:sans-serif;color:#999;padding:20px;text-align:center;'>No message content available.</body></html>`;
      }
      writeToIframe(htmlBody);

      // Set raw text fallback
      emailTextPre.textContent = data.text || "No text content available.";

      // Render Attachments
      if (data.attachments && data.attachments.length > 0) {
        detailAttachments.innerHTML = "";
        data.attachments.forEach((att) => {
          const pill = document.createElement("a");
          pill.className = "attachment-pill";
          pill.href = `/api/emails/${uid}/attachments/${att.index}?folder=${encodeURIComponent(state.folder)}`;
          pill.target = "_blank";

          // Determine FontAwesome icon based on mime type
          let iconClass = "fa-regular fa-file";
          const ct = (att.contentType || "").toLowerCase();
          if (ct.startsWith("image/")) {
            iconClass = "fa-regular fa-file-image";
          } else if (ct.includes("pdf")) {
            iconClass = "fa-regular fa-file-pdf";
          } else if (
            ct.includes("word") ||
            ct.includes("officedocument.wordprocessingml")
          ) {
            iconClass = "fa-regular fa-file-word";
          } else if (
            ct.includes("excel") ||
            ct.includes("officedocument.spreadsheetml")
          ) {
            iconClass = "fa-regular fa-file-excel";
          } else if (
            ct.includes("zip") ||
            ct.includes("rar") ||
            ct.includes("tar") ||
            ct.includes("compressed")
          ) {
            iconClass = "fa-regular fa-file-zipper";
          } else if (ct.includes("text/")) {
            iconClass = "fa-regular fa-file-lines";
          } else if (ct.startsWith("audio/")) {
            iconClass = "fa-regular fa-file-audio";
          } else if (ct.startsWith("video/")) {
            iconClass = "fa-regular fa-file-video";
          }

          const sizeText = formatBytes(att.size);

          pill.innerHTML = `
                        <i class="${iconClass}"></i>
                        <span>${escapeHtml(att.filename)} (${sizeText})</span>
                        <i class="fa-solid fa-download download-icon"></i>
                    `;
          detailAttachments.appendChild(pill);
        });
        if (attachmentsRow) attachmentsRow.style.display = "flex";
      } else {
        if (attachmentsRow) attachmentsRow.style.display = "none";
      }
    } else {
      detailSubject.textContent = "Error loading details";
      writeToIframe(
        `<html><body style='font-family:sans-serif;color:#ef4444;padding:20px;'>Failed to load: ${escapeHtml(json.error)}</body></html>`,
      );
      emailTextPre.textContent = `Error: ${json.error}`;
    }
  } catch (error) {
    console.error("Error fetching email details:", error);
    detailSubject.textContent = "Error loading details";
    writeToIframe(
      `<html><body style='font-family:sans-serif;color:#ef4444;padding:20px;'>Network error. Make sure the server is reachable.</body></html>`,
    );
    emailTextPre.textContent =
      "Network error. Failed to retrieve message body.";
  }
}

async function sendReply(event) {
  event.preventDefault();
  if (state.selectedUid === null) return;

  sendReplyBtn.disabled = true;
  replyStatus.textContent = "Sending...";
  sendReplyBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Sending...</span>`;

  try {
    const formData = new FormData();
    formData.append("to", replyToInput.value);
    formData.append("subject", replySubjectInput.value);
    formData.append("text", replyTextInput.value);
    formData.append("count", replyCountInput.value);
    formData.append("inReplyTo", state.replyMessageId);
    formData.append("references", JSON.stringify(state.replyReferences));
    if (replyAttachmentInput.files[0]) {
      formData.append("attachment", replyAttachmentInput.files[0]);
    }

    const response = await fetch(
      `/api/emails/${state.selectedUid}/reply?folder=${encodeURIComponent(state.folder)}`,
      {
        method: "POST",
        body: formData,
        cache: "no-store",
      },
    );
    const json = await response.json();

    if (!response.ok || !json.success) {
      throw new Error(json.error || "Failed to send reply");
    }

    replyTextInput.value = "";
    replyAttachmentInput.value = "";
    replyStatus.textContent = `${json.sentCount || 1} email${json.sentCount === 1 ? "" : "s"} sent`;
  } catch (error) {
    console.error("Error sending reply:", error);
    replyStatus.textContent = error.message || "Failed to send reply";
  } finally {
    sendReplyBtn.disabled = false;
    sendReplyBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i><span>Send Email</span>`;
  }
}

// Close the side-over drawer panel
function closeDrawer() {
  state.selectedUid = null;
  detailDrawer.classList.remove("open");
  drawerOverlay.classList.remove("active");

  // Remove active highlight from all rows
  document.querySelectorAll("#emails-tbody tr").forEach((tr) => {
    tr.classList.remove("active-row");
  });
}

async function deleteCurrentEmail() {
  if (state.selectedUid === null) return;

  const uid = state.selectedUid;
  const subject = detailSubject.textContent || "this email";
  const confirmed = window.confirm(`Delete ${subject}? This cannot be undone.`);
  if (!confirmed) return;

  if (deleteEmailBtn) {
    deleteEmailBtn.disabled = true;
    deleteEmailBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Deleting</span>`;
  }

  try {
    const response = await fetch(
      `/api/emails/${uid}?folder=${encodeURIComponent(state.folder)}`,
      {
        method: "DELETE",
        cache: "no-store",
      },
    );
    const json = await response.json();

    if (!response.ok || !json.success) {
      throw new Error(json.error || "Failed to delete email");
    }

    state.emails = state.emails.filter((email) => email.uid !== uid);
    closeDrawer();
    renderEmails();
    updateStats(state.emails.length);
    await fetchEmails();
  } catch (error) {
    console.error("Error deleting email:", error);
    alert(error.message || "Failed to delete email");
  } finally {
    if (deleteEmailBtn) {
      deleteEmailBtn.disabled = false;
      deleteEmailBtn.innerHTML = `<i class="fa-solid fa-trash-can"></i><span>Delete</span>`;
    }
  }
}

function updateEmptyTrashButton() {
  if (!emptyTrashBtn) return;
  emptyTrashBtn.disabled = state.folder !== "[Gmail]/Trash";
}

async function emptyTrash() {
  if (state.folder !== "[Gmail]/Trash") return;

  const confirmed = window.confirm(
    "Permanently delete every email in Trash? This cannot be undone.",
  );
  if (!confirmed) return;

  emptyTrashBtn.disabled = true;
  emptyTrashBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Emptying...</span>`;

  try {
    const response = await fetch(
      `/api/trash?folder=${encodeURIComponent(state.folder)}`,
      { method: "DELETE", cache: "no-store" },
    );
    const json = await response.json();

    if (!response.ok || !json.success) {
      throw new Error(json.error || "Failed to empty trash");
    }

    closeDrawer();
    await fetchEmails();
  } catch (error) {
    console.error("Error emptying trash:", error);
    alert(error.message || "Failed to empty trash");
  } finally {
    emptyTrashBtn.innerHTML = `<i class="fa-solid fa-trash-can"></i><span>Empty Trash</span>`;
    updateEmptyTrashButton();
  }
}

async function sendSenderToSpam(event) {
  event.preventDefault();

  const senderEmail = spamSenderInput.value.trim().toLowerCase();
  if (!senderEmail) return;

  const confirmed = window.confirm(
    `Block ${senderEmail}? Current and new emails from this sender will be moved to Spam while the app is running.`,
  );
  if (!confirmed) return;

  spamSenderBtn.disabled = true;
  spamSenderBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Moving...</span>`;

  try {
    const response = await fetch("/api/spam-sender", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderEmail }),
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") || "";
    const json = contentType.includes("application/json")
      ? await response.json()
      : {
          success: false,
          error: `Spam API returned an unexpected response (${response.status}). Restart the server and try again.`,
        };

    if (!response.ok || !json.success) {
      throw new Error(json.error || "Failed to move emails to Spam");
    }

    spamSenderInput.value = "";
    alert(
      json.moved > 0
        ? `Blocked sender and moved ${json.moved} email${json.moved === 1 ? "" : "s"} to Spam.`
        : "Sender blocked. No matching emails were currently in Inbox.",
    );
    await fetchEmails();
  } catch (error) {
    console.error("Error moving sender emails to Spam:", error);
    alert(error.message || "Failed to move emails to Spam");
  } finally {
    spamSenderBtn.disabled = false;
    spamSenderBtn.innerHTML = `<i class="fa-solid fa-ban"></i><span>Block Sender</span>`;
  }
}

async function blockDomain(event) {
  event.preventDefault();
  const domain = spamDomainInput.value.trim().toLowerCase().replace(/^@/, "");
  if (!domain) return;

  if (!window.confirm(`Block all emails from ${domain}?`)) return;

  spamDomainBtn.disabled = true;
  spamDomainBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Blocking...</span>`;

  try {
    const response = await fetch("/api/spam-domain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
      cache: "no-store",
    });
    const json = await response.json();
    if (!response.ok || !json.success) {
      throw new Error(json.error || "Failed to block domain");
    }

    spamDomainInput.value = "";
    alert(
      json.moved > 0
        ? `Domain blocked. Moved ${json.moved} email${json.moved === 1 ? "" : "s"} to Spam.`
        : "Domain blocked. No matching Inbox emails were found.",
    );
    await fetchEmails();
  } catch (error) {
    console.error("Error blocking domain:", error);
    alert(error.message || "Failed to block domain");
  } finally {
    spamDomainBtn.disabled = false;
    spamDomainBtn.innerHTML = `<i class="fa-solid fa-globe"></i><span>Block Domain</span>`;
  }
}

// Write HTML content directly to the iframe
function writeToIframe(htmlContent) {
  const doc = emailIframe.contentDocument || emailIframe.contentWindow.document;
  doc.open();
  doc.write(htmlContent);
  doc.close();
}

// Show a loading indicator spinner inside the table
function showTableLoading() {
  const folderText = folderSelect
    ? folderSelect.options[folderSelect.selectedIndex].text.toLowerCase()
    : "emails";
  emailsTbody.innerHTML = `
        <tr class="table-loading-row">
            <td colspan="5" class="text-center">
                <div class="spinner-container">
                    <div class="spinner"></div>
                    <p>Connecting to IMAP server and retrieving ${folderText}...</p>
                </div>
            </td>
        </tr>
    `;
}

// Show empty state inside table
function showTableEmpty() {
  emailsTbody.innerHTML = `
        <tr>
            <td colspan="5" class="text-center">
                <div class="empty-state">
                    <i class="fa-solid fa-folder-open"></i>
                    <p>No emails found matching your query.</p>
                </div>
            </td>
        </tr>
    `;
}

// Show error state inside table
function showTableError(message) {
  emailsTbody.innerHTML = `
        <tr>
            <td colspan="5" class="text-center">
                <div class="empty-state" style="color: #f87171;">
                    <i class="fa-solid fa-triangle-exclamation" style="color: #ef4444;"></i>
                    <p>${escapeHtml(message)}</p>
                    <button class="btn btn-secondary" onclick="fetchEmails()" style="margin-top: 15px;">Retry Sync</button>
                </div>
            </td>
        </tr>
    `;
}

// Clean date formatting
function formatDate(dateStr) {
  if (!dateStr) return "Unknown Date";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

// Simple HTML escaping helper for security
function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Helper to format byte sizes nicely
function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

// Fetch and render unique senders and their frequencies
let senderAnalysisRun = 0;

function renderSenderResults(sendersTbody, senders, statusText = "") {
  if (senders.length === 0) {
    sendersTbody.innerHTML = `
      <tr class="table-empty-row">
        <td colspan="4" class="text-center">
          <div class="empty-state">
            <i class="fa-solid fa-chart-simple"></i>
            <p>No emails found to analyze in this folder.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  senders.sort((a, b) => b.count - a.count);
  const maxCount = senders[0].count;
  sendersTbody.innerHTML = "";

  if (statusText) {
    const statusRow = document.createElement("tr");
    statusRow.innerHTML = `<td colspan="4" class="text-center">${escapeHtml(statusText)}</td>`;
    sendersTbody.appendChild(statusRow);
  }

  senders.forEach((sender, index) => {
    const rank = index + 1;
    const percent = maxCount > 0 ? Math.round((sender.count / maxCount) * 100) : 0;
    let rankBadgeClass = "rank-badge";
    if (rank === 1) rankBadgeClass += " rank-1";
    else if (rank === 2) rankBadgeClass += " rank-2";
    else if (rank === 3) rankBadgeClass += " rank-3";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="${rankBadgeClass}">${rank}</span></td>
      <td class="td-from" title="${escapeHtml(sender.email)}">${escapeHtml(sender.email)}</td>
      <td class="td-subject" title="${escapeHtml(sender.name || "Unknown")}">${escapeHtml(sender.name || "Unknown")}</td>
      <td>
        <div class="frequency-container">
          <span class="frequency-count">${sender.count} msgs</span>
          <div class="frequency-bar-container" title="${percent}% relative frequency">
            <div class="frequency-bar" style="width: ${percent}%"></div>
          </div>
        </div>
      </td>
    `;
    sendersTbody.appendChild(tr);
  });
}

async function fetchSenders() {
  const sendersTbody = document.getElementById("senders-tbody");
  const folderSelectElem = document.getElementById("senders-folder-select");
  const limitSelectElem = document.getElementById("senders-limit-select");
  const btn = document.getElementById("fetch-senders-btn");

  if (!sendersTbody || !folderSelectElem || !limitSelectElem || !btn) return;

  const folder = folderSelectElem.value;
  const analyzeAll = limitSelectElem.value === "batch";
  const batchSize = 10000;
  const limit = analyzeAll ? batchSize : Number(limitSelectElem.value);
  const runId = ++senderAnalysisRun;
  const senderTotals = new Map();

  // Disable button, show loading spinner inside tbody
  btn.disabled = true;
  const originalBtnText = btn.innerHTML;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Analyzing...</span>`;

  sendersTbody.innerHTML = `
        <tr class="table-loading-row">
            <td colspan="4" class="text-center">
                <div class="spinner-container">
                    <div class="spinner"></div>
                    <p>Scanning "${folder}" in batches of ${batchSize.toLocaleString()} emails...</p>
                </div>
            </td>
        </tr>
    `;

  try {
    let offset = 0;
    let hasMore = true;
    let total = 0;

    while (hasMore && runId === senderAnalysisRun) {
      const response = await fetch(
        `/api/senders?folder=${encodeURIComponent(folder)}&limit=${limit}&offset=${offset}`,
        { cache: "no-store" },
      );
      const json = await response.json();
      if (!response.ok || !json.success || !Array.isArray(json.senders)) {
        throw new Error(json.error || "Failed to analyze senders");
      }

      total = json.total || total;
      json.senders.forEach((sender) => {
        const current = senderTotals.get(sender.email) || {
          email: sender.email,
          name: sender.name,
          count: 0,
        };
        current.count += sender.count;
        if (!current.name && sender.name) current.name = sender.name;
        senderTotals.set(sender.email, current);
      });

      const processed = json.processed || Math.min(offset + limit, total);
      renderSenderResults(
        sendersTbody,
        Array.from(senderTotals.values()),
        analyzeAll
          ? `Analyzed ${processed.toLocaleString()} of ${total.toLocaleString()} emails. Continuing in the background...`
          : `Analyzed ${processed.toLocaleString()} emails.`,
      );
      hasMore = Boolean(json.hasMore);
      offset = processed;
      if (!analyzeAll) break;
    }

    if (runId === senderAnalysisRun && analyzeAll) {
      renderSenderResults(
        sendersTbody,
        Array.from(senderTotals.values()),
        `Analysis complete: ${total.toLocaleString()} emails.`,
      );
    }
  } catch (error) {
    console.error("Error analyzing senders:", error);
    sendersTbody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center">
                    <div class="empty-state" style="color: #f87171;">
                        <i class="fa-solid fa-triangle-exclamation" style="color: #ef4444;"></i>
                        <p>Failed to analyze senders: ${escapeHtml(error.message)}</p>
                        <button class="btn btn-secondary" onclick="fetchSenders()" style="margin-top: 15px;">Retry Analysis</button>
                    </div>
                </td>
            </tr>
        `;
  } finally {
    if (runId === senderAnalysisRun) {
      btn.disabled = false;
      btn.innerHTML = originalBtnText;
    }
  }
}

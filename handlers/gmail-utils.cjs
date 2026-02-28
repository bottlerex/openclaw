// Gmail Utilities — extracted from tool-wrapper-proxy.cjs Phase 3.1
// Pure functions for Gmail intent processing (no external dependencies)

const KNOWN_SENDERS = {
  104: { address: "104.com.tw", name: "104人力銀行" },
  人力銀行: { address: "104.com.tw", name: "104人力銀行" },
  tailscale: { address: "tailscale.com", name: "Tailscale" },
  razer: { address: "razer.com", name: "Razer" },
  "google alerts": { address: "googlealerts-noreply@google.com", name: "Google Alerts" },
  "google 快訊": { address: "googlealerts-noreply@google.com", name: "Google Alerts" },
  嘖嘖: { address: "zeczec.com", name: "嘖嘖" },
  zeczec: { address: "zeczec.com", name: "嘖嘖" },
  nintendo: { address: "nintendo", name: "Nintendo" },
  任天堂: { address: "nintendo", name: "Nintendo" },
  facebook: { address: "facebookmail.com", name: "Facebook" },
  fb: { address: "facebookmail.com", name: "Facebook" },
  pubu: { address: "pubu.com.tw", name: "Pubu" },
  元大: { address: "yuanta", name: "元大" },
  github: { address: "github.com", name: "GitHub" },
};

function extractSenderFromText(text) {
  const lower = text.toLowerCase();

  for (const [kw, info] of Object.entries(KNOWN_SENDERS)) {
    const kwLower = kw.toLowerCase();
    // Word-boundary match: prevent "not-facebook.com" matching "facebook"
    const escaped = kwLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[\\s,，、])${escaped}(?:[\\s,，、]|$)`, "i");
    if (re.test(lower)) {
      let action = "trash";
      if (lower.includes("標記已讀") || lower.includes("mark read")) {
        action = "read";
      }
      if (lower.includes("封存") || lower.includes("archive")) {
        action = "archive";
      }
      if (lower.includes("星號") || lower.includes("star")) {
        action = "star";
      }
      return { address: info.address, action, name: info.name };
    }
  }

  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) {
    let action = "trash";
    if (lower.includes("標記已讀") || lower.includes("mark read")) {
      action = "read";
    }
    if (lower.includes("封存") || lower.includes("archive")) {
      action = "archive";
    }
    return { address: emailMatch[0], action };
  }

  const domainMatch = text.match(/[\w.-]+\.\w{2,}/);
  if (domainMatch) {
    return { address: domainMatch[0], action: "trash" };
  }

  const afterBlock = text.match(/(?:封鎖|過濾|block|filter)\s+(.+)/i);
  if (afterBlock) {
    return { address: afterBlock[1].trim(), action: "trash" };
  }

  return { address: text, action: "trash" };
}

module.exports = { KNOWN_SENDERS, extractSenderFromText };

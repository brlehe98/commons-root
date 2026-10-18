import { notifyServiceClient } from "@commons-root/gen-client";
import { NotifyKind } from "@commons-root/gen-shared";

// The server also merges bursts; this only avoids a request per keystroke.
const SUGGESTION_REPORT_MS = 60 * 1000;
const lastSuggestionReport = new Map<string, number>();

function send(docId: string, kind: NotifyKind, userIds: string[] = [], accepted = false) {
  notifyServiceClient.reportActivity({ docId, kind, userIds, accepted }).catch((err) => console.warn("reportActivity failed", err));
}

export function reportComment(docId: string, participants: string[], mentions: string[]) {
  send(docId, NotifyKind.COMMENT, participants);
  if (mentions.length) send(docId, NotifyKind.MENTION, mentions);
}

export function reportSuggestionAdded(docId: string) {
  const last = lastSuggestionReport.get(docId) ?? 0;
  if (Date.now() - last < SUGGESTION_REPORT_MS) return;
  lastSuggestionReport.set(docId, Date.now());
  send(docId, NotifyKind.SUGGESTION_ADDED);
}

export function reportSuggestionResolved(docId: string, authors: string[], accepted: boolean) {
  if (authors.length) send(docId, NotifyKind.SUGGESTION_RESOLVED, Array.from(new Set(authors)), accepted);
}

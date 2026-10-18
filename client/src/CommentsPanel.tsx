import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { Check, RotateCcw, Trash2 } from "lucide-react";
import { Member } from "@commons-root/gen-shared";
import { MentionText, MentionTextarea, mentionsIn } from "./Mentions";
import { reportComment } from "./editor/activity";
import "./fields/fields.css";
import type * as Y from "yjs";
import {
  Thread,
  addThread,
  deleteMessage,
  deleteThread,
  readThreads,
  reopenThread,
  reply,
  resolveThread,
  threadRanges,
  threadsAt,
  threadsMap,
} from "./editor/comments";
import { cachedName, colorForUser, loadNames } from "./users";
import { locale, t } from "./i18n";
import { confirmDialog } from "./ui/dialog";

export type Draft = { from: number; to: number; quote: string };

// How long a thread may stay without its words before it is deleted.
const ORPHAN_GRACE_MS = 1500;

type Props = {
  docId: string;
  editor: Editor;
  ydoc: Y.Doc;
  userId: string;
  canComment: boolean;
  canEdit: boolean;
  draft: Draft | null;
  onDraftDone: () => void;
  /** A thread to scroll to, once the panel is shown (a click on its words). */
  reveal?: { id: string; at: number } | null;
};

/** Live list of the comment threads in a document. */
function useThreads(ydoc: Y.Doc): Thread[] {
  const [threads, setThreads] = useState(() => readThreads(ydoc));
  useEffect(() => {
    const map = threadsMap(ydoc);
    const update = () => setThreads(readThreads(ydoc));
    map.observeDeep(update);
    update();
    return () => map.unobserveDeep(update);
  }, [ydoc]);
  return threads;
}

const CommentsPanel: React.FC<Props> = ({ docId, editor, ydoc, userId, canComment, canEdit, draft, onDraftDone, reveal }) => {
  const threads = useThreads(ydoc);
  const [showResolved, setShowResolved] = useState(false);
  const [, setNamesLoaded] = useState(0);
  const cards = useRef(new Map<string, HTMLDivElement>());

  const view = useEditorState({
    editor,
    selector: ({ editor }) => ({
      ranges: threadRanges(editor.state.doc),
      active: threadsAt(editor).at(-1) ?? null,
    }),
    equalityFn: (a, b) => !!b && a.active === b.active && JSON.stringify([...a.ranges]) === JSON.stringify([...b.ranges]),
  });

  const authorIds = useMemo(
    () => threads.flatMap((th) => [th.authorId, ...th.messages.flatMap((m) => [m.authorId, ...(m.mentions ?? [])])]),
    [threads],
  );
  useEffect(() => {
    loadNames(authorIds)
      .then(() => setNamesLoaded((n) => n + 1))
      .catch(() => undefined);
  }, [authorIds.join(",")]);

  useEffect(() => {
    if (view.active) cards.current.get(view.active)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [view.active]);

  // A thread whose words were deleted goes with them. Only threads seen
  // anchored in this session count, and only once they have stayed without
  // their words for a moment: a thread and its highlight can arrive from
  // others in two steps. Editors do it (a commenter may not delete others' threads).
  const anchored = useRef(new Set<string>());
  useEffect(() => {
    view.ranges.forEach((_, id) => anchored.current.add(id));
    if (!canEdit) return;
    const orphans = threads.filter((th) => anchored.current.has(th.id) && !view.ranges.has(th.id)).map((th) => th.id);
    if (!orphans.length) return;
    const timer = window.setTimeout(() => {
      const now = threadRanges(editor.state.doc);
      for (const id of orphans) {
        if (now.has(id)) continue;
        threadsMap(ydoc).delete(id);
        anchored.current.delete(id);
      }
    }, ORPHAN_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [view.ranges, threads, canEdit, editor, ydoc]);

  // After the panel opens, bring the clicked thread to the middle of it.
  useEffect(() => {
    if (!reveal) return;
    const timer = window.setTimeout(() => cards.current.get(reveal.id)?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    return () => window.clearTimeout(timer);
  }, [reveal]);

  // Open threads in reading order; ones whose text was deleted come last.
  const open = threads
    .filter((th) => !th.resolved)
    .sort((a, b) => (view.ranges.get(a.id)?.from ?? Infinity) - (view.ranges.get(b.id)?.from ?? Infinity) || a.createdAt - b.createdAt);
  const resolved = threads.filter((th) => th.resolved).sort((a, b) => b.createdAt - a.createdAt);
  const resolvedIds = new Set(resolved.map((th) => th.id));

  const focusThread = (id: string) => {
    const range = view.ranges.get(id);
    if (!range) return;
    editor.chain().focus().setTextSelection(range.from).scrollIntoView().run();
  };

  return (
    <div className="comments">
      {/* Highlights the thread under the cursor in the text. */}
      {view.active && !resolvedIds.has(view.active) && (
        <style>{`.tiptap span.comment[data-comment="${CSS.escape(view.active)}"] { background: var(--comment-active); }`}</style>
      )}
      {resolvedIds.size > 0 && (
        <style>
          {Array.from(resolvedIds)
            .map((id) => `.tiptap span.comment[data-comment="${CSS.escape(id)}"]`)
            .join(",") + " { background: none; border-bottom: none; }"}
        </style>
      )}
      <h2>{t("comments.title", { count: open.length })}</h2>
      {draft && (
        <Composer
          docId={docId}
          quote={draft.quote}
          placeholder={t("comments.addPlaceholder")}
          submitLabel={t("comments.send")}
          onCancel={onDraftDone}
          onSubmit={(body, mentions) => {
            addThread(editor, ydoc, userId, draft.from, draft.to, body, mentions);
            reportComment(docId, [], mentions);
            onDraftDone();
          }}
        />
      )}
      {!draft && open.length === 0 && (
        <p className="hint">{canComment ? t("comments.start") : t("comments.none")}</p>
      )}
      {open.map((th) => (
        <div
          key={th.id}
          ref={(el) => (el ? cards.current.set(th.id, el) : cards.current.delete(th.id))}
          className={view.active === th.id ? "thread active" : "thread"}
          onClick={() => focusThread(th.id)}
        >
          <blockquote className={view.ranges.has(th.id) ? "" : "detached"} title={view.ranges.has(th.id) ? "" : t("comments.detached")}>
            {th.quote}
          </blockquote>
          {th.messages.map((m) => (
            <div key={m.id} className="message">
              <div className="who">
                <span className="dot" style={{ background: colorForUser(m.authorId) }} /> {cachedName(m.authorId)}
                <span className="when">{formatTime(m.createdAt)}</span>
                {m.authorId === userId && th.messages.length > 1 && m.id !== th.messages[0].id && (
                  <button className="icon small" title={t("comments.deleteReply")} onClick={(e) => (e.stopPropagation(), deleteMessage(ydoc, th.id, m.id))}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div className="body">
                <MentionText body={m.body} names={(m.mentions ?? []).map(cachedName)} />
              </div>
            </div>
          ))}
          <div className="thread-actions" onClick={(e) => e.stopPropagation()}>
            {canComment && (
              <ReplyBox
                docId={docId}
                onSubmit={(body, mentions) => {
                  reply(ydoc, th.id, userId, body, mentions);
                  reportComment(docId, [th.authorId, ...th.messages.map((m) => m.authorId)], mentions);
                }}
              />
            )}
            <div className="row">
              {(canEdit || th.authorId === userId) && (
                <button title={t("comments.resolveTitle")} onClick={() => resolveThread(editor, ydoc, th.id, userId)}>
                  <Check size={14} /> {t("comments.resolve")}
                </button>
              )}
              {(canEdit || th.authorId === userId) && (
                <button
                  className="icon"
                  title={t("comments.deleteThread")}
                  onClick={async () => (await confirmDialog(t("comments.confirmDeleteThread"), { ok: t("common.delete"), danger: true })) && deleteThread(editor, ydoc, th.id)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {resolved.length > 0 && (
        <>
          <button className="link" onClick={() => setShowResolved(!showResolved)}>
            {t(showResolved ? "comments.hideResolved" : "comments.showResolved", { count: resolved.length })}
          </button>
          {showResolved &&
            resolved.map((th) => (
              <div key={th.id} className="thread resolved">
                <blockquote>{th.quote}</blockquote>
                {th.messages.map((m) => (
                  <div key={m.id} className="message">
                    <div className="who">{cachedName(m.authorId)}</div>
                    <div className="body">
                      <MentionText body={m.body} names={(m.mentions ?? []).map(cachedName)} />
                    </div>
                  </div>
                ))}
                <div className="row">
                  <span className="hint">{t("comments.resolvedBy", { name: cachedName(th.resolvedBy) })}</span>
                  {(canEdit || th.authorId === userId) && (
                    <button title={t("comments.reopenTitle")} onClick={() => reopenThread(ydoc, th.id)}>
                      <RotateCcw size={14} /> {t("comments.reopen")}
                    </button>
                  )}
                </div>
              </div>
            ))}
        </>
      )}
    </div>
  );
};

const Composer: React.FC<{
  docId: string;
  quote?: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string, mentions: string[]) => void;
  onCancel?: () => void;
}> = ({ docId, quote, placeholder, submitLabel, onSubmit, onCancel }) => {
  const [body, setBody] = useState("");
  const [picked, setPicked] = useState<Member[]>([]);
  const submit = () => {
    const text = body.trim();
    if (!text) return;
    onSubmit(text, mentionsIn(text, picked));
    setBody("");
    setPicked([]);
  };
  return (
    <div className="thread composer">
      {quote && <blockquote>{quote}</blockquote>}
      <MentionTextarea
        docId={docId}
        autoFocus
        rows={3}
        placeholder={placeholder}
        value={body}
        onChange={setBody}
        onPick={(m) => setPicked((p) => [...p, m])}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
          if (e.key === "Escape") onCancel?.();
        }}
      />
      <div className="row">
        <button className="primary" disabled={!body.trim()} onClick={submit}>
          {submitLabel}
        </button>
        {onCancel && <button onClick={onCancel}>{t("common.cancel")}</button>}
      </div>
    </div>
  );
};

const ReplyBox: React.FC<{ docId: string; onSubmit: (body: string, mentions: string[]) => void }> = ({ docId, onSubmit }) => {
  const [body, setBody] = useState("");
  const [picked, setPicked] = useState<Member[]>([]);
  const submit = () => {
    const text = body.trim();
    if (!text) return;
    onSubmit(text, mentionsIn(text, picked));
    setBody("");
    setPicked([]);
  };
  return (
    <>
      <MentionTextarea
        docId={docId}
        className="reply"
        rows={body ? 2 : 1}
        placeholder={t("comments.replyPlaceholder")}
        value={body}
        onChange={setBody}
        onPick={(m) => setPicked((p) => [...p, m])}
        onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && submit()}
      />
      {body.trim() && (
        <div className="row">
          <button className="primary" onClick={submit} title="Ctrl+Enter">
            {t("comments.reply")}
          </button>
          <button onClick={() => setBody("")}>{t("common.cancel")}</button>
        </div>
      )}
    </>
  );
};

function formatTime(ms: number): string {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(locale(), { month: "short", day: "numeric" });
}

export default CommentsPanel;

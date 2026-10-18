import React, { useEffect, useRef, useState } from "react";
import { notifyServiceClient } from "@commons-root/gen-client";
import { Member } from "@commons-root/gen-shared";

const cache = new Map<string, Promise<Member[]>>();

/** Members who can see the document, for @mentions. */
export function mentionable(docId: string): Promise<Member[]> {
  let list = cache.get(docId);
  if (!list) {
    list = notifyServiceClient.listMentionable({ docId }).then((r) => r.members);
    list.catch(() => cache.delete(docId));
    cache.set(docId, list);
  }
  return list;
}

/** User ids whose "@Nickname" is still in the text. */
export function mentionsIn(body: string, picked: Member[]): string[] {
  return Array.from(new Set(picked.filter((m) => body.includes(`@${m.nickname}`)).map((m) => m.userId)));
}

/** Shows "@Nickname" in bold for the people a message mentions. */
export function MentionText({ body, names }: { body: string; names: string[] }) {
  if (!names.length) return <>{body}</>;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const parts = body.split(new RegExp(`(@(?:${escaped.join("|")}))`, "g"));
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <strong key={i} className="mention">{p}</strong> : p))}
    </>
  );
}

type Props = {
  docId: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (member: Member) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  className?: string;
};

/** A textarea that offers members after "@". */
export function MentionTextarea({ docId, value, onChange, onPick, onKeyDown, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (query !== null && !members.length) mentionable(docId).then(setMembers).catch(() => undefined);
  }, [query, docId, members.length]);

  const matches =
    query === null ? [] : members.filter((m) => m.nickname.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const detect = (text: string, caret: number) => {
    const m = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
    setQuery(m ? m[2] : null);
    setIndex(0);
  };

  const pick = (member: Member) => {
    const el = ref.current!;
    const caret = el.selectionStart;
    const before = value.slice(0, caret).replace(/@([^\s@]*)$/, `@${member.nickname} `);
    const next = before + value.slice(caret);
    onChange(next);
    onPick(member);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  return (
    <span className="mention-box">
      <textarea
        ref={ref}
        value={value}
        {...rest}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onBlur={() => window.setTimeout(() => setQuery(null), 150)}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(matches[index]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setQuery(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
      />
      {matches.length > 0 && (
        <ul className="mention-list">
          {matches.map((m, i) => (
            <li
              key={m.userId}
              className={i === index ? "on" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
            >
              {m.nickname}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

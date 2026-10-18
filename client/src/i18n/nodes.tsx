import React from "react";
import { t } from "./index";

/**
 * `t` for a sentence with markup inside: each `{name}` becomes the matching
 * node (or text), so translators can move it within the sentence. Plural
 * texts take `count`.
 */
export function tNodes(key: Parameters<typeof t>[0], nodes: Record<string, React.ReactNode>, count?: number): React.ReactNode {
  const text = t(key, count === undefined ? undefined : { count });
  return text.split(/(\{\w+\})/).map((part, i) => {
    const name = part.match(/^\{(\w+)\}$/)?.[1];
    return <React.Fragment key={i}>{name && name in nodes ? nodes[name] : part}</React.Fragment>;
  });
}

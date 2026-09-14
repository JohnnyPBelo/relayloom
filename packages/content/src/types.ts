import type { PublicIdentity } from "../../core/src/protocol";
import type { Priority } from "../../transport/src/protocol";

export interface Attachment {
  size?: number;
  name: string;
  mime: string;
  data: string;
}
export interface SiteBlock {
  id: string;
  type: "hero" | "text" | "links" | "callout";
  title: string;
  body: string;
  url?: string;
}
export interface Content {
  type: string;
  text?: string;
  title?: string;
  conversation?: string;
  members?: PublicIdentity[];
  target?: string;
  emoji?: string;
  replyTo?: string;
  attachments?: Attachment[];
  blocks?: SiteBlock[];
  theme?: string;
  value?: boolean;
  priority?: Priority;
  [key: string]: unknown;
}
export interface DisplayObject {
  id: string;
  author: PublicIdentity;
  kind: string;
  created: number;
  expires: number;
  content: Content;
  pinned: boolean;
  readers: string[];
  public: boolean;
  deleted?: boolean;
  editedText?: string;
  route?: unknown;
}

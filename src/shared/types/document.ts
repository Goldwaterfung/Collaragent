// --- DOCUMENT DOMAIN ---

export type BlockType = 'h1' | 'h2' | 'h3' | 'h4' | 'paragraph';

export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  commentIds?: string[];
}

export interface Block {
  id?: string;
  type: BlockType;
  content?: string;
  children?: InlineRun[];
}

export interface Comment {
  id: string;
  author: string;
  content: string;
}

export interface DocumentContent {
  blocks: Block[];
  comments?: Record<string, Comment>;
}

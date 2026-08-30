import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

export const renderMarkdown = (content: string): string => {
  return md.render(content);
};

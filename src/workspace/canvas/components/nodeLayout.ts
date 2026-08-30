export const NODE_HEADER_HEIGHT = 64;
const NODE_HEADER_FONT_SIZE = 26;
const NODE_HEADER_HORIZONTAL_PADDING = 100;
const NODE_HEADER_MIN_WIDTH = 80;
const NODE_HEADER_CHAR_WIDTH = Math.round(NODE_HEADER_FONT_SIZE * 0.5);

export const getHeaderWidthForName = (name: string): number => {
	const text = name?.trim() ?? '';
	const estimatedTextWidth = Math.max(1, text.length) * NODE_HEADER_CHAR_WIDTH;
	const paddedWidth = estimatedTextWidth + NODE_HEADER_HORIZONTAL_PADDING;
	const minWidth = Math.max(NODE_HEADER_MIN_WIDTH, NODE_HEADER_HORIZONTAL_PADDING + NODE_HEADER_CHAR_WIDTH * 3);

	return Math.max(minWidth, paddedWidth);
};

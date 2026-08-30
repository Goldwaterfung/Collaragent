import type { LexicalEditor } from "lexical";

const editorToNodeKeyToBlockId = new WeakMap<LexicalEditor, Map<string, string>>();

function createBlockId(): string {
	const randomUuid = globalThis.crypto?.randomUUID?.();
	if (randomUuid) return randomUuid;
	return `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getRegistry(editor: LexicalEditor): Map<string, string> {
	let registry = editorToNodeKeyToBlockId.get(editor);
	if (!registry) {
		registry = new Map<string, string>();
		editorToNodeKeyToBlockId.set(editor, registry);
	}
	return registry;
}

export function storeBlockId(editor: LexicalEditor, nodeKey: string, blockId: string | undefined): void {
	if (!editor || !nodeKey || !blockId) return;
	getRegistry(editor).set(nodeKey, blockId);
}

export function getStoredBlockId(editor: LexicalEditor, nodeKey: string): string | undefined {
	if (!editor || !nodeKey) return undefined;
	return getRegistry(editor).get(nodeKey);
}

export function getOrCreateStoredBlockId(editor: LexicalEditor, nodeKey: string): string {
	const existing = getStoredBlockId(editor, nodeKey);
	if (existing) return existing;

	const blockId = createBlockId();
	storeBlockId(editor, nodeKey, blockId);
	return blockId;
}

export function transferBlockId(editor: LexicalEditor, oldNodeKey: string, newNodeKey: string): void {
	if (!editor || !oldNodeKey || !newNodeKey) return;
	const blockId = getStoredBlockId(editor, oldNodeKey);
	if (blockId) {
		storeBlockId(editor, newNodeKey, blockId);
		removeStoredBlockId(editor, oldNodeKey);
	}
}

export function removeStoredBlockId(editor: LexicalEditor, nodeKey: string): void {
	if (!editor || !nodeKey) return;
	getRegistry(editor).delete(nodeKey);
}

export function clearRegistry(editor: LexicalEditor): void {
	if (!editor) return;
	getRegistry(editor).clear();
}


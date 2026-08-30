import { useCallback, useEffect, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import { createPortal } from "react-dom";
import {
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_LOW,
	SELECTION_CHANGE_COMMAND,
} from "lexical";
import ToolbarPlugin from "./ToolBarPlugin";


export default function FloatingToolBarPlugin({ pluginType = "default" }: { pluginType?: "default" | "skill" }) {
	const [editor] = useLexicalComposerContext();
	const [isVisible, setIsVisible] = useState(false);
	const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
	const rafIdRef = useRef<number | null>(null);
	const toolbarWrapRef = useRef<HTMLDivElement | null>(null);

	const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

	const getViewportRect = () => {
		if (typeof window === "undefined") {
			return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
		}
		return {
			left: 0,
			top: 0,
			right: window.innerWidth,
			bottom: window.innerHeight,
			width: window.innerWidth,
			height: window.innerHeight,
		};
	};

	const intersectRects = (
		a: { left: number; top: number; right: number; bottom: number },
		b: { left: number; top: number; right: number; bottom: number },
	) => {
		const left = Math.max(a.left, b.left);
		const top = Math.max(a.top, b.top);
		const right = Math.min(a.right, b.right);
		const bottom = Math.min(a.bottom, b.bottom);
		return {
			left,
			top,
			right,
			bottom,
			width: Math.max(0, right - left),
			height: Math.max(0, bottom - top),
		};
	};

	const update = useCallback(() => {
		if (typeof window === "undefined") return;

		if (rafIdRef.current !== null) {
			cancelAnimationFrame(rafIdRef.current);
		}

		rafIdRef.current = window.requestAnimationFrame(() => {
			const root = editor.getRootElement();
			if (!root) {
				setIsVisible(false);
				return;
			}

			let hasNonCollapsedLexicalSelection = false;
			let isBackward = false;
			editor.getEditorState().read(() => {
				const selection = $getSelection();
				hasNonCollapsedLexicalSelection =
					$isRangeSelection(selection) && !selection.isCollapsed();
				if ($isRangeSelection(selection)) {
					isBackward = selection.isBackward();
				}
			});

			if (!hasNonCollapsedLexicalSelection) {
				setIsVisible(false);
				return;
			}

			const nativeSelection = window.getSelection();
			if (!nativeSelection || nativeSelection.rangeCount === 0) {
				setIsVisible(false);
				return;
			}

			const range = nativeSelection.getRangeAt(0);
			const common = range.commonAncestorContainer;
			if (!root.contains(common)) {
				setIsVisible(false);
				return;
			}

			// Anchor to the caret (selection end) so the toolbar tracks the cursor.
			const caretRange = range.cloneRange();
			caretRange.collapse(isBackward);
			const caretRect = caretRange.getBoundingClientRect();
			const fallbackRect = range.getClientRects()[0] ?? range.getBoundingClientRect();
			const clientRect =
				caretRect.width === 0 && caretRect.height === 0 ? fallbackRect : caretRect;

			// Determine bounds for clamping (prefer the visible scroll container).
			const viewport = getViewportRect();
			const scrollViewport =
				(root.closest(".workspace__editor-scroll") as HTMLElement | null) ??
				(root.closest(".workspace-card") as HTMLElement | null) ??
				(root.closest(".ant-card") as HTMLElement | null);
			const boundsRaw = scrollViewport?.getBoundingClientRect() ?? viewport;
			const bounds = intersectRects(
				{ left: boundsRaw.left, top: boundsRaw.top, right: boundsRaw.right, bottom: boundsRaw.bottom },
				viewport,
			);

			// Measure toolbar size (fallback to a reasonable default).
			const measured = toolbarWrapRef.current?.getBoundingClientRect();
			const toolbarWidth = measured?.width ?? 420;
			const toolbarHeight = measured?.height ?? 44;
			const padding = 8;
			const offset = 8;

			// Prefer above the caret, but flip below if it would go out of bounds.
			const preferredTop = clientRect.top - toolbarHeight - offset;
			const flippedTop = clientRect.bottom + offset;
			const topCandidate = preferredTop < bounds.top + padding ? flippedTop : preferredTop;

			// Center horizontally around caret, but clamp within bounds.
			const leftCandidate = clientRect.left - toolbarWidth / 2;
			const clampedLeft = clamp(
				leftCandidate,
				bounds.left + padding,
				bounds.right - toolbarWidth - padding,
			);
			const clampedTop = clamp(
				topCandidate,
				bounds.top + padding,
				bounds.bottom - toolbarHeight - padding,
			);

			setPos({ top: clampedTop, left: clampedLeft });
			setIsVisible(true);
		});
	}, [editor]);

	useEffect(() => {
		return () => {
			if (rafIdRef.current !== null) {
				cancelAnimationFrame(rafIdRef.current);
			}
		};
	}, []);

	useEffect(() => {
		return mergeRegister(
			editor.registerUpdateListener(() => {
				update();
			}),
			editor.registerCommand(
				SELECTION_CHANGE_COMMAND,
				() => {
					update();
					return false;
				},
				COMMAND_PRIORITY_LOW,
			),
		);
	}, [editor, update]);

	useEffect(() => {
		const onScrollOrResize = () => update();
		window.addEventListener("resize", onScrollOrResize);
		window.addEventListener("scroll", onScrollOrResize, true);
		return () => {
			window.removeEventListener("resize", onScrollOrResize);
			window.removeEventListener("scroll", onScrollOrResize, true);
		};
	}, [update]);

	useEffect(() => {
		if (isVisible) {
			update();
		}
	}, [isVisible, update]);

	if (!isVisible) return null;

	// NOTE: Portal to document.body to avoid ancestor `backdrop-filter`/stacking contexts
	// turning `position: fixed` into a non-viewport containing block.
	return createPortal(
		<div
			ref={toolbarWrapRef}
			style={{
				position: "fixed",
				top: pos.top,
				left: pos.left,
				zIndex: 3000,
				pointerEvents: "auto",
			}}
		>
			<ToolbarPlugin pluginType={pluginType} />
		</div>,
		document.body,
	);
}
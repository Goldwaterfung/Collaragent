import type {
    DOMConversionMap,
    DOMConversionOutput,
    DOMExportOutput,
    EditorConfig,
    LexicalNode,
    NodeKey,
    SerializedLexicalNode,
} from "lexical";

import { DecoratorNode } from "lexical";
import { JSX } from "react";

export type SerializedPageBreakNode = SerializedLexicalNode & {
    type: "page-break";
    version: 1;
};

/** The visual React component rendered inside the editor */
function PageBreakComponent(): JSX.Element {
    return (
        <div
            className="editor-page-break"
            contentEditable={false}
            data-lexical-decorator="true"
        >
            <div className="editor-page-break__line" />
        </div>
    );
}


export class PageBreakNode extends DecoratorNode<JSX.Element> {
    static getType(): string {
        return "page-break";
    }

    static clone(node: PageBreakNode): PageBreakNode {
        return new PageBreakNode(node.__key);
    }

    static importJSON(_: SerializedPageBreakNode): PageBreakNode {
        return $createPageBreakNode();
    }

    static importDOM(): DOMConversionMap | null {
        return {
            div: (node: Node) => {
                const el = node as HTMLElement;
                if (el.getAttribute("data-lexical-page-break") !== "true" &&
                    el.style.getPropertyValue("page-break-after") !== "always" &&
                    el.style.breakAfter !== "page") {
                    return null;
                }
                return {
                    conversion: (): DOMConversionOutput => ({
                        node: $createPageBreakNode(),
                    }),
                    priority: 2,
                };
            },
            figure: (node: Node) => {
                const el = node as HTMLElement;
                if (el.getAttribute("data-lexical-page-break") !== "true") return null;
                return {
                    conversion: (): DOMConversionOutput => ({
                        node: $createPageBreakNode(),
                    }),
                    priority: 2,
                };
            },
        };
    }

    constructor(key?: NodeKey) {
        super(key);
    }

    exportJSON(): SerializedPageBreakNode {
        return {
            type: "page-break",
            version: 1,
        };
    }

    createDOM(_config: EditorConfig): HTMLElement {
        const el = document.createElement("figure");
        el.setAttribute("data-lexical-page-break", "true");
        el.style.cssText = "margin: 0; padding: 0; page-break-after: always; break-after: page;";
        return el;
    }

    updateDOM(): boolean {
        // Returning false tells Lexical the DOM never needs to be replaced
        return false;
    }

    exportDOM(): DOMExportOutput {
        const el = document.createElement("div");
        el.className = "page-break";
        el.setAttribute("data-lexical-page-break", "true");
        el.style.cssText = "page-break-after: always;";
        return { element: el };
    }

    decorate(): JSX.Element {
        return <PageBreakComponent />;
    }

    isInline(): boolean {
        return false;
    }

    isKeyboardSelectable(): boolean {
        return true;
    }
}

export function $createPageBreakNode(): PageBreakNode {
    return new PageBreakNode();
}

export function $isPageBreakNode(node: LexicalNode | null | undefined): node is PageBreakNode {
    return node instanceof PageBreakNode;
}

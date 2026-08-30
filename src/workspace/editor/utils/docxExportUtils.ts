import saveAs from "file-saver";
import { convertBlocksToHtml } from "@workspace/editor/schemas/htmlContentConversion";

const MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Higher-level utility to export a persisted instance to DOCX by fetching its content from the API.
 */
export async function exportInstanceToDocx(instanceId: string, name: string, apiPort: number): Promise<void> {
    try {
        // 1. Fetch persisted content (works for ANY instance, not just the active one)
        const res = await fetch(`http://localhost:${apiPort}/api/instances/${instanceId}`);
        if (!res.ok) throw new Error(`Failed to fetch instance: ${res.status}`);
        const instance = await res.json();

        // 2. Blocks -> HTML (reuses existing converter, no Lexical context needed)
        const blocks = instance.content?.blocks ?? [];
        const bodyHtml = convertBlocksToHtml(blocks);
        
        if (!bodyHtml.trim()) {
            console.warn("DOCX export: empty content");
            return;
        }

        // 3. Generate and save
        await exportHtmlToDocx(bodyHtml, name || "document", "");
    } catch (err) {
        console.error("Failed to export instance to DOCX:", err);
    }
}

/**
 * Lower-level utility to convert HTML string to DOCX and trigger file-saver.
 */
export async function exportHtmlToDocx(bodyHtml: string, title: string, creator: string): Promise<void> {
    const normalizedTitle = title.trim();
    const normalizedCreator = creator.trim();
    const safeFilename = normalizedTitle || "document";

    const docHtml = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body>${bodyHtml}</body></html>`;

    try {
        const { default: HTMLtoDOCX } = await import("html-to-docx");
        const docxData = await HTMLtoDOCX(docHtml, null, {
            title: normalizedTitle,
            creator: normalizedCreator,
        });

        let blob: Blob;
        if (docxData instanceof Blob) {
            blob = docxData;
        } else if (docxData instanceof ArrayBuffer) {
            blob = new Blob([docxData], { type: MIME_TYPE });
        } else if (docxData instanceof Uint8Array) {
            const safeBuffer = docxData.buffer as ArrayBuffer;
            blob = new Blob([safeBuffer], { type: MIME_TYPE });
        } else {
            throw new Error("Unexpected DOCX output type from html-to-docx");
        }

        saveAs(blob, `${safeFilename}.docx`);
    } catch (err) {
        console.error("DOCX export (HTMLtoDOCX) failed:", err);
        throw err;
    }
}

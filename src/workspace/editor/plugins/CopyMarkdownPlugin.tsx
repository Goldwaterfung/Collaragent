import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $convertToMarkdownString, $convertSelectionToMarkdownString } from '@lexical/markdown'
import { $getSelection, $isRangeSelection } from 'lexical'
import { TRANSFORMERS } from '../transformers/markdown'
import { useCallback, JSX } from 'react'

export default function CopyMarkdownPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext()

  const copyMarkdown = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection()
      const markdown =
        $isRangeSelection(selection) && !selection.isCollapsed()
          ? $convertSelectionToMarkdownString(TRANSFORMERS, selection)
          : $convertToMarkdownString(TRANSFORMERS)

      if (!markdown) return

      navigator.clipboard.writeText(markdown).then(
        () => {
          // Optional: Show a toast or feedback
          console.log('Markdown copied to clipboard')
        },
        (err) => {
          console.error('Could not copy markdown: ', err)
        }
      )
    })
  }, [editor])

  return (
    <button
      onClick={copyMarkdown}
      className="toolbar-item spaced"
      aria-label="Copy as Markdown"
      title="Copy as Markdown"
    >
      <i className="format copy" />
    </button>
  )
}

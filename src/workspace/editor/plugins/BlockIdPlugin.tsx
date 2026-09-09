import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot } from 'lexical'
import { getOrCreateStoredBlockId } from '../utils/blockIdentityRegistry'

export default function BlockIdPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot()
        const children = root.getChildren()
        for (const child of children) {
          const key = child.getKey()
          const blockId = getOrCreateStoredBlockId(editor, key)
          const dom = editor.getElementByKey(key)
          if (dom && dom.getAttribute('data-block-id') !== blockId) {
            dom.setAttribute('data-block-id', blockId)
          }
        }
      })
    })
  }, [editor])

  useEffect(() => {
    const handleJumpToBlock = (event: Event) => {
      const customEvent = event as CustomEvent<{ blockId: string }>
      const blockId = customEvent.detail?.blockId
      if (!blockId) return

      const targetElem = document.querySelector(`[data-block-id="${blockId}"]`)
      if (targetElem instanceof HTMLElement) {
        targetElem.scrollIntoView({ behavior: 'smooth', block: 'center' })
        targetElem.classList.add(
          'ring-2',
          'ring-primary-500',
          'rounded',
          'transition-all',
          'duration-500'
        )
        setTimeout(() => {
          targetElem.classList.remove('ring-2', 'ring-primary-500')
        }, 2000)
      }
    }

    window.addEventListener('cagent:jump-to-block', handleJumpToBlock)
    return () => {
      window.removeEventListener('cagent:jump-to-block', handleJumpToBlock)
    }
  }, [])

  return null
}

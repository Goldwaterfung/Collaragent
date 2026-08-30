/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type { JSX } from 'react';

import 'katex/dist/katex.css';

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $wrapNodeInElement } from '@lexical/utils';
import {
    $createParagraphNode,
    $insertNodes,
    $isRootOrShadowRoot,
    COMMAND_PRIORITY_EDITOR,
    $createNodeSelection,
    $setSelection,
} from 'lexical';
import { useEffect } from 'react';

import { $createEquationNode, EquationNode } from '../nodes/EquationNode';

import { INSERT_EQUATION_COMMAND, InsertEquationPayload as CommandPayload } from '../utils/commands';

export default function EquationsPlugin(): JSX.Element | null {
    const [editor] = useLexicalComposerContext();

    useEffect(() => {
        if (!editor.hasNodes([EquationNode])) {
            throw new Error(
                'EquationsPlugins: EquationsNode not registered on editor',
            );
        }

        return editor.registerCommand<CommandPayload>(
            INSERT_EQUATION_COMMAND,
            (payload) => {
                const { equation, inline } = payload;
                const equationNode = $createEquationNode(equation, inline);

                $insertNodes([equationNode]);
                if ($isRootOrShadowRoot(equationNode.getParentOrThrow())) {
                    $wrapNodeInElement(equationNode, $createParagraphNode).selectEnd();
                }

                // Explicitly select the node to trigger the inline editor
                const selection = $createNodeSelection();
                selection.add(equationNode.getKey());
                $setSelection(selection);

                return true;
            },
            COMMAND_PRIORITY_EDITOR,
        );
    }, [editor]);

    return null;
}
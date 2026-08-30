/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type { JSX, Ref, RefObject } from 'react';

import './EquationEditor.css';

import { ChangeEvent, forwardRef } from 'react';

type BaseEquationEditorProps = {
    equation: string;
    inline: boolean;
    setEquation: (equation: string) => void;
    onFinish?: (restoreSelection?: boolean) => void;
};

function EquationEditor(
    { equation, setEquation, inline, onFinish }: BaseEquationEditorProps,
    forwardedRef: Ref<HTMLInputElement | HTMLTextAreaElement>,
): JSX.Element {
    const onChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setEquation(event.target.value);
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (inline && event.key === '$') {
            // Check if it's not escaped
            const input = event.currentTarget as HTMLInputElement;
            const pos = input.selectionStart || 0;
            const before = equation.slice(0, pos);
            if (!before.endsWith('\\')) {
                event.preventDefault();
                onFinish?.(true);
            }
        }
    };

    return inline ? (
        <span className="EquationEditor_inputBackground">
            <span className="EquationEditor_dollarSign">$</span>
            <input
                className="EquationEditor_inlineEditor"
                value={equation}
                onChange={onChange}
                onKeyDown={onKeyDown}
                autoFocus={true}
                ref={forwardedRef as RefObject<HTMLInputElement>}
            />
            <span className="EquationEditor_dollarSign">$</span>
        </span>
    ) : (
        <div className="EquationEditor_inputBackground">
            <span className="EquationEditor_dollarSign">{'$$\n'}</span>
            <textarea
                className="EquationEditor_blockEditor"
                value={equation}
                onChange={onChange}
                onKeyDown={onKeyDown}
                ref={forwardedRef as RefObject<HTMLTextAreaElement>}
            />
            <span className="EquationEditor_dollarSign">{'\n$$'}</span>
        </div>
    );
}

export default forwardRef(EquationEditor);
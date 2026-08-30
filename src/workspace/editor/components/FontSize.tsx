import './FontSize.css';
import { LexicalEditor, $getSelection } from 'lexical';
import { $patchStyleText } from '@lexical/selection';
import * as React from 'react';

export const MIN_ALLOWED_FONT_SIZE = 8;
export const MAX_ALLOWED_FONT_SIZE = 72;
export const DEFAULT_FONT_SIZE = 15;

export enum UpdateFontSizeType {
    increment = 1,
    decrement,
}

export const calculateNextFontSize = (
    currentFontSize: number,
    updateType: UpdateFontSizeType | null,
) => {
    if (!updateType) {
        return currentFontSize;
    }

    let updatedFontSize: number = currentFontSize;
    switch (updateType) {
        case UpdateFontSizeType.decrement:
            switch (true) {
                case currentFontSize > MAX_ALLOWED_FONT_SIZE:
                    updatedFontSize = MAX_ALLOWED_FONT_SIZE;
                    break;
                case currentFontSize >= 48:
                    updatedFontSize -= 12;
                    break;
                case currentFontSize >= 24:
                    updatedFontSize -= 4;
                    break;
                case currentFontSize >= 14:
                    updatedFontSize -= 2;
                    break;
                case currentFontSize >= 9:
                    updatedFontSize -= 1;
                    break;
                default:
                    updatedFontSize = MIN_ALLOWED_FONT_SIZE;
                    break;
            }
            break;

        case UpdateFontSizeType.increment:
            switch (true) {
                case currentFontSize < MIN_ALLOWED_FONT_SIZE:
                    updatedFontSize = MIN_ALLOWED_FONT_SIZE;
                    break;
                case currentFontSize < 12:
                    updatedFontSize += 1;
                    break;
                case currentFontSize < 20:
                    updatedFontSize += 2;
                    break;
                case currentFontSize < 36:
                    updatedFontSize += 4;
                    break;
                case currentFontSize <= 60:
                    updatedFontSize += 12;
                    break;
                default:
                    updatedFontSize = MAX_ALLOWED_FONT_SIZE;
                    break;
            }
            break;

        default:
            break;
    }
    return updatedFontSize;
};

export const updateFontSizeInSelection = (
    editor: LexicalEditor,
    newFontSize: string | null,
    updateType: UpdateFontSizeType | null,
) => {
    const getNextFontSize = (prevFontSize: string | null): string => {
        if (!prevFontSize) {
            prevFontSize = `${DEFAULT_FONT_SIZE}px`;
        }
        prevFontSize = prevFontSize.slice(0, -2);
        const nextFontSize = calculateNextFontSize(
            Number(prevFontSize),
            updateType,
        );
        return `${nextFontSize}px`;
    };

    editor.update(() => {
        if (editor.isEditable()) {
            const selection = $getSelection();
            if (selection !== null) {
                $patchStyleText(selection, {
                    'font-size': newFontSize || getNextFontSize,
                });
            }
        }
    });
};

export const updateFontSize = (
    editor: LexicalEditor,
    updateType: UpdateFontSizeType,
    inputValue: string,
) => {
    if (inputValue !== '') {
        const nextFontSize = calculateNextFontSize(Number(inputValue), updateType);
        updateFontSizeInSelection(
            editor,
            String(nextFontSize) + 'px',
            null,
        );
    } else {
        updateFontSizeInSelection(editor, null, updateType);
    }
};

export function parseFontSizeForToolbar(input: string): string {
    const match = input.match(/^(\d+(?:\.\d+)?)(px|pt)$/);
    if (!match) {
        return '';
    }

    const fontSize = Number(match[1]);
    const unit = match[2];
    const fontSizePx = unit === 'pt' ? Math.round((fontSize * 4) / 3) : fontSize;
    return `${fontSizePx}px`;
}

export default function FontSize({
    selectionFontSize,
    disabled,
    editor,
}: {
    selectionFontSize: string;
    disabled: boolean;
    editor: LexicalEditor;
}) {
    const [inputValue, setInputValue] = React.useState<string>(selectionFontSize);
    const [inputChangeFlag, setInputChangeFlag] = React.useState<boolean>(false);

    const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const inputValueNumber = Number(inputValue);

        if (e.key === 'Tab') {
            return;
        }
        if (['e', 'E', '+', '-'].includes(e.key) || isNaN(inputValueNumber)) {
            e.preventDefault();
            setInputValue('');
            return;
        }
        setInputChangeFlag(true);
        if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            updateFontSizeByInputValue(inputValueNumber);
        }
    };

    const handleInputBlur = () => {
        if (inputValue !== '' && inputChangeFlag) {
            const inputValueNumber = Number(inputValue);
            updateFontSizeByInputValue(inputValueNumber);
        }
    };

    const updateFontSizeByInputValue = (
        inputValueNumber: number,
    ) => {
        let updatedFontSize = inputValueNumber;
        if (inputValueNumber > MAX_ALLOWED_FONT_SIZE) {
            updatedFontSize = MAX_ALLOWED_FONT_SIZE;
        } else if (inputValueNumber < MIN_ALLOWED_FONT_SIZE) {
            updatedFontSize = MIN_ALLOWED_FONT_SIZE;
        }

        setInputValue(String(updatedFontSize));
        updateFontSizeInSelection(
            editor,
            String(updatedFontSize) + 'px',
            null,
        );
        setInputChangeFlag(false);
    };

    React.useEffect(() => {
        setInputValue(selectionFontSize);
    }, [selectionFontSize]);

    return (
        <>
            <button
                type="button"
                disabled={
                    disabled ||
                    (selectionFontSize !== '' &&
                        Number(inputValue) <= MIN_ALLOWED_FONT_SIZE)
                }
                onClick={() => {
                    updateFontSize(
                        editor,
                        UpdateFontSizeType.decrement,
                        inputValue,
                    );
                }}
                className="toolbar-item font-decrement"
                aria-label="Decrease font size"
                title="Decrease font size">
                <i className="format minus-icon" />
            </button>

            <input
                type="number"
                title="Font size"
                value={inputValue}
                disabled={disabled}
                className="toolbar-item font-size-input"
                min={MIN_ALLOWED_FONT_SIZE}
                max={MAX_ALLOWED_FONT_SIZE}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyPress}
                onBlur={handleInputBlur}
            />

            <button
                type="button"
                disabled={
                    disabled ||
                    (selectionFontSize !== '' &&
                        Number(inputValue) >= MAX_ALLOWED_FONT_SIZE)
                }
                onClick={() => {
                    updateFontSize(
                        editor,
                        UpdateFontSizeType.increment,
                        inputValue,
                    );
                }}
                className="toolbar-item font-increment"
                aria-label="Increase font size"
                title="Increase font size">
                <i className="format add-icon" />
            </button>
        </>
    );
}

import CopyMarkdownPlugin from "./CopyMarkdownPlugin";
import { 
  INSERT_COMMENT_COMMAND
} from "../utils/commands";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  ChangeEvent,
  Dispatch,
  JSX,
  RefObject,
  SetStateAction
} from "react";
import {
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  $getSelection,
  $isRangeSelection,
  $getNodeByKey,
  type LexicalEditor,
  type NodeKey
} from "lexical";
import { $isCodeNode } from "@lexical/code";
import { createPortal } from "react-dom";
import { mergeRegister } from "@lexical/utils";
import {
  getDefaultCodeLanguage,
  getCodeLanguages
} from "@lexical/code";
import {
  $getSelectionStyleValueForProperty,
  $patchStyleText,
} from "@lexical/selection";
import DropDown, { DropDownItem } from "@workspace/editor/components/DropDown";
import DropdownColorPicker from "@workspace/editor/components/DropdownColorPicker";
import { BLOCK_TYPE_TO_BLOCK_NAME, SUPPORTED_BLOCK_TYPES, BlockType } from "../utils/editorConfig";
import { setBlockType, setListType, getSelectedBlockType } from "../utils/nodeUtils";

const LowPriority = 1;

type ToolbarPluginProps = {
  pluginType?: "default" | "skill";
};

const FONT_FAMILY_OPTIONS: [string, string][] = [
  ["Arial", "Arial"],
  ["Courier New", "Courier New"],
  ["Georgia", "Georgia"],
  ["Times New Roman", "Times New Roman"],
  ["Trebuchet MS", "Trebuchet MS"],
  ["Verdana", "Verdana"],
];

function dropDownActiveClass(active: boolean) {
  if (active) {
    return "active dropdown-item-active";
  } else {
    return "";
  }
}

function Divider(): JSX.Element {
  return <div className="divider" />;
}

type SelectProps = {
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  className?: string;
  options: ReadonlyArray<string>;
  value: string;
};

function Select({ onChange, className, options, value }: SelectProps): JSX.Element {
  return (
    <select className={className} onChange={onChange} value={value}>
      <option hidden={true} value="" />
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

type BlockOptionsDropdownListProps = {
  editor: LexicalEditor;
  blockType: string;
  toolbarRef: RefObject<HTMLDivElement>;
  setShowBlockOptionsDropDown: Dispatch<SetStateAction<boolean>>;
};

function BlockOptionsDropdownList({
  editor,
  blockType,
  toolbarRef,
  setShowBlockOptionsDropDown
}: BlockOptionsDropdownListProps): JSX.Element {
  const dropDownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    const dropDown = dropDownRef.current;

    if (toolbar !== null && dropDown !== null) {
      const { top, left } = toolbar.getBoundingClientRect();
      dropDown.style.top = `${top + 40}px`;
      dropDown.style.left = `${left + 60}px`;
    }
  }, [toolbarRef]);

  useEffect(() => {
    const dropDown = dropDownRef.current;
    const toolbar = toolbarRef.current;

    if (dropDown === null || toolbar === null) {
      return;
    }
    
    const handle = (event: MouseEvent) => {
      const { target } = event;

      if (!(target instanceof Node)) {
        return;
      }

      if (!dropDown.contains(target) && !toolbar.contains(target)) {
        setShowBlockOptionsDropDown(false);
      }
    };

    document.addEventListener("click", handle);

    return () => {
      document.removeEventListener("click", handle);
    };
  }, [setShowBlockOptionsDropDown, toolbarRef]);

  const formatParagraph = () => {
    setBlockType(editor, blockType, "paragraph");
    setShowBlockOptionsDropDown(false);
  };

  const formatLargeHeading = () => {
    setBlockType(editor, blockType, "h1");
    setShowBlockOptionsDropDown(false);
  };

  const formatSmallHeading = () => {
    setBlockType(editor, blockType, "h2");
    setShowBlockOptionsDropDown(false);
  };

  const formatSubHeading = () => {
    setBlockType(editor, blockType, "h3");
    setShowBlockOptionsDropDown(false);
  };

  const formatH4 = () => {
    setBlockType(editor, blockType, "h4");
    setShowBlockOptionsDropDown(false);
  };

  const formatBulletList = () => {
    setListType(editor, blockType, "ul");
    setShowBlockOptionsDropDown(false);
  };

  const formatNumberedList = () => {
    setListType(editor, blockType, "ol");
    setShowBlockOptionsDropDown(false);
  };

  const formatQuote = () => {
    setBlockType(editor, blockType, "quote");
    setShowBlockOptionsDropDown(false);
  };

  const formatCode = () => {
    setBlockType(editor, blockType, "code");
    setShowBlockOptionsDropDown(false);
  };

  return (
    <div className="dropdown" ref={dropDownRef}>
      <button
        className="item"
        onMouseDown={(e) => e.preventDefault()}
        onClick={formatParagraph}
      >
        <span className="icon paragraph" />
        <span className="text">Normal</span>
        {blockType === "paragraph" && <span className="active" />}
      </button>
      <button
        className="item"
        onMouseDown={(e) => e.preventDefault()}
        onClick={formatLargeHeading}
      >
        <span className="icon h1" />
        <span className="text">Page Title</span>
        {blockType === "h1" && <span className="active" />}
      </button>
      <button
        className="item"
        onMouseDown={(e) => e.preventDefault()}
        onClick={formatSmallHeading}
      >
        <span className="icon h2" />
        <span className="text">Heading</span>
        {blockType === "h2" && <span className="active" />}
      </button>
      <button
        className="item"
        onMouseDown={(e) => e.preventDefault()}
        onClick={formatSubHeading}
      >
        <span className="icon h3" />
        <span className="text">Sub-Heading</span>
        {blockType === "h3" && <span className="active" />}
      </button>
      <button
        className="item"
        onMouseDown={(e) => e.preventDefault()}
        onClick={formatH4}
      >
        <span className="icon h4" />
        <span className="text">H4 Heading</span>
        {blockType === "h4" && <span className="active" />}
      </button>
      <button
        className="item"
        onMouseDown={(e) => e.preventDefault()}
        onClick={formatBulletList}
      >
        <span className="icon bullet-list" />
        <span className="text">Bullet List</span>
        {blockType === "ul" && <span className="active" />}
      </button>
      <button
        className="item"
        onMouseDown={(e) => e.preventDefault()}
        onClick={formatNumberedList}
      >
        <span className="icon numbered-list" />
        <span className="text">Numbered List</span>
        {blockType === "ol" && <span className="active" />}
      </button>
      <button
        className="item"
        onMouseDown={(e) => e.preventDefault()}
        onClick={formatQuote}
      >
        <span className="icon quote" />
        <span className="text">Quote</span>
        {blockType === "quote" && <span className="active" />}
      </button>
      <button
        className="item"
        onMouseDown={(e) => e.preventDefault()}
        onClick={formatCode}
      >
        <span className="icon code" />
        <span className="text">Code Block</span>
        {blockType === "code" && <span className="active" />}
      </button>
    </div>
  );
}

export default function ToolbarPlugin({
  pluginType = "default"
}: ToolbarPluginProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [blockType, setBlockType] = useState<string>("paragraph");
  const [selectedElementKey, setSelectedElementKey] = useState<NodeKey | null>(
    null
  );
  const [showBlockOptionsDropDown, setShowBlockOptionsDropDown] = useState(
    false
  );
  const [codeLanguage, setCodeLanguage] = useState("");
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isLeftAlign, setIsLeftAlign] = useState(true);
  const [isCenterAlign, setIsCenterAlign] = useState(false);
  const [isRightAlign, setIsRightAlign] = useState(false);
  const [isJustifyAlign, setIsJustifyAlign] = useState(false);
  const [fontFamily, setFontFamily] = useState<string>("Arial");
  const [fontColor, setFontColor] = useState<string>("#000");
  const [bgColor, setBgColor] = useState<string>("#fff");

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      const anchorNode = selection.anchor.getNode();
      const element =
        anchorNode.getKey() === "root"
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();
      const elementKey = element.getKey();
      const elementDOM = editor.getElementByKey(elementKey);
      if (elementDOM !== null) {
        setSelectedElementKey(elementKey);
        const type = getSelectedBlockType(selection);
        setBlockType(type);
        if ($isCodeNode(element)) {
          setCodeLanguage(element.getLanguage() ?? getDefaultCodeLanguage());
        }
        // Update text alignment
        const elementFormat = element.getFormat();
        setIsLeftAlign(elementFormat === 0 || elementFormat === 1);
        setIsCenterAlign(elementFormat === 2);
        setIsRightAlign(elementFormat === 3);
        setIsJustifyAlign(elementFormat === 4);
      }
      // Update text format
      setIsBold(selection.hasFormat("bold"));
      setIsItalic(selection.hasFormat("italic"));
      setIsUnderline(selection.hasFormat("underline"));

      setFontColor(
        $getSelectionStyleValueForProperty(selection, "color", "#000")
      );
      setBgColor(
        $getSelectionStyleValueForProperty(selection, "background-color", "#fff")
      );
      setFontFamily(
        $getSelectionStyleValueForProperty(selection, "font-family", "Arial")
      );
    }
  }, [editor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          updateToolbar();
        });
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        (_payload, _newEditor) => {
          updateToolbar();
          return false;
        },
        LowPriority
      ),
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload: boolean) => {
          setCanUndo(payload);
          return false;
        },
        LowPriority
      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (payload: boolean) => {
          setCanRedo(payload);
          return false;
        },
        LowPriority
      )
    );
  }, [editor, updateToolbar]);

  const codeLanguages = useMemo(() => getCodeLanguages(), []);
  const onCodeLanguageSelect = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      editor.update(() => {
        if (selectedElementKey !== null) {
          const node = $getNodeByKey(selectedElementKey);
          if ($isCodeNode(node)) {
            node.setLanguage(event.target.value);
          }
        }
      });
    },
    [editor, selectedElementKey]
  );

  const onFontColorSelect = useCallback(
    (value: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $patchStyleText(selection, { color: value });
        }
      });
    },
    [editor]
  );

  const onBgColorSelect = useCallback(
    (value: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $patchStyleText(selection, { "background-color": value });
        }
      });
    },
    [editor]
  );

  const onFontFamilySelect = useCallback(
    (family: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $patchStyleText(selection, { "font-family": family });
        }
      });
    },
    [editor]
  );

  const blockTypeLabel =
    BLOCK_TYPE_TO_BLOCK_NAME[blockType as BlockType] ?? blockType;
  const isSupportedBlockType = SUPPORTED_BLOCK_TYPES.has(blockType);

  return (
    <div className="toolbar" ref={toolbarRef}>
      <button
        disabled={!canUndo}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          editor.dispatchCommand(UNDO_COMMAND, undefined);
        }}
        className="toolbar-item spaced"
        aria-label="Undo"
      >
        <i className="format undo" />
      </button>
      <button
        disabled={!canRedo}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          editor.dispatchCommand(REDO_COMMAND, undefined);
        }}
        className="toolbar-item"
        aria-label="Redo"
      >
        <i className="format redo" />
      </button>
      {pluginType === "default" && (
        <>
          <CopyMarkdownPlugin />
        </>
      )}
      <Divider />
      {isSupportedBlockType && (
        <>
          <button
            className="toolbar-item block-controls"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              setShowBlockOptionsDropDown((prev) => !prev)
            }
            aria-label="Formatting Options"
          >
            <span className={"icon block-type " + blockType} />
            <span className="text">{blockTypeLabel}</span>
            <i className="chevron-down" />
          </button>
          {showBlockOptionsDropDown &&
            createPortal(
              <BlockOptionsDropdownList
                editor={editor}
                blockType={blockType}
                toolbarRef={toolbarRef as React.RefObject<HTMLDivElement>}
                setShowBlockOptionsDropDown={setShowBlockOptionsDropDown}
              />,
              document.body
            )}
          <Divider />
        </>
      )}
      {blockType === "code" ? (
        <>
          <Select
            className="toolbar-item code-language"
            onChange={onCodeLanguageSelect}
            options={codeLanguages}
            value={codeLanguage}
          />
          <i className="chevron-down inside" />
        </>
      ) : (
        <>
          {pluginType === "default" && (
            <>
              <DropDown
                buttonClassName="toolbar-item font-family"
                buttonLabel={fontFamily}
                buttonIconClassName="icon block-type font-family"
                buttonAriaLabel="Formatting options for font family"
              >
                {FONT_FAMILY_OPTIONS.map(([option, text]) => (
                  <DropDownItem
                    className={`item ${dropDownActiveClass(fontFamily === option)}`}
                    onClick={() => onFontFamilySelect(option)}
                    key={option}
                  >
                    <span className="text">{text}</span>
                  </DropDownItem>
                ))}
              </DropDown>
              <Divider />
            </>
          )}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
            }}
            className={"toolbar-item spaced " + (isBold ? "active" : "")}
            aria-label="Format Bold"
          >
            <i className="format bold" />
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");
            }}
            className={"toolbar-item spaced " + (isItalic ? "active" : "")}
            aria-label="Format Italics"
          >
            <i className="format italic" />
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline");
            }}
            className={"toolbar-item spaced " + (isUnderline ? "active" : "")}
            aria-label="Format Underline"
          >
            <i className="format underline" />
          </button>
          {pluginType === "default" && (
            <>
              <DropdownColorPicker
                buttonClassName="toolbar-item color-picker"
                buttonAriaLabel="Formatting text color"
                buttonIconClassName="icon font-color"
                color={fontColor}
                onChange={onFontColorSelect}
                title="text color"
              />
              <DropdownColorPicker
                buttonClassName="toolbar-item color-picker"
                buttonAriaLabel="Formatting background color"
                buttonIconClassName="icon bg-color"
                color={bgColor}
                onChange={onBgColorSelect}
                title="bg color"
              />
              <Divider />
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "left");
                }}
                className={"toolbar-item spaced " + (isLeftAlign ? "active" : "")}
                aria-label="Format Left Align"
              >
                <i className="format left-align" />
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "center");
                }}
                className={"toolbar-item spaced " + (isCenterAlign ? "active" : "")}
                aria-label="Format Center Align"
              >
                <i className="format center-align" />
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "right");
                }}
                className={"toolbar-item spaced " + (isRightAlign ? "active" : "")}
                aria-label="Format Right Align"
              >
                <i className="format right-align" />
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "justify");
                }}
                className={"toolbar-item " + (isJustifyAlign ? "active" : "")}
                aria-label="Format Justify Align"
              >
                <i className="format justify-align" />
              </button>
              <Divider />
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor.dispatchCommand(INSERT_COMMENT_COMMAND, undefined);
                }}
                className="toolbar-item spaced"
                aria-label="Add Comment"
              >
                <span className="text">Comment</span>
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

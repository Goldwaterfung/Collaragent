import {
  $createEquationNode,
  $isEquationNode,
  EquationNode,
} from "../../nodes/EquationNode";
import { TextMatchTransformer, ElementTransformer } from "@lexical/markdown";

export const EQUATION: TextMatchTransformer = {
  dependencies: [EquationNode],
  export: (node) => {
    if (!$isEquationNode(node)) {
      return null;
    }
    const equation = node.getEquation();
    const inline = node.getInline();
    return inline ? `$${equation}$` : `$$\n${equation}\n$$`;
  },
  importRegExp: /\$([^$]+?)\$/,
  regExp: /\$([^$]+?)\$$/,
  replace: (textNode, match) => {
    const [, equation] = match;
    const equationNode = $createEquationNode(equation, true);
    textNode.replace(equationNode);
  },
  trigger: "$",
  type: "text-match",
};

export const BLOCK_EQUATION: ElementTransformer = {
  dependencies: [EquationNode],
  export: (node) => {
    if (!$isEquationNode(node)) {
      return null;
    }
    const equation = node.getEquation();
    return `$$\n${equation}\n$$`;
  },
  regExp: /^\$\$\s?$/,
  replace: (parentNode) => {
    const equationNode = $createEquationNode("", false);
    parentNode.replace(equationNode);
  },
  type: "element",
};

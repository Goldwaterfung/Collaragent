/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type { JSX } from 'react';

import './ColorPicker.css';

import { MouseEvent, useRef, useState } from 'react';

import { isKeyboardInput } from '../utils/focusUtils';

interface ColorPickerProps {
  color: string;
  onChange?: (
    value: string,
    skipHistoryStack: boolean,
    skipRefocus: boolean,
  ) => void;
}

export function parseAllowedColor(input: string) {
  return /^rgb\(\d+, \d+, \d+\)$/.test(input) ? input : '';
}

const basicColors = [
  '#d0021b',
  '#f5a623',
  '#f8e71c',
  '#8b572a',
  '#7ed321',
  '#417505',
  '#bd10e0',
  '#9013fe',
  '#4a90e2',
  '#50e3c2',
  '#b8e986',
  '#000000',
  '#4a4a4a',
  '#9b9b9b',
  '#ffffff',
];

export default function ColorPicker({
  color,
  onChange,
}: Readonly<ColorPickerProps>): JSX.Element {
  const [selfColor, setSelfColor] = useState(toHex(color));
  const innerDivRef = useRef(null);

  const onBasicColorClick = (e: MouseEvent, basicColor: string) => {
    setSelfColor(basicColor);
    if (onChange) {
      onChange(basicColor, false, isKeyboardInput(e));
    }
  };

  return (
    <div
      className="color-picker-wrapper"
      ref={innerDivRef}>
      <div className="color-picker-basic-color">
        {basicColors.map((basicColor) => (
          <button
            className={basicColor === selfColor ? ' active' : ''}
            key={basicColor}
            style={{ backgroundColor: basicColor }}
            onClick={(e) => onBasicColorClick(e, basicColor)}
          />
        ))}
      </div>
    </div>
  );
}

export function toHex(value: string): string {
  if (!value.startsWith('#')) {
    const ctx = document.createElement('canvas').getContext('2d');

    if (!ctx) {
      throw new Error('2d context not supported or canvas already initialized');
    }

    ctx.fillStyle = value;

    return ctx.fillStyle;
  } else if (value.length === 4 || value.length === 5) {
    value = value
      .split('')
      .map((v, i) => (i ? v + v : '#'))
      .join('');

    return value;
  } else if (value.length === 7 || value.length === 9) {
    return value;
  }

  return '#000000';
}

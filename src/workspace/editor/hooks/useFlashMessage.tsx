/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

export type ShowFlashMessage = (
  message?: React.ReactNode,
  duration?: number,
) => void;

export default function useFlashMessage(): ShowFlashMessage {
  return () => {};
}

// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { KeyboardEvent, MouseEvent, ReactNode, useEffect } from 'react';
import classNames from 'classnames';
import { createPortal } from 'react-dom';
import { onTimeout, removeTimeout } from '../services/timers';
import { useRestoreFocus } from '../hooks/useRestoreFocus';

export type PropsType = {
  autoDismissDisabled?: boolean;
  children: ReactNode;
  className?: string;
  disableCloseOnClick?: boolean;
  onClose: () => unknown;
  timeout?: number;
  toastAction?: {
    label: string;
    onClick: () => unknown;
  };
};

export const Toast = ({
  autoDismissDisabled = false,
  children,
  className,
  disableCloseOnClick = false,
  onClose,
  timeout = 8000,
  toastAction,
}: PropsType): JSX.Element | null => {
  const [root, setRoot] = React.useState<HTMLElement | null>(null);
  const [focusRef] = useRestoreFocus();

  useEffect(() => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    setRoot(div);

    return () => {
      document.body.removeChild(div);
      setRoot(null);
    };
  }, []);

  useEffect(() => {
    if (!root || autoDismissDisabled) {
      return;
    }

    const timeoutId = onTimeout(Date.now() + timeout, onClose);

    return () => {
      if (timeoutId) {
        removeTimeout(timeoutId);
      }
    };
  }, [autoDismissDisabled, onClose, root, timeout]);

  return root
    ? createPortal(
        <div
          aria-live="assertive"
          className={classNames('Toast', className)}
          onClick={() => {
            if (!disableCloseOnClick) {
              onClose();
            }
          }}
          onKeyDown={(ev: KeyboardEvent<HTMLDivElement>) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              if (!disableCloseOnClick) {
                onClose();
              }
            }
          }}
          role="button"
          tabIndex={0}
        >
          <div className="Toast__content">{children}</div>
          {toastAction && (
            <div
              className="Toast__button"
              onClick={(ev: MouseEvent<HTMLDivElement>) => {
                ev.stopPropagation();
                ev.preventDefault();
                toastAction.onClick();
              }}
              onKeyDown={(ev: KeyboardEvent<HTMLDivElement>) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.stopPropagation();
                  ev.preventDefault();
                  toastAction.onClick();
                }
              }}
              ref={focusRef}
              role="button"
              tabIndex={0}
            >
              {toastAction.label}
            </div>
          )}
        </div>,
        root
      )
    : null;
};

// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useRef, useState, ReactElement, ReactNode } from 'react';
import Measure, { ContentRect, MeasuredComponentProps } from 'react-measure';
import classNames from 'classnames';
import { noop } from 'lodash';

import { LocalizerType } from '../types/Util';
import { ModalHost } from './ModalHost';
import { Theme } from '../util/theme';
import { getClassNamesFor } from '../util/getClassNamesFor';
import { useHasWrapped } from '../util/hooks';

type PropsType = {
  children: ReactNode;
  hasStickyButtons?: boolean;
  hasXButton?: boolean;
  i18n: LocalizerType;
  moduleClassName?: string;
  noMouseClose?: boolean;
  onClose?: () => void;
  title?: ReactNode;
  theme?: Theme;
};

const BASE_CLASS_NAME = 'module-Modal';

export function Modal({
  children,
  hasStickyButtons,
  hasXButton,
  i18n,
  moduleClassName,
  noMouseClose,
  onClose = noop,
  title,
  theme,
}: Readonly<PropsType>): ReactElement {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);

  const hasHeader = Boolean(hasXButton || title);
  const getClassName = getClassNamesFor(BASE_CLASS_NAME, moduleClassName);

  function handleResize({ scroll }: ContentRect) {
    const modalNode = modalRef?.current;
    if (!modalNode) {
      return;
    }
    if (scroll) {
      setHasOverflow(scroll.height > modalNode.clientHeight);
    }
  }

  return (
    <ModalHost noMouseClose={noMouseClose} onClose={onClose} theme={theme}>
      <div
        className={classNames(
          getClassName(''),
          getClassName(hasHeader ? '--has-header' : '--no-header'),
          hasStickyButtons && getClassName('--sticky-buttons')
        )}
        ref={modalRef}
      >
        {hasHeader && (
          <div className={getClassName('__header')}>
            {hasXButton && (
              <button
                aria-label={i18n('close')}
                type="button"
                className={getClassName('__close-button')}
                tabIndex={0}
                onClick={() => {
                  onClose();
                }}
              />
            )}
            {title && (
              <h1
                className={classNames(
                  getClassName('__title'),
                  hasXButton ? getClassName('__title--with-x-button') : null
                )}
              >
                {title}
              </h1>
            )}
          </div>
        )}
        <Measure scroll onResize={handleResize}>
          {({ measureRef }: MeasuredComponentProps) => (
            <div
              className={classNames(
                getClassName('__body'),
                scrolled ? getClassName('__body--scrolled') : null,
                hasOverflow || scrolled
                  ? getClassName('__body--overflow')
                  : null
              )}
              onScroll={event => {
                setScrolled((event.target as HTMLDivElement).scrollTop > 2);
              }}
              ref={measureRef}
            >
              {children}
            </div>
          )}
        </Measure>
      </div>
    </ModalHost>
  );
}

Modal.ButtonFooter = function ButtonFooter({
  children,
  moduleClassName,
}: Readonly<{
  children: ReactNode;
  moduleClassName?: string;
}>): ReactElement {
  const [ref, hasWrapped] = useHasWrapped<HTMLDivElement>();

  const className = getClassNamesFor(
    BASE_CLASS_NAME,
    moduleClassName
  )('__button-footer');

  return (
    <div
      className={classNames(
        className,
        hasWrapped ? `${className}--one-button-per-line` : undefined
      )}
      ref={ref}
    >
      {children}
    </div>
  );
};

// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { ReactElement, ReactNode, useRef, useState } from 'react';
import Measure, { ContentRect, MeasuredComponentProps } from 'react-measure';
import classNames from 'classnames';
import { noop } from 'lodash';

import { LocalizerType } from '../types/Util';
import { ModalHost } from './ModalHost';
import { Theme } from '../util/theme';
import { getClassNamesFor } from '../util/getClassNamesFor';
import { useAnimated } from '../hooks/useAnimated';
import { useHasWrapped } from '../hooks/useHasWrapped';
import { useRefMerger } from '../hooks/useRefMerger';

type PropsType = {
  children: ReactNode;
  hasStickyButtons?: boolean;
  hasXButton?: boolean;
  i18n: LocalizerType;
  moduleClassName?: string;
  onClose?: () => void;
  title?: ReactNode;
};

type ModalPropsType = PropsType & {
  noMouseClose?: boolean;
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
}: Readonly<ModalPropsType>): ReactElement {
  const { close, renderAnimation } = useAnimated(
    {
      from: { opacity: 0, transform: 'translateY(48px)' },
      enter: { opacity: 1, transform: 'translateY(0px)' },
      leave: {
        opacity: 0,
        transform: 'translateY(48px)',
      },
      config: {
        duration: 200,
      },
    },
    onClose
  );

  return (
    <ModalHost noMouseClose={noMouseClose} onClose={close} theme={theme}>
      {renderAnimation(
        <ModalWindow
          hasStickyButtons={hasStickyButtons}
          hasXButton={hasXButton}
          i18n={i18n}
          moduleClassName={moduleClassName}
          onClose={close}
          title={title}
        >
          {children}
        </ModalWindow>
      )}
    </ModalHost>
  );
}

export function ModalWindow({
  children,
  hasStickyButtons,
  hasXButton,
  i18n,
  moduleClassName,
  onClose = noop,
  title,
}: Readonly<PropsType>): JSX.Element {
  const modalRef = useRef<HTMLDivElement | null>(null);

  const refMerger = useRefMerger();

  const bodyRef = useRef<HTMLDivElement | null>(null);
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
    <>
      {/* We don't want the click event to propagate to its container node. */}
      {/* eslint-disable-next-line max-len */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        className={classNames(
          getClassName(''),
          getClassName(hasHeader ? '--has-header' : '--no-header'),
          hasStickyButtons && getClassName('--sticky-buttons')
        )}
        ref={modalRef}
        onClick={event => {
          event.stopPropagation();
        }}
      >
        {hasHeader && (
          <div className={getClassName('__header')}>
            {hasXButton && (
              <button
                aria-label={i18n('close')}
                type="button"
                className={getClassName('__close-button')}
                tabIndex={0}
                onClick={onClose}
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
              onScroll={() => {
                const scrollTop = bodyRef.current?.scrollTop || 0;
                setScrolled(scrollTop > 2);
              }}
              ref={refMerger(measureRef, bodyRef)}
            >
              {children}
            </div>
          )}
        </Measure>
      </div>
    </>
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

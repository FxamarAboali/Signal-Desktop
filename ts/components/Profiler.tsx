// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { ReactNode } from 'react';

type InternalPropsType = Readonly<{
  id: string;
  children: ReactNode;

  onRender(
    id: string,
    phase: 'mount' | 'update',
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number,
    interactions: Set<unknown>
  ): void;
}>;

const Fallback: React.FC<InternalPropsType> = ({ children }) => {
  return <>{children}</>;
};

const BaseProfiler: React.FC<InternalPropsType> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (React as any).unstable_Profiler || Fallback;

export type PropsType = Readonly<{
  id: string;
  children: ReactNode;
}>;

const onRender: InternalPropsType['onRender'] = (
  id,
  phase,
  actual,
  base,
  start,
  commit
) => {
  window.log.info(
    `Profiler.tsx(${id}): actual=${actual.toFixed(1)}ms phase=${phase} ` +
      `base=${base.toFixed(1)}ms start=${start.toFixed(1)}ms ` +
      `commit=${commit.toFixed(1)}ms`
  );
};

export const Profiler: React.FC<PropsType> = ({ id, children }) => {
  return (
    <BaseProfiler id={id} onRender={onRender}>
      {children}
    </BaseProfiler>
  );
};

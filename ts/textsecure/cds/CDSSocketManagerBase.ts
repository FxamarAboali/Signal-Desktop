// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { RateLimitedError as NetRateLimitedError } from '@signalapp/libsignal-client';
import {
  Net,
  ErrorCode as LibSignalErrorCode,
  LibSignalErrorBase,
} from '@signalapp/libsignal-client';
import type { connection as WebSocket } from 'websocket';
import pTimeout from 'p-timeout';

import type { AbortableProcess } from '../../util/AbortableProcess';
import * as durations from '../../util/durations';
import { getBasicAuth } from '../../util/getBasicAuth';
import { sleep } from '../../util/sleep';
import { SECOND } from '../../util/durations';
import type { CDSBaseOptionsType } from './CDSBase';
import { CDSBase } from './CDSBase';
import type { CDSSocketBase } from './CDSSocketBase';
import type {
  CDSRequestOptionsType,
  CDSResponseType,
  CDSAuthType,
} from './Types.d';
import { RateLimitedError } from './RateLimitedError';
import { connect as connectWebSocket } from '../WebSocket';
import { Environment, getEnvironment } from '../../environment';

const REQUEST_TIMEOUT = 10 * SECOND;

export type CDSSocketManagerBaseOptionsType = Readonly<{
  url: string;
  certificateAuthority: string;
  version: string;
}> &
  CDSBaseOptionsType;

export abstract class CDSSocketManagerBase<
  Socket extends CDSSocketBase,
  Options extends CDSSocketManagerBaseOptionsType
> extends CDSBase<Options> {
  private retryAfter?: number;

  public async request(
    options: CDSRequestOptionsType
  ): Promise<CDSResponseType> {
    const log = this.logger;

    if (this.retryAfter !== undefined) {
      const delay = Math.max(0, this.retryAfter - Date.now());

      log.info(`CDSSocketManager: waiting ${delay}ms before retrying`);
      await sleep(delay);
    }

    if (options.useLibsignal) {
      return this.requestViaLibsignal(options);
    }
    return this.requestViaNativeSocket(options);
  }

  private async requestViaNativeSocket(
    options: CDSRequestOptionsType
  ): Promise<CDSResponseType> {
    const log = this.logger;
    const auth = await this.getAuth();

    log.info('CDSSocketManager: connecting socket');
    const socket = await this.connect(auth).getResult();
    log.info('CDSSocketManager: connected socket');

    try {
      let { timeout = REQUEST_TIMEOUT } = options;

      // Handshake
      {
        const start = Date.now();
        await pTimeout(socket.handshake(), timeout);
        const duration = Date.now() - start;

        timeout = Math.max(timeout - duration, 0);
      }

      // Send request
      const response = await pTimeout(socket.request(options), timeout);

      return response;
    } catch (error) {
      if (error instanceof RateLimitedError) {
        if (error.retryAfterSecs > 0) {
          this.retryAfter = Math.max(
            this.retryAfter ?? Date.now(),
            Date.now() + error.retryAfterSecs * durations.SECOND
          );
        }
      }
      throw error;
    } finally {
      log.info('CDSSocketManager: closing socket');
      void socket.close(3000, 'Normal');
    }
  }

  private async requestViaLibsignal(
    options: CDSRequestOptionsType
  ): Promise<CDSResponseType> {
    const log = this.logger;
    const {
      acisAndAccessKeys,
      e164s,
      timeout = REQUEST_TIMEOUT,
      returnAcisWithoutUaks = false,
    } = options;
    const auth = await this.getAuth();

    log.info('CDSSocketManager: making request via libsignal');
    const net = new Net.Net(this.libsignalNetEnvironment());
    try {
      log.info('CDSSocketManager: starting lookup request');
      const response = await net.cdsiLookup(auth, {
        acisAndAccessKeys,
        e164s,
        timeout,
        returnAcisWithoutUaks,
      });

      log.info('CDSSocketManager: lookup request finished');
      return response as CDSResponseType;
    } catch (error) {
      if (
        error instanceof LibSignalErrorBase &&
        error.code === LibSignalErrorCode.RateLimitedError
      ) {
        const retryError = error as NetRateLimitedError;
        this.retryAfter = Math.max(
          this.retryAfter ?? Date.now(),
          Date.now() + retryError.retryAfterSecs * durations.SECOND
        );
      }
      throw error;
    }
  }

  private libsignalNetEnvironment(): Net.Environment {
    const env = getEnvironment();
    switch (env) {
      case Environment.Production:
        return Net.Environment.Production;
      case Environment.Development:
      case Environment.Test:
      case Environment.Staging:
      default:
        return Net.Environment.Staging;
    }
  }

  private connect(auth: CDSAuthType): AbortableProcess<Socket> {
    return connectWebSocket<Socket>({
      name: 'CDSSocket',
      url: this.getSocketUrl(),
      version: this.options.version,
      proxyAgent: this.proxyAgent,
      certificateAuthority: this.options.certificateAuthority,
      extraHeaders: {
        authorization: getBasicAuth(auth),
      },

      createResource: (socket: WebSocket): Socket => {
        return this.createSocket(socket);
      },
    });
  }

  protected abstract getSocketUrl(): string;

  protected abstract createSocket(socket: WebSocket): Socket;
}

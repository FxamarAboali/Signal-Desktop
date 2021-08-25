// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable no-restricted-syntax */

import URL from 'url';
import ProxyAgent from 'proxy-agent';
import { RequestInit, Response, Headers } from 'node-fetch';
import { client as WebSocketClient } from 'websocket';
import qs from 'querystring';
import EventListener from 'events';

import { AbortableProcess } from '../util/AbortableProcess';
import { strictAssert } from '../util/assert';
import { explodePromise } from '../util/explodePromise';
import { BackOff, FIBONACCI_TIMEOUTS } from '../util/BackOff';
import { getUserAgent } from '../util/getUserAgent';
import { sleep } from '../util/sleep';
import { SocketStatus } from '../types/SocketStatus';
import * as Errors from '../types/errors';
import * as Bytes from '../Bytes';

import WebSocketResource, {
  WebSocketResourceOptions,
  IncomingWebSocketRequest,
} from './WebsocketResources';
import { ConnectTimeoutError, HTTPError } from './Errors';
import { handleStatusCode, translateError } from './Utils';
import { WebAPICredentials, IRequestHandler } from './Types.d';

// TODO: remove once we move away from ArrayBuffers
const FIXMEU8 = Uint8Array;

const TEN_SECONDS = 1000 * 10;

const FIVE_MINUTES = 5 * 60 * 1000;

export type SocketManagerOptions = Readonly<{
  url: string;
  certificateAuthority: string;
  version: string;
  proxyUrl?: string;
}>;

// This class manages two websocket resource:
//
// - Authenticated WebSocketResource which uses supplied WebAPICredentials and
//   automatically reconnects on closed socket (using back off)
// - Unauthenticated WebSocketResource that is created on demand and reconnected
//   every 5 minutes.
//
// Incoming requests on authenticated resource are funneled into the registered
// request handlers (`registerRequestHandler`) or queued internally until at
// least one such request handler becomes available.
//
// Incoming requests on unauthenticated resource are not currently supported.
// WebSocketResource is responsible for their immediate termination.
export class SocketManager extends EventListener {
  private backOff = new BackOff(FIBONACCI_TIMEOUTS);

  private authenticated?: AbortableProcess<WebSocketResource>;

  private unauthenticated?: AbortableProcess<WebSocketResource>;

  private credentials?: WebAPICredentials;

  private readonly proxyAgent?: ProxyAgent;

  private status = SocketStatus.CLOSED;

  private requestHandlers = new Set<IRequestHandler>();

  private incomingRequestQueue = new Array<IncomingWebSocketRequest>();

  private isOffline = false;

  constructor(private readonly options: SocketManagerOptions) {
    super();

    if (options.proxyUrl) {
      this.proxyAgent = new ProxyAgent(options.proxyUrl);
    }
  }

  public getStatus(): SocketStatus {
    return this.status;
  }

  // Update WebAPICredentials and reconnect authenticated resource if
  // credentials changed
  public async authenticate(credentials: WebAPICredentials): Promise<void> {
    if (this.isOffline) {
      throw new HTTPError('SocketManager offline', {
        code: 0,
        headers: {},
        stack: new Error().stack,
      });
    }

    const { username, password } = credentials;
    if (!username && !password) {
      window.log.warn(
        'SocketManager authenticate was called without credentials'
      );
      return;
    }

    if (
      this.credentials &&
      this.credentials.username === username &&
      this.credentials.password === password &&
      this.authenticated
    ) {
      try {
        await this.authenticated.getResult();
      } catch (error) {
        window.log.warn(
          'SocketManager: failed to wait for existing authenticated socket ' +
            ` due to error: ${Errors.toLogFormat(error)}`
        );
      }
      return;
    }

    this.credentials = credentials;

    window.log.info('SocketManager: connecting authenticated socket');

    this.status = SocketStatus.CONNECTING;

    const process = this.connectResource({
      path: '/v1/websocket/',
      query: { login: username, password },
      resourceOptions: {
        keepalive: { path: '/v1/keepalive' },
        handleRequest: (req: IncomingWebSocketRequest): void => {
          this.queueOrHandleRequest(req);
        },
      },
    });

    // Cancel previous connect attempt or close socket
    this.authenticated?.abort();

    this.authenticated = process;

    const reconnect = async (): Promise<void> => {
      const timeout = this.backOff.getAndIncrement();

      window.log.info(
        'SocketManager: reconnecting authenticated socket ' +
          `after ${timeout}ms`
      );

      await sleep(timeout);
      if (this.isOffline) {
        window.log.info(
          'SocketManager: cancelled reconnect because we are offline'
        );
        return;
      }

      if (this.authenticated) {
        window.log.info(
          'SocketManager: authenticated socket already reconnected'
        );
        return;
      }

      strictAssert(this.credentials !== undefined, 'Missing credentials');

      try {
        await this.authenticate(this.credentials);
      } catch (error) {
        window.log.info(
          'SocketManager: authenticated socket failed to reconect ' +
            `due to error ${Errors.toLogFormat(error)}`
        );
        return reconnect();
      }
    };

    let authenticated: WebSocketResource;
    try {
      authenticated = await process.getResult();
      this.status = SocketStatus.OPEN;
    } catch (error) {
      strictAssert(this.authenticated === process, 'Someone stole our socket');
      this.dropAuthenticated(process);

      window.log.warn(
        'SocketManager: authenticated socket connection failed with ' +
          `error: ${Errors.toLogFormat(error)}`
      );

      if (error instanceof HTTPError) {
        const { code } = error;

        if (code === 401 || code === 403) {
          this.emit('authError', error);
          return;
        }

        if (code !== 500 && code !== -1) {
          // No reconnect attempt should be made
          return;
        }
      }

      reconnect();
      return;
    }

    window.log.info('SocketManager: connected authenticated socket');

    window.logAuthenticatedConnect?.();
    this.backOff.reset();

    authenticated.addEventListener('close', ({ code, reason }): void => {
      if (this.authenticated !== process) {
        return;
      }

      window.log.warn(
        'SocketManager: authenticated socket closed ' +
          `with code=${code} and reason=${reason}`
      );
      this.dropAuthenticated(process);

      if (code === 3000) {
        // Intentional disconnect
        return;
      }

      reconnect();
    });
  }

  // Either returns currently connecting/active authenticated
  // WebSocketResource or connects a fresh one.
  public async getAuthenticatedResource(): Promise<WebSocketResource> {
    if (!this.authenticated) {
      strictAssert(this.credentials !== undefined, 'Missing credentials');
      await this.authenticate(this.credentials);
    }

    strictAssert(this.authenticated !== undefined, 'Authentication failed');
    return this.authenticated.getResult();
  }

  // Creates new WebSocketResource for AccountManager's provisioning
  public async getProvisioningResource(
    handler: IRequestHandler
  ): Promise<WebSocketResource> {
    return this.connectResource({
      path: '/v1/websocket/provisioning/',
      resourceOptions: {
        handleRequest: (req: IncomingWebSocketRequest): void => {
          handler.handleRequest(req);
        },
        keepalive: { path: '/v1/keepalive/provisioning' },
      },
    }).getResult();
  }

  // Fetch-compatible wrapper around underlying unauthenticated/authenticated
  // websocket resources. This wrapper supports only limited number of features
  // of node-fetch despite being API compatible.
  public async fetch(url: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);

    let resource: WebSocketResource;
    if (this.isAuthenticated(headers)) {
      resource = await this.getAuthenticatedResource();
    } else {
      resource = await this.getUnauthenticatedResource();
    }

    const { path } = URL.parse(url);
    strictAssert(path, "Fetch can't have empty path");

    const { method = 'GET', body, timeout } = init;

    let bodyBytes: Uint8Array | undefined;
    if (body === undefined) {
      bodyBytes = undefined;
    } else if (body instanceof Uint8Array) {
      bodyBytes = body;
    } else if (body instanceof ArrayBuffer) {
      bodyBytes = new FIXMEU8(body);
    } else if (typeof body === 'string') {
      bodyBytes = Bytes.fromString(body);
    } else {
      throw new Error(`Unsupported body type: ${typeof body}`);
    }

    const {
      status,
      message: statusText,
      response,
      headers: flatResponseHeaders,
    } = await resource.sendRequest({
      verb: method,
      path,
      body: bodyBytes,
      headers: Array.from(headers.entries()).map(([key, value]) => {
        return `${key}:${value}`;
      }),
      timeout,
    });

    const responseHeaders: Array<[string, string]> = flatResponseHeaders.map(
      header => {
        const [key, value] = header.split(':', 2);
        strictAssert(value !== undefined, 'Invalid header!');
        return [key, value];
      }
    );

    return new Response(response, {
      status,
      statusText,
      headers: responseHeaders,
    });
  }

  public registerRequestHandler(handler: IRequestHandler): void {
    this.requestHandlers.add(handler);

    const queue = this.incomingRequestQueue;
    if (queue.length === 0) {
      return;
    }

    window.log.info(
      `SocketManager: processing ${queue.length} queued incoming requests`
    );
    this.incomingRequestQueue = [];
    for (const req of queue) {
      this.queueOrHandleRequest(req);
    }
  }

  public unregisterRequestHandler(handler: IRequestHandler): void {
    this.requestHandlers.delete(handler);
  }

  // Force keep-alive checks on WebSocketResources
  public async check(): Promise<void> {
    if (this.isOffline) {
      return;
    }

    window.log.info('SocketManager.check');
    await Promise.all([
      SocketManager.checkResource(this.authenticated),
      SocketManager.checkResource(this.unauthenticated),
    ]);
  }

  // Puts SocketManager into "online" state and reconnects the authenticated
  // WebSocketResource (if there are valid credentials)
  public async onOnline(): Promise<void> {
    window.log.info('SocketManager.onOnline');
    this.isOffline = false;

    if (this.credentials) {
      await this.authenticate(this.credentials);
    }
  }

  // Puts SocketManager into "offline" state and gracefully disconnects both
  // unauthenticated and authenticated resources.
  public async onOffline(): Promise<void> {
    window.log.info('SocketManager.onOffline');
    this.isOffline = true;

    this.authenticated?.abort();
    this.unauthenticated?.abort();
    this.authenticated = undefined;
    this.unauthenticated = undefined;
  }

  //
  // Private
  //

  private async getUnauthenticatedResource(): Promise<WebSocketResource> {
    if (this.isOffline) {
      throw new HTTPError('SocketManager offline', {
        code: 0,
        headers: {},
        stack: new Error().stack,
      });
    }

    if (this.unauthenticated) {
      return this.unauthenticated.getResult();
    }

    window.log.info('SocketManager: connecting unauthenticated socket');

    const process = this.connectResource({
      path: '/v1/websocket/',
      resourceOptions: {
        keepalive: { path: '/v1/keepalive' },
      },
    });
    this.unauthenticated = process;

    let unauthenticated: WebSocketResource;
    try {
      unauthenticated = await this.unauthenticated.getResult();
    } catch (error) {
      window.log.info(
        'SocketManager: failed to connect unauthenticated socket ' +
          ` due to error: ${Errors.toLogFormat(error)}`
      );
      this.dropUnauthenticated(process);
      throw error;
    }

    window.log.info('SocketManager: connected unauthenticated socket');

    let timer: NodeJS.Timeout | undefined = setTimeout(() => {
      window.log.info(
        'SocketManager: shutting down unauthenticated socket after timeout'
      );
      timer = undefined;
      unauthenticated.shutdown();
      this.dropUnauthenticated(process);
    }, FIVE_MINUTES);

    unauthenticated.addEventListener('close', ({ code, reason }): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }

      if (this.unauthenticated !== process) {
        return;
      }

      window.log.warn(
        'SocketManager: unauthenticated socket closed ' +
          `with code=${code} and reason=${reason}`
      );

      this.dropUnauthenticated(process);
    });

    return this.unauthenticated.getResult();
  }

  private connectResource({
    path,
    resourceOptions,
    query = {},
    timeout = TEN_SECONDS,
  }: {
    path: string;
    resourceOptions: WebSocketResourceOptions;
    query?: Record<string, string>;
    timeout?: number;
  }): AbortableProcess<WebSocketResource> {
    const fixedScheme = this.options.url
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');

    const headers = {
      'User-Agent': getUserAgent(this.options.version),
    };
    const client = new WebSocketClient({
      tlsOptions: {
        ca: this.options.certificateAuthority,
        agent: this.proxyAgent,
      },
      maxReceivedFrameSize: 0x210000,
    });

    const queryWithDefaults = {
      agent: 'OWD',
      version: this.options.version,
      ...query,
    };

    client.connect(
      `${fixedScheme}${path}?${qs.encode(queryWithDefaults)}`,
      undefined,
      undefined,
      headers
    );

    const { stack } = new Error();

    const { promise, resolve, reject } = explodePromise<WebSocketResource>();

    const timer = setTimeout(() => {
      reject(new ConnectTimeoutError('Connection timed out'));

      client.abort();
    }, timeout);

    let resource: WebSocketResource | undefined;
    client.on('connect', socket => {
      clearTimeout(timer);

      resource = new WebSocketResource(socket, resourceOptions);
      resolve(resource);
    });

    client.on('httpResponse', async response => {
      clearTimeout(timer);

      const statusCode = response.statusCode || -1;
      await handleStatusCode(statusCode);

      const error = new HTTPError(
        'connectResource: invalid websocket response',
        {
          code: statusCode || -1,
          headers: {},
          stack,
        }
      );

      const translatedError = translateError(error);
      strictAssert(
        translatedError,
        '`httpResponse` event cannot be emitted with 200 status code'
      );

      reject(translatedError);
    });

    client.on('connectFailed', e => {
      clearTimeout(timer);

      reject(
        new HTTPError('connectResource: connectFailed', {
          code: -1,
          headers: {},
          response: e.toString(),
          stack,
        })
      );
    });

    return new AbortableProcess<WebSocketResource>(
      `SocketManager.connectResource(${path})`,
      {
        abort() {
          if (resource) {
            window.log.warn(`SocketManager closing socket ${path}`);
            resource.close(3000, 'aborted');
          } else {
            window.log.warn(`SocketManager aborting connection ${path}`);
            clearTimeout(timer);
            client.abort();
          }
        },
      },
      promise
    );
  }

  private static async checkResource(
    process?: AbortableProcess<WebSocketResource>
  ): Promise<void> {
    if (!process) {
      return;
    }

    const resource = await process.getResult();
    resource.forceKeepAlive();
  }

  private dropAuthenticated(
    process: AbortableProcess<WebSocketResource>
  ): void {
    strictAssert(
      this.authenticated === process,
      'Authenticated resource mismatch'
    );

    this.incomingRequestQueue = [];
    this.authenticated = undefined;
    this.status = SocketStatus.CLOSED;
  }

  private dropUnauthenticated(
    process: AbortableProcess<WebSocketResource>
  ): void {
    strictAssert(
      this.unauthenticated === process,
      'Unauthenticated resource mismatch'
    );
    this.unauthenticated = undefined;
  }

  private queueOrHandleRequest(req: IncomingWebSocketRequest): void {
    if (this.requestHandlers.size === 0) {
      this.incomingRequestQueue.push(req);
      window.log.info(
        'SocketManager: request handler unavailable, ' +
          `queued request. Queue size: ${this.incomingRequestQueue.length}`
      );
      return;
    }
    for (const handlers of this.requestHandlers) {
      try {
        handlers.handleRequest(req);
      } catch (error) {
        window.log.warn(
          'SocketManager: got exception while handling incoming request, ' +
            `error: ${Errors.toLogFormat(error)}`
        );
      }
    }
  }

  private isAuthenticated(headers: Headers): boolean {
    if (!this.credentials) {
      return false;
    }

    const authorization = headers.get('Authorization');
    if (!authorization) {
      return false;
    }

    const [basic, base64] = authorization.split(/\s+/, 2);

    if (basic.toLowerCase() !== 'basic' || !base64) {
      return false;
    }

    const [username, password] = Bytes.toString(Bytes.fromBase64(base64)).split(
      ':',
      2
    );

    return (
      username === this.credentials.username &&
      password === this.credentials.password
    );
  }

  // EventEmitter types

  public on(type: 'authError', callback: (error: HTTPError) => void): this;

  public on(
    type: string | symbol,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listener: (...args: Array<any>) => void
  ): this {
    return super.on(type, listener);
  }

  public emit(type: 'authError', error: HTTPError): boolean;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public emit(type: string | symbol, ...args: Array<any>): boolean {
    return super.emit(type, ...args);
  }
}

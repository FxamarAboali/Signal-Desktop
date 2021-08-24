// Copyright 2015-2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable
     class-methods-use-this,
     @typescript-eslint/no-empty-function
     */

import { assert } from 'chai';

import MessageReceiver from '../textsecure/MessageReceiver';
import { IncomingWebSocketRequest } from '../textsecure/WebsocketResources';
import { WebAPIType } from '../textsecure/WebAPI';
import { DecryptionErrorEvent } from '../textsecure/messageReceiverEvents';
import { SignalService as Proto } from '../protobuf';
import * as Crypto from '../Crypto';

// TODO: remove once we move away from ArrayBuffers
const FIXMEU8 = Uint8Array;

describe('MessageReceiver', () => {
  const number = '+19999999999';
  const uuid = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee';
  const deviceId = 1;

  describe('connecting', () => {
    it('generates decryption-error event when it cannot decrypt', done => {
      const messageReceiver = new MessageReceiver({
        server: {} as WebAPIType,
        storage: window.storage,
        serverTrustRoot: 'AAAAAAAA',
      });

      const body = Proto.Envelope.encode({
        type: Proto.Envelope.Type.CIPHERTEXT,
        source: number,
        sourceUuid: uuid,
        sourceDevice: deviceId,
        timestamp: Date.now(),
        content: new FIXMEU8(Crypto.getRandomBytes(200)),
      }).finish();

      messageReceiver.handleRequest(
        new IncomingWebSocketRequest(
          {
            id: 1,
            verb: 'PUT',
            path: '/api/v1/message',
            body,
            headers: [],
          },
          (_: Buffer): void => {}
        )
      );

      messageReceiver.addEventListener(
        'decryption-error',
        (error: DecryptionErrorEvent) => {
          assert.strictEqual(error.decryptionError.senderUuid, uuid);
          assert.strictEqual(error.decryptionError.senderDevice, deviceId);
          done();
        }
      );
    });
  });
});

// Copyright 2020-2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable more/no-then */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import PQueue from 'p-queue';

import EventTarget from './EventTarget';
import { WebAPIType } from './WebAPI';
import { KeyPairType, CompatSignedPreKeyType } from './Types.d';
import utils from './Helpers';
import ProvisioningCipher from './ProvisioningCipher';
import { IncomingWebSocketRequest } from './WebsocketResources';
import createTaskWithTimeout from './TaskWithTimeout';
import * as Bytes from '../Bytes';
import {
  deriveAccessKey,
  generateRegistrationId,
  getRandomBytes,
  typedArrayToArrayBuffer,
} from '../Crypto';
import {
  generateKeyPair,
  generateSignedPreKey,
  generatePreKey,
} from '../Curve';
import { isMoreRecentThan, isOlderThan } from '../util/timestamp';
import { ourProfileKeyService } from '../services/ourProfileKey';
import { assert } from '../util/assert';
import { getProvisioningUrl } from '../util/getProvisioningUrl';
import { SignalService as Proto } from '../protobuf';

const DAY = 24 * 60 * 60 * 1000;
const MINIMUM_SIGNED_PREKEYS = 5;
const ARCHIVE_AGE = 30 * DAY;
const PREKEY_ROTATION_AGE = DAY;
const PROFILE_KEY_LENGTH = 32;
const SIGNED_KEY_GEN_BATCH_SIZE = 100;

// TODO: remove once we move away from ArrayBuffers
const FIXMEU8 = Uint8Array;

function getIdentifier(id: string | undefined) {
  if (!id || !id.length) {
    return id;
  }

  const parts = id.split('.');
  if (!parts.length) {
    return id;
  }

  return parts[0];
}

type GeneratedKeysType = {
  preKeys: Array<{
    keyId: number;
    publicKey: ArrayBuffer;
  }>;
  signedPreKey: {
    keyId: number;
    publicKey: ArrayBuffer;
    signature: ArrayBuffer;
    keyPair: KeyPairType;
  };
  identityKey: ArrayBuffer;
};

export default class AccountManager extends EventTarget {
  pending: Promise<void>;

  pendingQueue?: PQueue;

  constructor(private readonly server: WebAPIType) {
    super();

    this.pending = Promise.resolve();
  }

  async requestVoiceVerification(number: string, captchaToken?: string) {
    return this.server.requestVerificationVoice(number, captchaToken);
  }

  async requestSMSVerification(number: string, captchaToken?: string) {
    return this.server.requestVerificationSMS(number, captchaToken);
  }

  async encryptDeviceName(name: string, providedIdentityKey?: KeyPairType) {
    if (!name) {
      return null;
    }
    const identityKey =
      providedIdentityKey ||
      (await window.textsecure.storage.protocol.getIdentityKeyPair());
    if (!identityKey) {
      throw new Error('Identity key was not provided and is not in database!');
    }
    const encrypted = await window.Signal.Crypto.encryptDeviceName(
      name,
      identityKey.pubKey
    );

    const proto = new Proto.DeviceName();
    proto.ephemeralPublic = new FIXMEU8(encrypted.ephemeralPublic);
    proto.syntheticIv = new FIXMEU8(encrypted.syntheticIv);
    proto.ciphertext = new FIXMEU8(encrypted.ciphertext);

    const bytes = Proto.DeviceName.encode(proto).finish();
    return Bytes.toBase64(bytes);
  }

  async decryptDeviceName(base64: string) {
    const identityKey = await window.textsecure.storage.protocol.getIdentityKeyPair();
    if (!identityKey) {
      throw new Error('decryptDeviceName: No identity key pair!');
    }

    const bytes = Bytes.fromBase64(base64);
    const proto = Proto.DeviceName.decode(bytes);
    assert(
      proto.ephemeralPublic && proto.syntheticIv && proto.ciphertext,
      'Missing required fields in DeviceName'
    );
    const encrypted = {
      ephemeralPublic: typedArrayToArrayBuffer(proto.ephemeralPublic),
      syntheticIv: typedArrayToArrayBuffer(proto.syntheticIv),
      ciphertext: typedArrayToArrayBuffer(proto.ciphertext),
    };

    const name = await window.Signal.Crypto.decryptDeviceName(
      encrypted,
      identityKey.privKey
    );

    return name;
  }

  async maybeUpdateDeviceName() {
    const isNameEncrypted = window.textsecure.storage.user.getDeviceNameEncrypted();
    if (isNameEncrypted) {
      return;
    }
    const deviceName = window.textsecure.storage.user.getDeviceName();
    const base64 = await this.encryptDeviceName(deviceName || '');

    if (base64) {
      await this.server.updateDeviceName(base64);
    }
  }

  async deviceNameIsEncrypted() {
    await window.textsecure.storage.user.setDeviceNameEncrypted();
  }

  async registerSingleDevice(number: string, verificationCode: string) {
    return this.queueTask(async () => {
      const identityKeyPair = generateKeyPair();
      const profileKey = getRandomBytes(PROFILE_KEY_LENGTH);
      const accessKey = await deriveAccessKey(profileKey);

      await this.createAccount(
        number,
        verificationCode,
        identityKeyPair,
        profileKey,
        null,
        null,
        null,
        { accessKey }
      );

      await this.clearSessionsAndPreKeys();
      const keys = await this.generateKeys(SIGNED_KEY_GEN_BATCH_SIZE);
      await this.server.registerKeys(keys);
      await this.confirmKeys(keys);
      await this.registrationDone();
    });
  }

  async registerSecondDevice(
    setProvisioningUrl: Function,
    confirmNumber: (number?: string) => Promise<string>,
    progressCallback: Function
  ) {
    const createAccount = this.createAccount.bind(this);
    const clearSessionsAndPreKeys = this.clearSessionsAndPreKeys.bind(this);
    const generateKeys = this.generateKeys.bind(
      this,
      SIGNED_KEY_GEN_BATCH_SIZE,
      progressCallback
    );
    const provisioningCipher = new ProvisioningCipher();
    const pubKey = await provisioningCipher.getPublicKey();

    let envelopeCallbacks:
      | {
          resolve(data: Proto.ProvisionEnvelope): void;
          reject(error: Error): void;
        }
      | undefined;
    const envelopePromise = new Promise<Proto.ProvisionEnvelope>(
      (resolve, reject) => {
        envelopeCallbacks = { resolve, reject };
      }
    );

    const wsr = await this.server.getProvisioningResource({
      handleRequest(request: IncomingWebSocketRequest) {
        if (
          request.path === '/v1/address' &&
          request.verb === 'PUT' &&
          request.body
        ) {
          const proto = Proto.ProvisioningUuid.decode(request.body);
          const { uuid } = proto;
          if (!uuid) {
            throw new Error('registerSecondDevice: expected a UUID');
          }
          const url = getProvisioningUrl(uuid, pubKey);

          window.CI?.setProvisioningURL(url);

          setProvisioningUrl(url);
          request.respond(200, 'OK');
        } else if (
          request.path === '/v1/message' &&
          request.verb === 'PUT' &&
          request.body
        ) {
          const envelope = Proto.ProvisionEnvelope.decode(request.body);
          request.respond(200, 'OK');
          wsr.close();
          envelopeCallbacks?.resolve(envelope);
        } else {
          window.log.error('Unknown websocket message', request.path);
        }
      },
    });

    window.log.info('provisioning socket open');

    wsr.addEventListener('close', ({ code, reason }) => {
      window.log.info(
        `provisioning socket closed. Code: ${code} Reason: ${reason}`
      );

      // Note: if we have resolved the envelope already - this has no effect
      envelopeCallbacks?.reject(new Error('websocket closed'));
    });

    const envelope = await envelopePromise;
    const provisionMessage = await provisioningCipher.decrypt(envelope);

    await this.queueTask(async () => {
      const deviceName = await confirmNumber(provisionMessage.number);
      if (typeof deviceName !== 'string' || deviceName.length === 0) {
        throw new Error(
          'AccountManager.registerSecondDevice: Invalid device name'
        );
      }
      if (
        !provisionMessage.number ||
        !provisionMessage.provisioningCode ||
        !provisionMessage.identityKeyPair
      ) {
        throw new Error(
          'AccountManager.registerSecondDevice: Provision message was missing key data'
        );
      }

      await createAccount(
        provisionMessage.number,
        provisionMessage.provisioningCode,
        provisionMessage.identityKeyPair,
        provisionMessage.profileKey,
        deviceName,
        provisionMessage.userAgent,
        provisionMessage.readReceipts,
        { uuid: provisionMessage.uuid }
      );
      await clearSessionsAndPreKeys();
      const keys = await generateKeys();
      await this.server.registerKeys(keys);
      await this.confirmKeys(keys);
      await this.registrationDone();
    });
  }

  async refreshPreKeys() {
    const generateKeys = this.generateKeys.bind(
      this,
      SIGNED_KEY_GEN_BATCH_SIZE
    );
    const registerKeys = this.server.registerKeys.bind(this.server);

    return this.queueTask(async () =>
      this.server.getMyKeys().then(async preKeyCount => {
        window.log.info(`prekey count ${preKeyCount}`);
        if (preKeyCount < 10) {
          return generateKeys().then(registerKeys);
        }
        return null;
      })
    );
  }

  async rotateSignedPreKey() {
    return this.queueTask(async () => {
      const signedKeyId = window.textsecure.storage.get('signedKeyId', 1);
      if (typeof signedKeyId !== 'number') {
        throw new Error('Invalid signedKeyId');
      }

      const store = window.textsecure.storage.protocol;
      const { server, cleanSignedPreKeys } = this;

      const existingKeys = await store.loadSignedPreKeys();
      existingKeys.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      const confirmedKeys = existingKeys.filter(key => key.confirmed);
      const mostRecent = confirmedKeys[0];

      if (
        confirmedKeys.length >= 2 ||
        isMoreRecentThan(mostRecent?.created_at || 0, PREKEY_ROTATION_AGE)
      ) {
        window.log.warn(
          `rotateSignedPreKey: ${confirmedKeys.length} confirmed keys, most recent was created ${mostRecent?.created_at}. Cancelling rotation.`
        );
        return;
      }

      // eslint-disable-next-line consistent-return
      return store
        .getIdentityKeyPair()
        .then(
          async (identityKey: KeyPairType | undefined) => {
            if (!identityKey) {
              throw new Error('rotateSignedPreKey: No identity key pair!');
            }

            return generateSignedPreKey(identityKey, signedKeyId);
          },
          () => {
            // We swallow any error here, because we don't want to get into
            //   a loop of repeated retries.
            window.log.error(
              'Failed to get identity key. Canceling key rotation.'
            );
            return null;
          }
        )
        .then(async (res: CompatSignedPreKeyType | null) => {
          if (!res) {
            return null;
          }
          window.log.info('Saving new signed prekey', res.keyId);
          return Promise.all([
            window.textsecure.storage.put('signedKeyId', signedKeyId + 1),
            store.storeSignedPreKey(res.keyId, res.keyPair),
            server.setSignedPreKey({
              keyId: res.keyId,
              publicKey: res.keyPair.pubKey,
              signature: res.signature,
            }),
          ])
            .then(async () => {
              const confirmed = true;
              window.log.info('Confirming new signed prekey', res.keyId);
              return Promise.all([
                window.textsecure.storage.remove('signedKeyRotationRejected'),
                store.storeSignedPreKey(res.keyId, res.keyPair, confirmed),
              ]);
            })
            .then(cleanSignedPreKeys);
        })
        .catch(async (e: Error) => {
          window.log.error(
            'rotateSignedPrekey error:',
            e && e.stack ? e.stack : e
          );

          if (
            e instanceof Error &&
            e.name === 'HTTPError' &&
            e.code &&
            e.code >= 400 &&
            e.code <= 599
          ) {
            const rejections =
              1 + window.textsecure.storage.get('signedKeyRotationRejected', 0);
            await window.textsecure.storage.put(
              'signedKeyRotationRejected',
              rejections
            );
            window.log.error('Signed key rotation rejected count:', rejections);
          } else {
            throw e;
          }
        });
    });
  }

  async queueTask(task: () => Promise<any>) {
    this.pendingQueue = this.pendingQueue || new PQueue({ concurrency: 1 });
    const taskWithTimeout = createTaskWithTimeout(task, 'AccountManager task');

    return this.pendingQueue.add(taskWithTimeout);
  }

  async cleanSignedPreKeys() {
    const store = window.textsecure.storage.protocol;

    const allKeys = await store.loadSignedPreKeys();
    allKeys.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    const confirmed = allKeys.filter(key => key.confirmed);
    const unconfirmed = allKeys.filter(key => !key.confirmed);

    const recent = allKeys[0] ? allKeys[0].keyId : 'none';
    const recentConfirmed = confirmed[0] ? confirmed[0].keyId : 'none';
    const recentUnconfirmed = unconfirmed[0] ? unconfirmed[0].keyId : 'none';
    window.log.info(`cleanSignedPreKeys: Most recent signed key: ${recent}`);
    window.log.info(
      `cleanSignedPreKeys: Most recent confirmed signed key: ${recentConfirmed}`
    );
    window.log.info(
      `cleanSignedPreKeys: Most recent unconfirmed signed key: ${recentUnconfirmed}`
    );
    window.log.info(
      'cleanSignedPreKeys: Total signed key count:',
      allKeys.length,
      '-',
      confirmed.length,
      'confirmed'
    );

    // Keep MINIMUM_SIGNED_PREKEYS keys, then drop if older than ARCHIVE_AGE
    await Promise.all(
      allKeys.map(async (key, index) => {
        if (index < MINIMUM_SIGNED_PREKEYS) {
          return;
        }
        const createdAt = key.created_at || 0;

        if (isOlderThan(createdAt, ARCHIVE_AGE)) {
          const timestamp = new Date(createdAt).toJSON();
          const confirmedText = key.confirmed ? ' (confirmed)' : '';
          window.log.info(
            `Removing signed prekey: ${key.keyId} with timestamp ${timestamp}${confirmedText}`
          );
          await store.removeSignedPreKey(key.keyId);
        }
      })
    );
  }

  async createAccount(
    number: string,
    verificationCode: string,
    identityKeyPair: KeyPairType,
    profileKey: ArrayBuffer | undefined,
    deviceName: string | null,
    userAgent?: string | null,
    readReceipts?: boolean | null,
    options: { accessKey?: ArrayBuffer; uuid?: string } = {}
  ): Promise<void> {
    const { accessKey, uuid } = options;
    let password = btoa(utils.getString(getRandomBytes(16)));
    password = password.substring(0, password.length - 2);
    const registrationId = generateRegistrationId();

    const previousNumber = getIdentifier(
      window.textsecure.storage.get('number_id')
    );
    const previousUuid = getIdentifier(
      window.textsecure.storage.get('uuid_id')
    );

    let encryptedDeviceName;
    if (deviceName) {
      encryptedDeviceName = await this.encryptDeviceName(
        deviceName,
        identityKeyPair
      );
      await this.deviceNameIsEncrypted();
    }

    window.log.info(
      `createAccount: Number is ${number}, password has length: ${
        password ? password.length : 'none'
      }`
    );

    const response = await this.server.confirmCode(
      number,
      verificationCode,
      password,
      registrationId,
      encryptedDeviceName,
      { accessKey, uuid }
    );

    const uuidChanged = previousUuid && uuid && previousUuid !== uuid;

    // We only consider the number changed if we didn't have a UUID before
    const numberChanged =
      !previousUuid && previousNumber && previousNumber !== number;

    if (uuidChanged || numberChanged) {
      if (uuidChanged) {
        window.log.warn(
          'New uuid is different from old uuid; deleting all previous data'
        );
      }
      if (numberChanged) {
        window.log.warn(
          'New number is different from old number; deleting all previous data'
        );
      }

      try {
        await window.textsecure.storage.protocol.removeAllData();
        window.log.info('Successfully deleted previous data');
      } catch (error) {
        window.log.error(
          'Something went wrong deleting data from previous number',
          error && error.stack ? error.stack : error
        );
      }
    }

    await Promise.all([
      window.textsecure.storage.remove('identityKey'),
      window.textsecure.storage.user.removeCredentials(),
      window.textsecure.storage.remove('registrationId'),
      window.textsecure.storage.remove('regionCode'),
      window.textsecure.storage.remove('userAgent'),
      window.textsecure.storage.remove('profileKey'),
      window.textsecure.storage.remove('read-receipt-setting'),
    ]);

    // `setCredentials` needs to be called
    // before `saveIdentifyWithAttributes` since `saveIdentityWithAttributes`
    // indirectly calls `ConversationController.getConverationId()` which
    // initializes the conversation for the given number (our number) which
    // calls out to the user storage API to get the stored UUID and number
    // information.
    await window.textsecure.storage.user.setCredentials({
      uuid,
      number,
      deviceId: response.deviceId ?? 1,
      deviceName: deviceName ?? undefined,
      password,
    });

    // This needs to be done very early, because it changes how things are saved in the
    //   database. Your identity, for example, in the saveIdentityWithAttributes call
    //   below.
    const conversationId = window.ConversationController.ensureContactIds({
      e164: number,
      uuid,
      highTrust: true,
    });

    if (!conversationId) {
      throw new Error('registrationDone: no conversationId!');
    }

    // update our own identity key, which may have changed
    // if we're relinking after a reinstall on the master device
    await window.textsecure.storage.protocol.saveIdentityWithAttributes(
      uuid || number,
      {
        publicKey: identityKeyPair.pubKey,
        firstUse: true,
        timestamp: Date.now(),
        verified: window.textsecure.storage.protocol.VerifiedStatus.VERIFIED,
        nonblockingApproval: true,
      }
    );

    await window.textsecure.storage.put('identityKey', identityKeyPair);
    await window.textsecure.storage.put('registrationId', registrationId);
    if (profileKey) {
      await ourProfileKeyService.set(profileKey);
    }
    if (userAgent) {
      await window.textsecure.storage.put('userAgent', userAgent);
    }

    await window.textsecure.storage.put(
      'read-receipt-setting',
      Boolean(readReceipts)
    );

    const regionCode = window.libphonenumber.util.getRegionCodeForNumber(
      number
    );
    await window.textsecure.storage.put('regionCode', regionCode);
    await window.textsecure.storage.protocol.hydrateCaches();
  }

  async clearSessionsAndPreKeys() {
    const store = window.textsecure.storage.protocol;

    window.log.info('clearing all sessions, prekeys, and signed prekeys');
    await Promise.all([
      store.clearPreKeyStore(),
      store.clearSignedPreKeysStore(),
      store.clearSessionStore(),
    ]);
  }

  async getGroupCredentials(startDay: number, endDay: number) {
    return this.server.getGroupCredentials(startDay, endDay);
  }

  // Takes the same object returned by generateKeys
  async confirmKeys(keys: GeneratedKeysType) {
    const store = window.textsecure.storage.protocol;
    const key = keys.signedPreKey;
    const confirmed = true;

    if (!key) {
      throw new Error('confirmKeys: signedPreKey is null');
    }

    window.log.info('confirmKeys: confirming key', key.keyId);
    await store.storeSignedPreKey(key.keyId, key.keyPair, confirmed);
  }

  async generateKeys(count: number, providedProgressCallback?: Function) {
    const progressCallback =
      typeof providedProgressCallback === 'function'
        ? providedProgressCallback
        : null;
    const startId = window.textsecure.storage.get('maxPreKeyId', 1);
    const signedKeyId = window.textsecure.storage.get('signedKeyId', 1);

    if (typeof startId !== 'number') {
      throw new Error('Invalid maxPreKeyId');
    }
    if (typeof signedKeyId !== 'number') {
      throw new Error('Invalid signedKeyId');
    }

    const store = window.textsecure.storage.protocol;
    return store.getIdentityKeyPair().then(async identityKey => {
      if (!identityKey) {
        throw new Error('generateKeys: No identity key pair!');
      }

      const result: any = {
        preKeys: [],
        identityKey: identityKey.pubKey,
      };
      const promises = [];

      for (let keyId = startId; keyId < startId + count; keyId += 1) {
        promises.push(
          Promise.resolve(generatePreKey(keyId)).then(async res => {
            await store.storePreKey(res.keyId, res.keyPair);
            result.preKeys.push({
              keyId: res.keyId,
              publicKey: res.keyPair.pubKey,
            });
            if (progressCallback) {
              progressCallback();
            }
          })
        );
      }

      promises.push(
        Promise.resolve(generateSignedPreKey(identityKey, signedKeyId)).then(
          async res => {
            await store.storeSignedPreKey(res.keyId, res.keyPair);
            result.signedPreKey = {
              keyId: res.keyId,
              publicKey: res.keyPair.pubKey,
              signature: res.signature,
              // server.registerKeys doesn't use keyPair, confirmKeys does
              keyPair: res.keyPair,
            };
          }
        )
      );

      promises.push(
        window.textsecure.storage.put('maxPreKeyId', startId + count)
      );
      promises.push(
        window.textsecure.storage.put('signedKeyId', signedKeyId + 1)
      );

      return Promise.all(promises).then(async () =>
        // This is primarily for the signed prekey summary it logs out
        this.cleanSignedPreKeys().then(() => result as GeneratedKeysType)
      );
    });
  }

  async registrationDone() {
    window.log.info('registration done');
    this.dispatchEvent(new Event('registration'));
  }
}

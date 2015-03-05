//TODO: Remove almost everything here...

'use strict';

;(function() {
    window.axolotl = window.axolotl || {};
    window.axolotl.api = {
        getMyRegistrationId: function() {
            return textsecure.storage.getUnencrypted("registrationId");
        },
        storage: {
            put: function(key, value) {
                return textsecure.storage.putEncrypted(key, value);
            },
            get: function(key, defaultValue) {
                return textsecure.storage.getEncrypted(key, defaultValue);
            },
            remove: function(key) {
                return textsecure.storage.removeEncrypted(key);
            },

            identityKeys: {
                get: function(identifier) {
                    return textsecure.storage.devices.getIdentityKeyForNumber(textsecure.utils.unencodeNumber(identifier)[0]);
                },
                put: function(identifier, identityKey) {
                    return textsecure.storage.devices.checkSaveIdentityKeyForNumber(textsecure.utils.unencodeNumber(identifier)[0], identityKey);
                },
            },

            sessions: {
                get: function(identifier) {
                    var device = textsecure.storage.devices.getDeviceObject(identifier, true);
                    if (device === undefined || device.sessions === undefined)
                        return undefined;
                    return device.sessions;
                },
                put: function(identifier, record) {
                    var device = textsecure.storage.devices.getDeviceObject(identifier);
                    if (device === undefined) {
                        device = { encodedNumber: identifier,
                                   //TODO: Remove this duplication
                                   identityKey: record.identityKey
                                 };
                    }
                    if (getString(device.identityKey) !== getString(record.identityKey))
                        throw new Error("Tried to put session for device with changed identity key");
                    device.sessions = record;
                    return textsecure.storage.devices.saveDeviceObject(device);
                }
            }
        },
        updateKeys: function(keys) {
            return textsecure.api.registerKeys(keys).catch(function(e) {
                //TODO: Notify the user somehow?
                console.error(e);
            });
        },
    };

    var decodeMessageContents = function(res) {
        var finalMessage = textsecure.protobuf.PushMessageContent.decode(res[0]);

        if ((finalMessage.flags & textsecure.protobuf.PushMessageContent.Flags.END_SESSION)
                == textsecure.protobuf.PushMessageContent.Flags.END_SESSION &&
                finalMessage.sync !== null)
            res[1]();

        return finalMessage;
    };

    var handlePreKeyWhisperMessage = function(from, message) {
        try {
            return axolotl.protocol.handlePreKeyWhisperMessage(from, message);
        } catch(e) {
            if (e.message === 'Unknown identity key') {
                // create an error that the UI will pick up and ask the
                // user if they want to re-negotiate
                throw new textsecure.IncomingIdentityKeyError(from, message);
            }
            throw e;
        }
    };

    window.textsecure = window.textsecure || {};
    window.textsecure.protocol_wrapper = {
        handleIncomingPushMessageProto: function(proto) {
            switch(proto.type) {
            case textsecure.protobuf.IncomingPushMessageSignal.Type.PLAINTEXT:
                return Promise.resolve(textsecure.protobuf.PushMessageContent.decode(proto.message));
            case textsecure.protobuf.IncomingPushMessageSignal.Type.CIPHERTEXT:
                var from = proto.source + "." + (proto.sourceDevice == null ? 0 : proto.sourceDevice);
                return axolotl.protocol.decryptWhisperMessage(from, getString(proto.message)).then(decodeMessageContents);
            case textsecure.protobuf.IncomingPushMessageSignal.Type.PREKEY_BUNDLE:
                if (proto.message.readUint8() != ((3 << 4) | 3))
                    throw new Error("Bad version byte");
                var from = proto.source + "." + (proto.sourceDevice == null ? 0 : proto.sourceDevice);
                return handlePreKeyWhisperMessage(from, getString(proto.message)).then(decodeMessageContents);
            case textsecure.protobuf.IncomingPushMessageSignal.Type.RECEIPT:
                return Promise.resolve(null);
            default:
                return new Promise(function(resolve, reject) { reject(new Error("Unknown message type")); });
            }
        }
    };

    var tryMessageAgain = function(from, encodedMessage) {
        //TODO: Probably breaks with a devicecontrol message
        return axolotl.protocol.handlePreKeyWhisperMessage(from, encodedMessage).then(decodeMessageContents);
    }
    textsecure.replay.registerFunction(tryMessageAgain, textsecure.replay.Type.INIT_SESSION);
})();

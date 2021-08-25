// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { FunctionComponent } from 'react';
import type { ConversationType } from '../state/ducks/conversations';
import type { LocalizerType } from '../types/Util';
import { Avatar, AvatarSize } from './Avatar';
import { Emojify } from './conversation/Emojify';
import { missingCaseError } from '../util/missingCaseError';

type PropsType = {
  conversation: Pick<
    ConversationType,
    | 'acceptedMessageRequest'
    | 'avatarPath'
    | 'color'
    | 'isMe'
    | 'name'
    | 'phoneNumber'
    | 'profileName'
    | 'sharedGroupNames'
    | 'title'
    | 'type'
    | 'unblurredAvatarPath'
  >;
  i18n: LocalizerType;
  me: Pick<ConversationType, 'uuid'>;

  // The following should only be set for group conversations.
  groupMembers?: Array<Pick<ConversationType, 'firstName' | 'title' | 'uuid'>>;
  isCallFull?: boolean;
  peekedParticipants?: Array<
    Pick<ConversationType, 'firstName' | 'title' | 'uuid'>
  >;
};

export const CallingPreCallInfo: FunctionComponent<PropsType> = ({
  conversation,
  groupMembers = [],
  i18n,
  isCallFull = false,
  me,
  peekedParticipants = [],
}) => {
  let subtitle: string;
  if (isCallFull) {
    subtitle = i18n('calling__call-is-full');
  } else if (peekedParticipants.length) {
    // It should be rare to see yourself in this list, but it's possible if (1) you rejoin
    //   quickly, causing the server to return stale state (2) you have joined on another
    //   device.
    let hasYou = false;
    const participantNames = peekedParticipants.map(participant => {
      if (participant.uuid === me.uuid) {
        hasYou = true;
        return i18n('you');
      }
      return getParticipantName(participant);
    });

    switch (participantNames.length) {
      case 1:
        subtitle = hasYou
          ? i18n('calling__pre-call-info--another-device-in-call')
          : i18n('calling__pre-call-info--1-person-in-call', participantNames);
        break;
      case 2:
        subtitle = i18n('calling__pre-call-info--2-people-in-call', {
          first: participantNames[0],
          second: participantNames[1],
        });
        break;
      case 3:
        subtitle = i18n('calling__pre-call-info--3-people-in-call', {
          first: participantNames[0],
          second: participantNames[1],
          third: participantNames[2],
        });
        break;
      default:
        subtitle = i18n('calling__pre-call-info--many-people-in-call', {
          first: participantNames[0],
          second: participantNames[1],
          others: String(participantNames.length - 2),
        });
        break;
    }
  } else if (conversation.type === 'direct') {
    subtitle = i18n('calling__pre-call-info--will-ring-1', [
      getParticipantName(conversation),
    ]);
  } else if (conversation.type === 'group') {
    const memberNames = groupMembers.map(getParticipantName);

    switch (memberNames.length) {
      case 0:
        subtitle = i18n('calling__pre-call-info--empty-group');
        break;
      case 1:
        subtitle = i18n('calling__pre-call-info--will-notify-1', [
          memberNames[0],
        ]);
        break;
      case 2:
        subtitle = i18n('calling__pre-call-info--will-notify-2', {
          first: memberNames[0],
          second: memberNames[1],
        });
        break;
      case 3:
        subtitle = i18n('calling__pre-call-info--will-notify-3', {
          first: memberNames[0],
          second: memberNames[1],
          third: memberNames[2],
        });
        break;
      default:
        subtitle = i18n('calling__pre-call-info--will-notify-many', {
          first: memberNames[0],
          second: memberNames[1],
          others: String(memberNames.length - 2),
        });
        break;
    }
  } else {
    throw missingCaseError(conversation.type);
  }

  return (
    <div className="module-CallingPreCallInfo">
      <Avatar
        avatarPath={conversation.avatarPath}
        color={conversation.color}
        acceptedMessageRequest={conversation.acceptedMessageRequest}
        conversationType={conversation.type}
        isMe={conversation.isMe}
        name={conversation.name}
        noteToSelf={false}
        phoneNumber={conversation.phoneNumber}
        profileName={conversation.profileName}
        sharedGroupNames={conversation.sharedGroupNames}
        size={AvatarSize.ONE_HUNDRED_TWELVE}
        title={conversation.title}
        unblurredAvatarPath={conversation.unblurredAvatarPath}
        i18n={i18n}
      />
      <div className="module-CallingPreCallInfo__title">
        <Emojify text={conversation.title} />
      </div>
      <div className="module-CallingPreCallInfo__subtitle">{subtitle}</div>
    </div>
  );
};

function getParticipantName(
  participant: Readonly<Pick<ConversationType, 'firstName' | 'title'>>
): string {
  return participant.firstName || participant.title;
}

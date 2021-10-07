// Copyright 2020-2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { ReactElement, useState } from 'react';
import { get } from 'lodash';

import { ReplacementValuesType } from '../../types/I18N';
import { FullJSXType, Intl } from '../Intl';
import { LocalizerType } from '../../types/Util';
import { GroupDescriptionText } from '../GroupDescriptionText';
import { Button, ButtonSize, ButtonVariant } from '../Button';
import { SystemMessage } from './SystemMessage';

import { GroupV2ChangeType, GroupV2ChangeDetailType } from '../../groups';

import { renderChange, SmartContactRendererType } from '../../groupChange';
import { Modal } from '../Modal';

export type PropsDataType = {
  groupName?: string;
  ourConversationId: string;
  change: GroupV2ChangeType;
};

export type PropsHousekeepingType = {
  i18n: LocalizerType;
  renderContact: SmartContactRendererType;
};

export type PropsType = PropsDataType & PropsHousekeepingType;

function renderStringToIntl(
  id: string,
  i18n: LocalizerType,
  components?: Array<FullJSXType> | ReplacementValuesType<FullJSXType>
): FullJSXType {
  return <Intl id={id} i18n={i18n} components={components} />;
}

type GroupIconType =
  | 'group'
  | 'group-access'
  | 'group-add'
  | 'group-approved'
  | 'group-avatar'
  | 'group-decline'
  | 'group-edit'
  | 'group-leave'
  | 'group-remove';

const changeToIconMap = new Map<string, GroupIconType>([
  ['access-attributes', 'group-access'],
  ['access-invite-link', 'group-access'],
  ['access-members', 'group-access'],
  ['admin-approval-add-one', 'group-add'],
  ['admin-approval-remove-one', 'group-decline'],
  ['announcements-only', 'group-access'],
  ['avatar', 'group-avatar'],
  ['description', 'group-edit'],
  ['group-link-add', 'group-access'],
  ['group-link-remove', 'group-access'],
  ['group-link-reset', 'group-access'],
  ['member-add', 'group-add'],
  ['member-add-from-admin-approval', 'group-approved'],
  ['member-add-from-invite', 'group-add'],
  ['member-add-from-link', 'group-add'],
  ['member-privilege', 'group-access'],
  ['member-remove', 'group-remove'],
  ['pending-add-many', 'group-add'],
  ['pending-add-one', 'group-add'],
  ['pending-remove-many', 'group-decline'],
  ['pending-remove-one', 'group-decline'],
  ['title', 'group-edit'],
]);

function getIcon(
  detail: GroupV2ChangeDetailType,
  fromId?: string
): GroupIconType {
  const changeType = detail.type;
  let possibleIcon = changeToIconMap.get(changeType);
  const isSameId = fromId === get(detail, 'conversationId', null);
  if (isSameId) {
    if (changeType === 'member-remove') {
      possibleIcon = 'group-leave';
    }
    if (changeType === 'member-add-from-invite') {
      possibleIcon = 'group-approved';
    }
  }
  return possibleIcon || 'group';
}

function GroupV2Detail({
  detail,
  i18n,
  fromId,
  onButtonClick,
  text,
}: {
  detail: GroupV2ChangeDetailType;
  i18n: LocalizerType;
  fromId?: string;
  onButtonClick: (x: string) => unknown;
  text: FullJSXType;
}): JSX.Element {
  const icon = getIcon(detail, fromId);

  const newGroupDescription =
    detail.type === 'description' && get(detail, 'description');

  return (
    <SystemMessage
      icon={icon}
      contents={text}
      button={
        newGroupDescription ? (
          <Button
            onClick={() => onButtonClick(newGroupDescription)}
            size={ButtonSize.Small}
            variant={ButtonVariant.SystemMessage}
          >
            {i18n('view')}
          </Button>
        ) : undefined
      }
    />
  );
}

export function GroupV2Change(props: PropsType): ReactElement {
  const { change, groupName, i18n, ourConversationId, renderContact } = props;

  const [groupDescription, setGroupDescription] = useState<
    string | undefined
  >();

  return (
    <>
      {renderChange(change, {
        i18n,
        ourConversationId,
        renderContact,
        renderString: renderStringToIntl,
      }).map((text: FullJSXType, index: number) => (
        <GroupV2Detail
          detail={change.details[index]}
          fromId={change.from}
          i18n={i18n}
          // Difficult to find a unique key for this type
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          onButtonClick={nextGroupDescription =>
            setGroupDescription(nextGroupDescription)
          }
          text={text}
        />
      ))}
      {groupDescription ? (
        <Modal
          hasXButton
          i18n={i18n}
          title={groupName}
          onClose={() => setGroupDescription(undefined)}
        >
          <GroupDescriptionText text={groupDescription} />
        </Modal>
      ) : null}
    </>
  );
}

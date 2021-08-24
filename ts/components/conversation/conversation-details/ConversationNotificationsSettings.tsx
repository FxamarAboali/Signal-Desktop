// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { FunctionComponent, useMemo } from 'react';

import { ConversationTypeType } from '../../../state/ducks/conversations';
import { LocalizerType } from '../../../types/Util';
import { PanelSection } from './PanelSection';
import { PanelRow } from './PanelRow';
import { ConversationDetailsIcon } from './ConversationDetailsIcon';
import { Select } from '../../Select';
import { isMuted } from '../../../util/isMuted';
import { assert } from '../../../util/assert';
import { getMuteOptions } from '../../../util/getMuteOptions';
import { parseIntOrThrow } from '../../../util/parseIntOrThrow';

type PropsType = {
  conversationType: ConversationTypeType;
  dontNotifyForMentionsIfMuted: boolean;
  i18n: LocalizerType;
  muteExpiresAt: undefined | number;
  setDontNotifyForMentionsIfMuted: (
    dontNotifyForMentionsIfMuted: boolean
  ) => unknown;
  setMuteExpiration: (muteExpiresAt: undefined | number) => unknown;
};

export const ConversationNotificationsSettings: FunctionComponent<PropsType> = ({
  conversationType,
  dontNotifyForMentionsIfMuted,
  i18n,
  muteExpiresAt,
  setMuteExpiration,
  setDontNotifyForMentionsIfMuted,
}) => {
  // This assertion is here to prevent accidental usage of this component in an untested
  //   context.
  assert(
    conversationType === 'group',
    '<ConversationNotificationsSettings> SHOULD work for non-group conversations, but it has not been tested there'
  );

  const muteOptions = useMemo(
    () => [
      ...(isMuted(muteExpiresAt)
        ? []
        : [
            {
              disabled: true,
              text: i18n('notMuted'),
              value: -1,
            },
          ]),
      ...getMuteOptions(muteExpiresAt, i18n).map(
        ({ disabled, name, value }) => ({
          disabled,
          text: name,
          value,
        })
      ),
    ],
    [i18n, muteExpiresAt]
  );

  const onMuteChange = (rawValue: string) => {
    const ms = parseIntOrThrow(
      rawValue,
      'NotificationSettings: mute ms was not an integer'
    );
    setMuteExpiration(ms);
  };

  const onChangeDontNotifyForMentionsIfMuted = (rawValue: string) => {
    setDontNotifyForMentionsIfMuted(rawValue === 'yes');
  };

  return (
    <div className="conversation-details-panel">
      <PanelSection>
        <PanelRow
          icon={
            <ConversationDetailsIcon
              ariaLabel={i18n('muteNotificationsTitle')}
              icon="mute"
            />
          }
          label={i18n('muteNotificationsTitle')}
          right={
            <Select options={muteOptions} onChange={onMuteChange} value={-1} />
          }
        />
        {conversationType === 'group' && (
          <PanelRow
            icon={
              <ConversationDetailsIcon
                ariaLabel={i18n(
                  'ConversationNotificationsSettings__mentions__label'
                )}
                icon="mention"
              />
            }
            label={i18n('ConversationNotificationsSettings__mentions__label')}
            info={i18n('ConversationNotificationsSettings__mentions__info')}
            right={
              <Select
                options={[
                  {
                    text: i18n(
                      'ConversationNotificationsSettings__mentions__select__always-notify'
                    ),
                    value: 'no',
                  },
                  {
                    text: i18n(
                      'ConversationNotificationsSettings__mentions__select__dont-notify-for-mentions-if-muted'
                    ),
                    value: 'yes',
                  },
                ]}
                onChange={onChangeDontNotifyForMentionsIfMuted}
                value={dontNotifyForMentionsIfMuted ? 'yes' : 'no'}
              />
            }
          />
        )}
      </PanelSection>
    </div>
  );
};
